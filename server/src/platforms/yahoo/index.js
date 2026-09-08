// Yahoo, read through the user's own browser rather than through an API.
//
// Every other platform here is pulled: the service asks an open feed. Yahoo is
// pushed, because the endpoints its draft room uses authenticate on a session
// cookie and refuse anything without one. A userscript in the user's tab reads
// the room and posts to `/api/yahoo/room/:id`; the methods below answer from
// what it posted. See `DECISIONS.md` for why that is the shape, and
// `docs/yahoo-draft-protocol.md` for what the room actually sends.
//
// The consequence worth stating plainly: nothing here works until the bridge is
// running. A Yahoo league is not readable by this service on its own, and every
// method below says so rather than answering with an empty league.
//
// One thing here travels the other way. `putQueue` takes the queue the app
// wants set and resolves it to Yahoo's own player ids, for the bridge to send.
// It is the only write to a league platform in this project, it happens only
// when the user turns it on, and it never sends a pick.

import { buildBoard } from '../../board.js';
import { joinKey, normPos, normTeam } from '../../names.js';
import {
  applyPost, getAdvice, getRoom, queuePlan, roundCount, setAdvice, setWanted, teamCount,
} from './room.js';
import { bridgeStatus } from '../../bridge.js';

/**
 * A Yahoo league ID as the draft room writes it: bare digits.
 *
 * Not the `461.l.123456` league key the Fantasy Sports API uses. That API is
 * the one this project applied for and does not use; the room addresses its own
 * league as a plain number, and that is the number a user can see in their own
 * URL. Bounded because it is a key into memory that anyone reaching the service
 * can name.
 */
const IS_ID = /^\d{1,12}$/;

/** The room, or a refusal that says what to do about it. */
function roomFor(leagueId) {
  const room = getRoom(leagueId);
  if (!room) {
    throw new Error(
      'Nothing has been posted for that Yahoo league yet. Open your draft room '
      + 'with the bridge userscript installed; see docs/yahoo-draft-protocol.md.',
    );
  }
  return room;
}

/**
 * The draft settings a room can actually prove.
 *
 * Far less than Sleeper's, and the gap is honest rather than filled in. The
 * seat count, the round count and the draft type are all read from frames that
 * were observed. The roster shape and the scoring rules are not: they live
 * behind `settings/nfl/<league>`, which no capture has ever opened, and a
 * roster invented here would import a league that is not the user's.
 */
export async function importLeague(leagueId) {
  const room = roomFor(leagueId);
  const teams = teamCount(room);
  const rounds = roundCount(room);
  const warnings = [];

  warnings.push('Yahoo does not put the roster shape or the scoring rules in the '
    + 'draft room, so both are left as you set them. Check them against your league.');
  if (!rounds) {
    warnings.push('The draft order has not been sent yet, so the number of rounds '
      + 'is unknown. It arrives when the draft room opens.');
  }
  if (room.settings && !room.settings.type) {
    warnings.push('This draft runs an order this app has not seen before ('
      + room.settings.typeLetter + '). It is run as a snake.');
  }

  return {
    id: String(leagueId),
    // The league and the draft are the same thing to Yahoo. There is no second
    // identifier to carry, so the draft routes take the league ID.
    draftId: String(leagueId),
    previousLeagueId: null,
    isKeeper: false,
    maxKeepers: 0,
    name: 'Yahoo league ' + leagueId,
    season: null,
    status: room.settings?.started ? 'in_season' : 'pre_draft',
    teams: teams || 12,
    rounds: rounds || 15,
    // Null rather than a default. The client keeps what the user set, and a
    // roster invented here would look exactly like one that had been read.
    roster: null,
    scoring: null,
    draftType: room.settings?.type === 'linear' ? 'linear' : 'snake',
    rosterPositions: [],
    receptionPoints: 0,
    warnings,
  };
}

/**
 * The seats, as people.
 *
 * Yahoo has no user identifier separate from the seat: the team number in the
 * room URL is both who you are and where you sit, which is why a Yahoo user
 * never has to be asked which seat is theirs. So the seat number stands in as
 * the user ID, and `slotByUser` below is the identity mapping rather than a
 * lookup. That is not a placeholder; it is what Yahoo's model actually is.
 */
export async function leagueUsers(leagueId) {
  const room = roomFor(leagueId);
  return [...room.seats.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([teamId, seat]) => ({
      userId: String(teamId),
      name: seat.manager || seat.name || 'Manager',
      teamName: seat.name,
    }));
}

/** Whether the draft has opened, and who sits where. */
export async function draftState(leagueId) {
  const room = roomFor(leagueId);
  const teams = teamCount(room);
  const rounds = roundCount(room);
  const made = room.picks.size;
  const total = teams * rounds;

  const slotByUser = {};
  for (const teamId of room.seats.keys()) slotByUser[String(teamId)] = teamId;
  // Before the seats arrive the order still names every seat, so the draft is
  // readable from it alone. A seat with no name is better than no seat.
  if (!room.seats.size && room.order) {
    for (const teamId of new Set(room.order)) slotByUser[String(teamId)] = teamId;
  }

  const complete = total > 0 && made >= total;
  const started = !!room.settings?.started || made > 0;

  return {
    draftId: String(leagueId),
    status: complete ? 'complete' : (started ? 'drafting' : 'pre_draft'),
    type: room.settings?.type || 'snake',
    started,
    complete,
    rounds,
    teams,
    slotByUser,
    orderIsSet: !!room.order,
    // Which seat is the user's own, which Yahoo settles rather than leaves to
    // be worked out: the draft room address the bridge runs on names the team,
    // so the person watching is never in doubt about where they sit. Sleeper
    // has no equivalent and leaves this absent.
    mySeat: room.mySeat,
  };
}

/**
 * Everything the settings screen needs, from what the room could tell us.
 *
 * Two of Sleeper's answers come back empty here, and both are absences rather
 * than omissions. Nothing in the draft room declares a keeper, and nothing in
 * it lists a traded pick; the order in the `R|` frame already has both applied,
 * which is exactly why that order is read rather than derived.
 */
export async function leagueSetup(leagueId) {
  const room = roomFor(leagueId);
  const teams = teamCount(room);
  const draft = await draftState(leagueId);

  const slots = [];
  for (let slot = 1; slot <= teams; slot += 1) {
    const seat = room.seats.get(slot) || null;
    slots.push({
      slot,
      // Yahoo's seat is its own roster. There is no second identifier.
      rosterId: slot,
      userId: String(slot),
      manager: seat?.manager || null,
      name: seat?.name || seat?.manager || 'Team ' + slot,
      named: !!seat?.name,
    });
  }

  return {
    leagueId: String(leagueId),
    teams,
    slots,
    keepers: [],
    keepersDeclared: 0,
    tradedPicks: [],
    maxKeepers: 0,
    isKeeper: false,
    draft: { ...draft, startTime: null },
    namedTeams: slots.filter((s) => s.named).length,
  };
}

/**
 * Every pick so far, on this board.
 *
 * Two joins, in order. A Yahoo player ID means nothing to this board, so the
 * pool the bridge posted turns it into a name, a position and a team; then the
 * same `joinKey` the rest of the app uses turns that into a board player. The
 * normalisers already cover what Yahoo sends — `Jac` and `Was` are in the team
 * fixes, `K` passes through, and defences join on the team abbreviation — so
 * no matching code is needed here that did not already exist.
 */
export async function draftPicks(leagueId, boardQuery) {
  const room = roomFor(leagueId);
  // The same board the app is looking at, room ADP included. Built without it,
  // a board asked to price on the room would price on something else here, and
  // the picks would be resolved against a pool ordered differently from the one
  // on screen.
  const board = await buildBoard({ ...boardQuery, roomAdp: adpFromPool(room) });

  const byKey = new Map(board.players.map((p) => [p.key, p]));
  const teams = teamCount(room);

  const picks = [];
  const unknown = [];

  for (const pick of [...room.picks.values()].sort((a, b) => a.overall - b.overall)) {
    const person = room.pool.get(pick.playerId) || null;
    const name = person?.name || '';
    const position = normPos(person?.position);
    const team = normTeam(person?.team);

    let player = name ? byKey.get(joinKey(name, position, team)) || null : null;
    // A defence is named differently everywhere and joined on its team alone.
    if (!player && position === 'DEF' && team) player = byKey.get('DEF|' + team) || null;

    // A pick this board cannot place still owns its slot. Leaving it out would
    // put a hole in the board, and a board with a hole no longer lines up with
    // the room it is meant to mirror.
    if (!player) unknown.push({ name: name || 'Yahoo #' + pick.playerId, position, team });

    picks.push({
      overall: pick.overall,
      // Yahoo numbers picks and seats and leaves the round implied. Every draft
      // watched ran a full round before starting the next, so the round is the
      // pick number over the seat count.
      round: teams > 0 ? Math.ceil(pick.overall / teams) : 0,
      slot: pick.teamId,
      rosterId: pick.teamId,
      pickedBy: String(pick.teamId),
      // Yahoo's socket does not mark a keeper. A keeper league's keepers arrive
      // as ordinary picks, which is what the room shows its own users too.
      isKeeper: false,
      playerId: player ? player.id : 'off-yh-' + pick.playerId,
      offBoard: !player,
      name: player ? player.name : (name || 'Yahoo #' + pick.playerId),
      position: player ? player.position : (position || 'RB'),
      team: player ? player.team : team,
    });
  }

  return {
    picks,
    matched: picks.filter((p) => !p.offBoard).length,
    unknown,
    poolSize: board.players.length,
    roomAdp: roomAdp(room, byKey),
    // What Yahoo says is queued, on the same beat as the picks because it
    // changes on the same events and asking twice would be two answers to one
    // question. Null until the room has said, which is not the same as empty.
    queue: roomQueue(room, byKey),
    /*
     * Whether this service still holds what the app asked to be queued.
     *
     * The same reading `readAdvice` names `queue.state`, sent here because this
     * is the beat the app is already listening on. It is the app's half of
     * `needQueue` in `room.js`: a service restarted mid-draft is told the
     * picks, the pool and the last `Q|` again by the bridge, and nothing tells it
     * the wanted list, which exists nowhere but the app. `off` while the app is
     * writing a queue is that disagreement, and the app answers it by saying
     * the list again.
     */
    queueState: queuePlan(leagueId).reason,
  };
}

/**
 * Yahoo's own queue, as players this board holds.
 *
 * The same two joins the picks take. A queued player the board cannot place
 * keeps his place in the list with no id: he is still occupying a slot in the
 * real queue, and dropping him here would make the count on screen disagree
 * with the count in the room.
 */
function roomQueue(room, byKey) {
  if (room.queue == null) return null;
  return room.queue.map((yahooId) => {
    const person = room.pool.get(yahooId) || null;
    const name = person?.name || '';
    const position = normPos(person?.position);
    const player = name || position === 'DEF'
      ? byKey.get(joinKey(name, position, normTeam(person?.team))) || null
      : null;
    return {
      id: player ? player.id : null,
      name: player ? player.name : (name || 'Yahoo #' + yahooId),
    };
  });
}

/**
 * Yahoo's own ADP, keyed the way `names.js` keys everybody.
 *
 * The same join the picks take, run over the whole pool rather than over the
 * players already gone. It is what lets the room be read as how Yahoo drafts
 * rather than how Sleeper and Fantasy Football Calculator do, and it cannot be
 * fetched here: Yahoo answers a session cookie, so it arrives from the bridge
 * or not at all.
 *
 * Keyed rather than identified because a board has to be built before it can
 * hand out ids, and this is one of the things a board can now be built from.
 * `joinKey` already reduces a defence to its team, which is the only join that
 * works when nobody agrees what to call one, so nothing here is special-cased.
 *
 * Only the few hundred Yahoo reports a pick for appear. Anyone it has no
 * reading on is left out rather than carried as a null, because a feed with no
 * opinion about a player should not be voting on him.
 */
function adpFromPool(room) {
  const out = new Map();
  for (const person of room.pool.values()) {
    if (person.adp == null) continue;
    const position = normPos(person.position);
    // A defence joins on its team and never on its name, so it needs no name to
    // be placed. Anyone else without one has nothing to join on at all.
    if (!person.name && position !== 'DEF') continue;
    out.set(joinKey(person.name || '', position, normTeam(person.team)), person.adp);
  }
  return out.size ? out : null;
}

/**
 * The pool the other way round: how this app keys a player, to Yahoo's own id.
 *
 * The join every other read here runs, reversed, because writing a queue needs
 * to go from a player the board named to the number Yahoo will accept. Built
 * from the same `joinKey` for the same reason: one place decides when two
 * records name the same person, and this is not a second one.
 *
 * Where two Yahoo entries key the same, the first wins. That is a pool with a
 * duplicate in it rather than a real choice, and picking either is better than
 * queueing both.
 */
function idsByKey(room) {
  const out = new Map();
  for (const [id, person] of room.pool) {
    const position = normPos(person.position);
    if (!person.name && position !== 'DEF') continue;
    const key = joinKey(person.name || '', position, normTeam(person.team));
    if (!out.has(key)) out.set(key, id);
  }
  return out;
}

/** The same reading for a league nobody has necessarily posted. */
export function roomAdpByKey(leagueId) {
  const room = getRoom(leagueId);
  return room ? adpFromPool(room) : null;
}

/** And against the ids a built board hands out, which is what the client wants. */
function roomAdp(room, byKey) {
  const out = [];
  for (const [key, adp] of adpFromPool(room) || []) {
    const player = byKey.get(key);
    if (player) out.push({ id: player.id, adp });
  }
  return out;
}

/**
 * Whether a room has been posted for this league yet, and how much of it.
 *
 * The one question here whose ordinary answer is "not yet", and so the one that
 * reports rather than refuses. Every other method throws for a league nobody
 * has posted, because asking what a draft has taken when no draft was ever
 * opened is a mistake worth saying out loud. Waiting is not a mistake: a mock
 * hands out its league number in the lobby minutes before the draft room tab
 * exists, so the app asks this on a beat until the answers turn true.
 *
 * All three are evidence rather than description. The seat is written only by a
 * post from the bridge, so it means a room is being watched now; the order
 * arrives in the same connect burst as the settings, so it means the handshake
 * landed and the seat and round counts an import reads are Yahoo's own; and the
 * pool arrives on its own schedule, so whether this room can price a board is a
 * third thing again.
 *
 * That last one is here because a board reports the feeds it could have used as
 * of the moment it was built, and a room turns up after that as often as before
 * it: the bridge starts after the app, or a restarted service is sent the pool
 * again mid-draft. Without something to watch, the room feed stays greyed out
 * for the rest of the session while a live draft runs behind it.
 */
export async function roomState(leagueId) {
  const room = getRoom(leagueId);
  return {
    orderIsSet: !!room?.order,
    mySeat: room?.mySeat ?? null,
    // The same reading the board is offered, asked the same question: a room
    // whose pool carries no ADP at all cannot price one, and saying it could
    // would send the app back for a board that is no different.
    pricesBoard: !!(room && adpFromPool(room)),
    // Which userscript is feeding this room. It rides on the state the app
    // already polls rather than a check of its own, because a version nobody
    // asks for is a version nobody sees. See `server/src/bridge.js`.
    bridge: bridgeStatus(room?.bridge, !!room?.bridgeSeen, room?.updatedAt),
  };
}

/**
 * Take one post from the bridge in the user's browser.
 *
 * The only way into this platform, and the only route in the service that is
 * written to rather than read from. It holds nothing but what the tab sent: the
 * pool and the seats once, then socket frames as they arrive. The reply says
 * what is still missing, so a service restarted mid-draft is told to ask for
 * the pool again instead of resolving every later pick to nobody.
 */
export async function ingest(leagueId, body) {
  return applyPost(leagueId, body);
}

/**
 * Hand the board's current reading of the room to whoever asks for it.
 *
 * The bridge shows this in the draft room so a pick can be made without
 * looking away, and the service is only the pigeonhole: the app writes, the
 * bridge reads, and nothing here works any of it out. That split is the point.
 * The engine that prices a pick lives in the client and is not worth a second
 * implementation on this side, where it would drift from the first.
 */
export async function putAdvice(leagueId, advice) {
  const held = setAdvice(leagueId, advice);
  if (!held) throw new Error('No draft room has been posted for that league yet.');
  return { ok: true };
}

/**
 * What the app last said about this room, or nothing when it has not spoken.
 *
 * The queue rides alongside it because the panel that reads this is the one
 * thing standing over the draft where a write would land, and a write nobody
 * can see is the kind worth being able to see. It carries the state and the
 * counts rather than the players: the list is the user's own queue and the room
 * they are looking at is already showing it.
 */
export async function readAdvice(leagueId) {
  const plan = queuePlan(leagueId);
  const room = getRoom(leagueId);
  return {
    advice: getAdvice(leagueId),
    // Which userscript is feeding this room, so the app can show it and say so
    // when it is behind. Null until something has posted. See `bridge.js`.
    bridge: bridgeStatus(room?.bridge, !!room?.bridgeSeen, room?.updatedAt),
    queue: {
      // `off`, `first` or `ready`. The panel says which, because `first` is the
      // write that replaced a queue nobody had read, and saying so afterwards is
      // the only place that can be said over the room it happened in.
      state: plan.reason,
      held: plan.queue ? plan.queue.length : 0,
      writing: plan.write ? plan.write.length : 0,
    },
  };
}

/**
 * Take the queue the app wants written, and resolve it to Yahoo's own ids.
 *
 * The one thing this project sends to a league platform, and the reason the
 * resolution happens here rather than in the bridge is the reason the decode
 * does: the pool and `names.js` are both on this side, and a bridge that
 * matched players would put the fragile half of the job where no test can reach
 * it. See `DECISIONS.md`.
 *
 * A player the pool cannot place is dropped and counted rather than guessed at.
 * Queueing the wrong person is worse than queueing one fewer, because the
 * wrong person is who gets drafted when the clock runs out.
 */
export async function putQueue(leagueId, body) {
  const room = roomFor(leagueId);

  if (!body || body.queue == null) {
    setWanted(leagueId, null);
    return { ok: true, wanted: 0, unresolved: [] };
  }

  const byKey = idsByKey(room);
  const ids = [];
  const unresolved = [];
  for (const player of Array.isArray(body.queue) ? body.queue : []) {
    const name = String(player?.name || '');
    const position = normPos(player?.position);
    const team = normTeam(player?.team);
    const id = byKey.get(joinKey(name, position, team));
    if (id) ids.push(id);
    else unresolved.push(name || 'a player with no name');
  }

  setWanted(leagueId, { ids, priority: body.priority });
  // Reported rather than swallowed. A queue quietly one player shorter than the
  // one on screen is the kind of difference nobody notices until a clock runs
  // out on the player who was dropped.
  return { ok: true, wanted: ids.length, unresolved };
}

export default {
  id: 'yahoo',
  label: 'Yahoo',
  ingest,
  roomState,
  putAdvice,
  readAdvice,
  putQueue,
  roomAdpByKey,
  isValidId: (id) => IS_ID.test(id),
  idHint: 'A Yahoo league ID is the number in your draft room address.',
  importLeague,
  leagueUsers,
  leagueSetup,
  draftState,
  draftPicks,
};
