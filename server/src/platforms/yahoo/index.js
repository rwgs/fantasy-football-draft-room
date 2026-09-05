// Yahoo, read through the user's own browser rather than through an API.
//
// Every other platform here is pulled: the service asks an open feed. Yahoo is
// pushed, because the endpoints its draft room uses authenticate on a session
// cookie and refuse anything without one. A userscript in the user's tab reads
// the room and posts to `/api/yahoo/room/:id`; these five methods answer from
// what it posted. See `DECISIONS.md` for why that is the shape, and
// `docs/yahoo-draft-protocol.md` for what the room actually sends.
//
// The consequence worth stating plainly: nothing here works until the bridge is
// running. A Yahoo league is not readable by this service on its own, and every
// method below says so rather than answering with an empty league.

import { buildBoard } from '../../board.js';
import { joinKey, normPos, normTeam } from '../../names.js';
import { applyPost, getAdvice, getRoom, roundCount, setAdvice, teamCount } from './room.js';

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
  const board = await buildBoard(boardQuery);

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
  };
}

/**
 * Yahoo's own ADP, against the ids this board uses.
 *
 * The same join the picks take, run over the whole pool rather than over the
 * players already gone. It is what lets the room be modelled on how Yahoo
 * drafts rather than on how Sleeper and Fantasy Football Calculator do, and it
 * cannot be fetched here: Yahoo answers a session cookie, so it arrives from
 * the bridge or not at all.
 *
 * Only the few hundred Yahoo reports a pick for appear. Anyone it has no
 * reading on is left out rather than sent as a null, because the client's job
 * is to compare the ones that exist, not to walk past the ones that do not.
 */
function roomAdp(room, byKey) {
  const out = [];
  for (const person of room.pool.values()) {
    if (person.adp == null) continue;
    const position = normPos(person.position);
    const team = normTeam(person.team);
    let player = person.name ? byKey.get(joinKey(person.name, position, team)) || null : null;
    if (!player && position === 'DEF' && team) player = byKey.get('DEF|' + team) || null;
    if (player) out.push({ id: player.id, adp: person.adp });
  }
  return out;
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

/** What the app last said about this room, or nothing when it has not spoken. */
export async function readAdvice(leagueId) {
  return { advice: getAdvice(leagueId) };
}

export default {
  id: 'yahoo',
  label: 'Yahoo',
  ingest,
  putAdvice,
  readAdvice,
  isValidId: (id) => IS_ID.test(id),
  idHint: 'A Yahoo league ID is the number in your draft room address.',
  importLeague,
  leagueUsers,
  leagueSetup,
  draftState,
  draftPicks,
};
