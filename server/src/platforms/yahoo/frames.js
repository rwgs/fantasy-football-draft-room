// Yahoo's draft socket, decoded.
//
// The draft room talks to its draft server in pipe-delimited text, one record
// per frame. `docs/yahoo-draft-protocol.md` catalogues every frame seen and
// says which parts were observed and which were inferred; this file reads the
// four that carry state a board needs and ignores the rest.
//
// Nothing here is promised by Yahoo. It is a private protocol between their own
// client and their own server, and it can change in any deploy without notice.
// That is the reason the decode is one small file with one exported function:
// when it breaks, the break is cheap to find and cheap to fix.
//
// Deliberately pure. It touches no network and holds no state, so the whole
// thing is checkable against captured frames without a draft running, which
// matters because the alternative is finding a bug live.

/**
 * The frames worth decoding, and the six that are not.
 *
 * `C` clock ticks, `D` the clock changing hands, `J` and `L` managers coming
 * and going, `G` and `g` Yahoo's own grades, `O` its value labels, and `Q`,
 * `w`, `5`, `X` and `6` whose meanings are still unknown. None of them changes
 * who holds which player, so none of them reaches the board. Ignoring them by
 * default rather than by name is what stops a frame Yahoo adds tomorrow from
 * breaking a draft tonight.
 */

/** A draft type letter to the order this app runs. `S` is the only one seen. */
const DRAFT_TYPES = { S: 'snake', L: 'linear' };

/**
 * Decode one frame, or null when it carries nothing a board needs.
 *
 * The caller feeds every frame in and keeps what comes back, so a frame this
 * does not understand costs nothing. Returning null rather than throwing is the
 * point: an unknown frame mid-draft must not take the bridge down with it.
 */
export function decodeFrame(text) {
  const raw = String(text ?? '');
  if (!raw) return null;

  // A frame is its letter, then its fields. `P` arrives bare when no pick has
  // been made yet, so the split has to survive there being no separator at all.
  const parts = raw.split('|');
  const kind = parts[0];

  switch (kind) {
    case 'H': return settings(parts);
    case 'R': return order(parts);
    case 'P': return replay(parts);
    case '0': return live(parts);
    default: return null;
  }
}

/**
 * `H|S|30|0|0|<started>` — how the draft runs.
 *
 * The type letter and the pick clock are inferred rather than documented, but
 * both agree with the order and the clock actually seen. The last field is
 * observed: `0` before a draft opens, `1` on reconnecting to one under way.
 * The two middle zeros have no known meaning and are not read.
 */
function settings(parts) {
  const type = DRAFT_TYPES[parts[1]] || null;
  const seconds = int(parts[2]);
  return {
    kind: 'settings',
    // Null rather than a guess. A draft type this has never seen is better
    // reported as unknown than silently run as a snake.
    type,
    typeLetter: parts[1] || null,
    seconds: seconds > 0 ? seconds : null,
    started: parts[5] === '1',
  };
}

/**
 * `R|<team>|<team>|…` — the entire draft order, one entry per pick.
 *
 * This is the order rather than an implication of it. A league with keepers, a
 * traded pick or a custom order is exactly the league a derived snake gets
 * wrong, and those are the leagues that most need the tool, so the order is
 * always read from here and never computed.
 */
function order(parts) {
  const seats = parts.slice(1).map(int).filter((n) => n > 0);
  if (!seats.length) return null;
  return { kind: 'order', order: seats };
}

/**
 * `P|<overall>=<player>,<team>,<cost>|…` — every pick made so far.
 *
 * Sent on connect, which is what makes a mid-draft reload survivable: a client
 * that reconnects is told everything it missed, so nothing has to be remembered
 * across a crash and a bridge needs no storage of its own.
 *
 * Note the shape differs from a live pick below. Here the fields are separated
 * by commas inside one record and carry no roster slot; there they are separate
 * pipe fields and a slot sits between the seat and the cost. Reading one with
 * the other's layout silently swaps the seat and the cost, which is the kind of
 * bug that only shows up as a wrong board halfway through a draft.
 */
function replay(parts) {
  const picks = [];
  for (const record of parts.slice(1)) {
    const [overallText, rest] = splitOnce(record, '=');
    if (rest == null) continue;
    const [playerId, teamId, cost] = rest.split(',');
    const pick = makePick(overallText, playerId, teamId, null, cost);
    if (pick) picks.push(pick);
  }
  // A draft that has not started sends `P` with nothing after it. That is an
  // empty replay, not a failure, so it comes back as an empty list.
  return { kind: 'picks', picks };
}

/** `0|<overall>|<player>|<team>|<rosterSlot>|<cost>` — one pick, as it happens. */
function live(parts) {
  const pick = makePick(parts[1], parts[2], parts[3], parts[4], parts[5]);
  if (!pick) return null;
  return { kind: 'pick', pick };
}

/**
 * One pick, however it arrived.
 *
 * A pick with no overall number or no player is dropped rather than kept with a
 * zero in it: a slot claimed by nobody is worse on a board than a slot left for
 * the next frame to fill.
 */
function makePick(overall, playerId, teamId, rosterSlot, cost) {
  const at = int(overall);
  const player = String(playerId ?? '').trim();
  if (at <= 0 || !player) return null;
  return {
    overall: at,
    // Kept as text. It is a key into Yahoo's own pool and never arithmetic.
    playerId: player,
    teamId: int(teamId),
    // The slot the pick filled, flex included as `W/R/T`. Absent from a replay.
    rosterSlot: rosterSlot ? String(rosterSlot) : null,
    // Observed as `0` in every snake draft watched. Presumably an auction
    // price, which this app does not run. Inferred and untested.
    cost: int(cost),
  };
}

/** Split on the first separator only, so a value containing one survives. */
function splitOnce(text, sep) {
  const at = String(text).indexOf(sep);
  if (at < 0) return [text, null];
  return [String(text).slice(0, at), String(text).slice(at + sep.length)];
}

function int(value) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
