/**
 * A Yahoo league snapshot, joined to the feeds that describe its players.
 *
 * `league.js` reads what the browser sent into a snapshot; this decides which
 * records in it are the same person as which records elsewhere. Two joins, and
 * they are not the same job, which is the whole reason this file exists:
 *
 *   1. To Yahoo's own player pool, EXACTLY, on `player_key`. All three Yahoo
 *      surfaces this project reads — the draft room, the league scope and the
 *      public game scope — write a player as `470.p.40059`, so there is nothing
 *      to match: the key either is the same key or it is not.
 *   2. To the cross-source board, through `names.js`, because Fantasy Football
 *      Calculator, Sleeper and ESPN have never heard of a Yahoo player id and
 *      the only thing three sources share is a name, a position and a team.
 *
 * Nothing here reaches the network. The caller fetches — `fetchPlayerPool` and
 * `fetchReference` for Yahoo's public half, `buildBoard` for the rest — and
 * hands the results in, so every rule below is checkable without one.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is score anybody, project anybody or
 * recommend anything. Phase 8 shows a league; the weekly calculation is a
 * separate module in a later phase and should not grow out of this one.
 */

import { joinKey } from '../../names.js';

/**
 * What each published slot accepts, read off the vocabulary rather than parsed.
 *
 * `/game/nfl/roster_positions` enumerates all 21 slots and the four composites
 * among them — `W/T`, `W/R`, `W/R/T`, `Q/W/R/T` — but it carries NO eligible-set
 * field. Measured: every entry holds `position`, `abbreviation`, `display_name`
 * and `position_type`, and that is all. So the set has to be derived, and there
 * are two ways to do it.
 *
 * The tempting one is a letter table: `W` is a receiver, `R` a back, `T` a tight
 * end, `Q` a quarterback. That is this project deciding what Yahoo's slots mean,
 * and it is wrong the first time Yahoo adds a composite whose letters this table
 * does not hold.
 *
 * The one taken here is Yahoo's own: a composite's `display_name` is the single
 * positions' `display_name`s joined by a slash. "Wide Receiver/Running Back/
 * Tight End" is exactly the display names of `WR`, `RB` and `TE`, so each part
 * is looked up in the same list it came from. Nothing about the position code is
 * read at all beyond noticing the slash that says it is a composite, and a new
 * composite resolves on its own as long as Yahoo goes on naming it that way.
 *
 * A composite whose parts do not all resolve is left out rather than half
 * answered. Half of a flex's eligible set would let a lineup check pass a player
 * who cannot fill the slot, which is worse than knowing nothing about it.
 */
export function slotAcceptance(vocabulary = []) {
  /*
   * Which entries in the list are positions at all, which Yahoo also answers
   * rather than leaving to be guessed: a position carries a `position_type` and
   * `BN` and `IR` do not. They sit in the same 21 alongside the real ones, so
   * without that test a bench slot comes out accepting a position called `BN`.
   */
  const singles = new Map();
  for (const slot of vocabulary) {
    if (!slot?.position || slot.position.includes('/') || !slot.positionType) continue;
    // First wins. A duplicated display name is a vocabulary with a duplicate in
    // it rather than a choice worth making.
    if (slot.displayName && !singles.has(slot.displayName)) {
      singles.set(slot.displayName, slot.position);
    }
  }

  const accepted = new Map();
  for (const slot of vocabulary) {
    if (!slot?.position) continue;
    if (!slot.position.includes('/')) {
      // A single position accepts itself. Bench and IR accept anybody and so
      // have no eligible set, which is a different answer from an empty one.
      if (slot.positionType) accepted.set(slot.position, [slot.position]);
      continue;
    }
    if (!slot.displayName) continue;
    const parts = slot.displayName.split('/').map((part) => part.trim());
    const resolved = parts.map((part) => singles.get(part));
    if (resolved.every(Boolean)) accepted.set(slot.position, resolved);
  }
  return accepted;
}

/**
 * The league's own slots, each carrying what it accepts.
 *
 * `starting` stays the league's answer, exactly as `league.js` read it — the
 * vocabulary says what a slot is for, and the league says whether it starts one.
 *
 * `unresolved` is asked only of a starting slot, because bench and IR take
 * anybody and there is nothing about them to resolve. Reporting them as
 * unresolved would put every ordinary league in the state reserved for a league
 * this app cannot read, and then the state would mean nothing.
 *
 * A NULL VOCABULARY IS A FEED THAT DID NOT ANSWER, and it is not the same thing
 * as one that answered and explained nothing. Without the distinction a failed
 * fetch reports every slot in an ordinary league as one this app cannot read,
 * which blames the league for the network. So nothing is claimed either way:
 * `accepts` is null as it must be, and `unresolved` is null rather than true.
 */
export function resolveSlots(slots = [], vocabulary = []) {
  if (vocabulary === null) {
    return slots.map((slot) => ({ ...slot, accepts: null, unresolved: null }));
  }
  const accepted = slotAcceptance(vocabulary);
  return slots.map((slot) => {
    const accepts = accepted.get(slot.position) ?? null;
    return { ...slot, accepts, unresolved: !!slot.starting && !accepts };
  });
}

/**
 * The same player on the cross-source board.
 *
 * EVERY ELIGIBLE POSITION IS TRIED, not the first one. A board row holds a
 * single position and the sources disagree about which it is: Yahoo lists eight
 * players as `WR,TE` or `RB,TE` where Sleeper and Fantasy Football Calculator
 * each pick one. `normPos` resolves that for the draft path by taking the first
 * of a pair, which is all a pick needs; here the whole list is in hand, so
 * throwing it away would miss a player for no reason a reader could guess.
 *
 * A defence needs no name, because `joinKey` reduces one to its team — the only
 * join that works when no two sources call a defence the same thing. Anyone
 * else with no name has nothing to join on at all, and a blank name would key
 * every nameless player to the same row.
 */
function boardMatch(player, byBoardKey) {
  const positions = player.positions?.length
    ? player.positions
    : [player.displayPosition].filter(Boolean);

  for (const position of positions) {
    if (!player.name && position !== 'DEF') continue;
    const found = byBoardKey.get(joinKey(player.name || '', position, player.team));
    if (found) return found;
  }
  return null;
}

/** Which of the league's starting slots this player may fill, by slot name. */
function fills(player, starting) {
  const eligible = new Set(player.positions ?? []);
  return starting
    .filter((slot) => slot.accepts.some((position) => eligible.has(position)))
    .map((slot) => slot.position);
}

/** How a player is named when the point is that a join missed him. */
const nameFor = (player) => player.name || player.playerKey || 'a player with no name';

/**
 * One roster, joined.
 *
 * THE TWO JOINS ARE NESTED RATHER THAN SPREAD, and that is the difference
 * between an honest answer and a plausible one. Spreading the pool's fields onto
 * the player leaves `status: null` meaning both "healthy" and "never found", and
 * those are not the same thing: the first is a fact about a player and the second
 * is a fact about this join. So a miss is `null` where the whole record would be,
 * and the player keeps his place in the roster either way.
 *
 * Each record is carried whole. Listing the interesting fields here would be a
 * third place to keep in step with two readers, and choosing what is interesting
 * about a player is not this file's job — saying which records are the same
 * person is.
 */
function joinRoster(roster, { byPlayerKey, byBoardKey, starting, ownTeamKey }) {
  const players = roster.players.map((player) => ({
    ...player,
    fills: fills(player, starting),
    pool: byPlayerKey ? byPlayerKey.get(player.playerKey) ?? null : null,
    board: byBoardKey ? boardMatch(player, byBoardKey) : null,
  }));

  /*
   * A JOIN THAT COULD NOT RUN REPORTS NEITHER A MATCH NOR A MISS.
   *
   * Null, not zero and not a list of every player. A feed that did not answer
   * has said nothing about anybody, so "0 of 17 matched" and a roster of names
   * under "not in the pool" are both false claims — and the plausible-looking
   * one is worse, because it reads as a league of players nobody has heard of
   * rather than as a fetch that failed. Null is not a number and not a list, so
   * a caller that prints it without checking prints something visibly wrong
   * instead of something quietly wrong.
   */
  const count = (has, held) => (held ? players.filter(has).length : null);
  const names = (has, held) => (held ? players.filter(has).map(nameFor) : null);

  return {
    ...roster,
    // Which roster is the user's own, answered by the guid the snapshot matched
    // against a manager and never by a position in the list. A seat number is
    // what the draft room has to fall back on; a league has an identity.
    own: !!ownTeamKey && roster.teamKey === ownTeamKey,
    players,
    matched: {
      pool: count((p) => p.pool, byPlayerKey),
      board: count((p) => p.board, byBoardKey),
      of: players.length,
    },
    // Named, not counted. A count says a join went wrong somewhere and a name
    // says where, which is the difference between a number to worry about and
    // a player to go and look at.
    unmatched: {
      pool: names((p) => !p.pool, byPlayerKey),
      board: names((p) => !p.board, byBoardKey),
    },
  };
}

/**
 * A snapshot, its slots resolved and every roster in it joined.
 *
 * THREE FEEDS, EACH OF WHICH MAY BE ABSENT, AND ABSENT IS ITS OWN ANSWER.
 *
 * `null` means the feed did not answer and nothing is claimed from it: the
 * counts go null, the misses go null, and `joined` says which joins actually
 * ran. `[]` means it answered with nothing, which is a real if unlikely state
 * and reports honestly as everybody missing. They default to `[]` rather than
 * null because that is the state before anything has been fetched, and it reads
 * as what it is.
 *
 * The distinction is the whole of this function's contribution to Y8.4: without
 * it a failed pool fetch reports every rostered player as one Yahoo has never
 * heard of, which looks like a finding rather than like a network error.
 */
export function joinLeague({ snapshot, pool = [], vocabulary = [], board = [] } = {}) {
  if (!snapshot) throw new Error('There is no snapshot to join.');

  const slots = resolveSlots(snapshot.slots, vocabulary);
  const starting = slots.filter((slot) => slot.starting && slot.accepts);

  const byPlayerKey = pool === null ? null : new Map();
  for (const player of pool ?? []) {
    if (player?.playerKey && !byPlayerKey.has(player.playerKey)) {
      byPlayerKey.set(player.playerKey, player);
    }
  }

  const byBoardKey = board === null ? null : new Map();
  for (const player of board ?? []) {
    if (player?.key && !byBoardKey.has(player.key)) byBoardKey.set(player.key, player);
  }

  const rosters = (snapshot.rosters ?? []).map((roster) => joinRoster(roster, {
    byPlayerKey, byBoardKey, starting, ownTeamKey: snapshot.ownTeamKey,
  }));

  const total = (part) => (rosters.every((r) => r.matched[part] !== null)
    ? rosters.reduce((n, r) => n + r.matched[part], 0)
    : null);

  return {
    slots,
    /*
     * The slots a lineup check must refuse to reason about, and null where the
     * vocabulary that would have explained them never arrived. An empty list is
     * a positive statement — every slot was explained — so it must not be what
     * a failed fetch produces.
     */
    unresolvedSlots: vocabulary === null
      ? null
      : slots.filter((slot) => slot.unresolved).map((slot) => slot.position),
    rosters,
    // Which joins ran at all, so a caller can tell a count of zero from no
    // count. Named for the feed rather than for the field, because that is the
    // thing that was or was not there.
    joined: { pool: pool !== null, vocabulary: vocabulary !== null, board: board !== null },
    // The league-wide totals, which is the number the manual comparison against
    // Yahoo is recorded as. Summed from the rosters rather than counted again,
    // so the parts cannot disagree with the whole.
    matched: {
      pool: total('pool'),
      board: total('board'),
      of: rosters.reduce((n, r) => n + r.matched.of, 0),
      rosters: rosters.length,
    },
  };
}
