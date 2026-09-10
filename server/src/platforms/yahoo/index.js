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
//
// `putSnapshot` and `getSnapshot` are the same arrangement for a league in
// season rather than a draft: a bookmarklet on the league page reads what the
// service cannot and posts it, and `league.js` does the reading of it. Separate
// from the room entirely, because a draft and a season share no state.

import { buildBoard } from '../../board.js';
import { joinKey, normPos, normTeam } from '../../names.js';
import {
  applyPost, getAdvice, getRoom, queuePlan, roundCount, setAdvice, setWanted, teamCount,
} from './room.js';
import { bridgeStatus } from '../../bridge.js';
import { getSnapshot, listSnapshots, putSnapshot } from './league.js';
import { joinLeague, resolveSlots } from './inSeason.js';
import { fetchPlayerPool, fetchReference } from '../../sources/yahooPlayers.js';
import {
  COMPONENTS_SUPPLIED as SLEEPER_SUPPLIES, fetchSleeperWeek,
} from '../../sources/sleeperProjections.js';
import {
  COMPONENTS_SUPPLIED as ESPN_SUPPLIES, fetchEspnWeek,
} from '../../sources/espnProjections.js';
import { scoreRoster, unsupportedRules } from './scoring.js';
import { lineupAdvice, startingSeats } from '../../lineup.js';

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
 * The league in season, joined to the feeds that describe its players.
 *
 * "Not yet" rather than a refusal when nothing has been read, on the same
 * reading `getSnapshot` and `roomState` give: the app asks this before the user
 * has clicked the bookmarklet, which is the ordinary course of events.
 *
 * EACH FEED ANSWERS FOR ITSELF, so one that fails does not take the league with
 * it. The league is the thing being shown here and it is already in hand — it
 * came from the browser, not from a feed — so a pool that will not come costs
 * the injuries and the ownership percentages and nothing else. What it must not
 * do is come back looking like a league whose players are all fine, which is why
 * `joinLeague` leaves an unjoined player's `pool` null rather than empty, and why
 * the age and the failure of every feed are reported beside the answer.
 */
export async function readSeason(leagueId, boardQuery) {
  const held = getSnapshot(leagueId);
  if (!held.read) return { read: false, league: null, feeds: null, hint: held.hint };

  const asked = (work) => work.then(
    (value) => ({ value, error: null }),
    (err) => ({ value: null, error: String(err.message || err) }),
  );

  const [pool, vocabulary, board] = await Promise.all([
    asked(fetchPlayerPool()),
    asked(fetchReference('rosterPositions')),
    asked(buildBoard(boardQuery)),
  ]);

  /*
   * A FEED THAT FAILED IS PASSED AS NULL, NOT AS AN EMPTY LIST.
   *
   * `?? []` was the first version and it is the bug Y8.4 exists to catch: an
   * empty pool joins to nobody, so every rostered player came back reported as
   * one Yahoo has never heard of. That reads as a finding about the league
   * rather than as a fetch that failed, and the same mistake on the vocabulary
   * blamed the league for having slots this app cannot read.
   */
  const league = joinLeague({
    snapshot: held.snapshot,
    pool: pool.value ? pool.value.players : null,
    vocabulary: vocabulary.value ? vocabulary.value.rosterPositions : null,
    board: board.value ? board.value.players : null,
  });

  return {
    read: true,
    snapshot: held.snapshot,
    league,
    // Per feed rather than one age for the lot, because they are fetched apart
    // and a screen that showed the newest of them would be reporting the age of
    // whichever happened to refresh last.
    feeds: {
      league: { fetchedAt: held.snapshot.readAt, stale: false, error: null },
      pool: feedAge(pool, pool.value?.meta),
      vocabulary: feedAge(vocabulary, vocabulary.value?.meta),
      board: feedAge(board, board.value?.meta),
    },
  };
}

/**
 * The week's lineup advice for the user's own team.
 *
 * The one route in this project that recommends anything about a real league,
 * and every limit on it is carried in the answer rather than left for a screen
 * to remember. `lineup.js` does the calculation, `scoring.js` turns each desk's
 * components into this league's points, and this fetches and joins.
 *
 * ONE LINEUP PER DESK, NEVER A BLENDED ONE, which is Y9.0's finding and not a
 * preference: averaging the two desks showed a player at 13.0 where they said
 * 15.29 and 10.75, which is a start reported as a sit. So both are computed and
 * a seat they fill differently comes back disputed.
 *
 * THE WEEK IS THE SNAPSHOT'S OWN, not today's. A roster is a lineup for a week
 * -- `selected_position` is what the user has set for the week the browser read
 * -- so advising on a different week would compare this week's lineup against
 * next week's projection and call the difference an improvement. A caller may
 * ask for another week explicitly; nothing infers one.
 */
export async function readLineup(leagueId, { week: wanted } = {}) {
  const held = getSnapshot(leagueId);
  if (!held.read) return { read: false, advice: null, feeds: null, hint: held.hint };

  const snapshot = held.snapshot;
  const own = (snapshot.rosters || []).find((roster) => roster.teamKey === snapshot.ownTeamKey);

  /*
   * NO OWN ROSTER IS A REFUSAL, NOT AN EMPTY LINEUP. Advice about a team this
   * app cannot identify is advice about somebody else's team, and the guid
   * match that identifies it is the thing Y7.1 established precisely so a seat
   * number would never be guessed at. A reader too old to send every roster
   * lands here, which is why the reason names the reader.
   */
  if (!own) {
    return {
      read: true,
      advice: null,
      feeds: null,
      week: null,
      error: snapshot.readerBehind
        ? 'The installed reader sent only one roster and not the one it could name as yours. '
          + 'Reinstall it from the league page and read the league again.'
        : 'No roster in this snapshot matched your Yahoo account, so there is no lineup to advise on.',
    };
  }

  const week = Number(wanted) || own.week || snapshot.week?.current || null;
  if (!week) {
    return {
      read: true,
      advice: null,
      feeds: null,
      week: null,
      error: 'This snapshot does not say which week its roster is for, so nothing can be projected.',
    };
  }

  const year = Number(snapshot.season) || new Date().getFullYear();

  const asked = (work) => work.then(
    (value) => ({ value, error: null }),
    (err) => ({ value: null, error: String(err.message || err) }),
  );

  const [sleeper, espn, vocabulary] = await Promise.all([
    asked(fetchSleeperWeek({ year, week })),
    asked(fetchEspnWeek({ year, week })),
    asked(fetchReference('rosterPositions')),
  ]);

  /*
   * A DESK THAT FAILED IS PASSED AS NULL, on the same reasoning Y8.4 recorded
   * for the pool: `?? new Map()` would report every player on the roster as one
   * nobody projected, which reads as a finding about the roster rather than as
   * a fetch that failed, and would then refuse to advise on a full lineup while
   * looking as though it had.
   */
  const scored = (desk, players) => scoreRoster({
    players,
    scoring: snapshot.scoring,
    byKey: desk.value ? desk.value.byKey : null,
  });
  const sleeperScored = scored(sleeper, own.players);
  const espnScored = scored(espn, own.players);

  /*
   * YAHOO AS A THIRD DESK, AND THE ONE THAT NEEDS NO SCORING.
   *
   * The other two publish components and `scoring.js` turns them into this
   * league's points. Yahoo's number arrives already scored under the league's
   * own rules -- it is what its roster page prints -- so it bypasses that
   * module entirely. That is not an oversight of the design the rest of this
   * file rests on; it is the one source for which the question the design
   * answers does not arise. It also means `unsupportedRules` has nothing to
   * report against it: a rule this league scores cannot be missing from a
   * total Yahoo computed itself.
   *
   * Null where the installed reader never scraped it, which is any copy older
   * than 2026-09-09, and null is how `lineupAdvice` is told a desk did not
   * answer rather than that it projected nobody.
   */
  const yahooFor = (roster) => {
    const held = snapshot.projections?.[roster.teamKey];
    if (!held) return null;
    const points = new Map();
    for (const player of roster.players) {
      const value = held[String(player.playerId)];
      if (typeof value === 'number') points.set(player.playerKey, value);
    }
    return points;
  };
  const yahooOwn = yahooFor(own);

  const slots = resolveSlots(snapshot.slots, vocabulary.value
    ? vocabulary.value.rosterPositions
    : null);

  const advice = lineupAdvice({
    slots,
    players: own.players,
    sources: { sleeper: sleeperScored.points, espn: espnScored.points, yahoo: yahooOwn },
    // Nothing known about locks, and said so rather than assumed. Yahoo
    // publishes no kickoff time at any scope and ESPN's is not read yet, so
    // `locksKnown` comes back false and the screen has to say so.
    locked: null,
    week,
  });

  /*
   * EVERY TEAM'S WEEK, NOT ONLY THE USER'S.
   *
   * A weekly decision is about the league and not about one roster: what the
   * team you are playing is projected to score is the number that says whether
   * a lineup is good enough, and who is startable on somebody else's bench is
   * what a waiver or a trade is judged against. The reader already sends every
   * roster, so the only thing missing was scoring them.
   *
   * SCORED THROUGH `lineupAdvice` AND NOT THROUGH A SECOND SUM, which is the
   * whole reason this reuses the function above rather than adding up points
   * here. A rival's total has to mean exactly what the user's own total means
   * or the comparison is between two different measurements -- same exclusion
   * of the seats no desk projects, same refusal to invent a zero for a player
   * on bye. Its `moves` and `disputed` are computed and dropped, which costs
   * nothing measurable on a roster of this size and buys that guarantee.
   */
  const yahooProjected = new Map();
  for (const matchup of snapshot.matchups ?? []) {
    for (const team of matchup.teams) {
      if (team.teamKey) yahooProjected.set(team.teamKey, team.projectedPoints);
    }
  }

  const teams = (snapshot.rosters ?? []).map((roster) => {
    const bySleeper = scored(sleeper, roster.players);
    const byEspn = scored(espn, roster.players);
    const yahooPoints = yahooFor(roster);
    const its = lineupAdvice({
      slots,
      players: roster.players,
      sources: { sleeper: bySleeper.points, espn: byEspn.points, yahoo: yahooPoints },
      locked: null,
      week,
    });

    // A desk that did not answer is absent rather than zero, exactly as it is
    // for the user's own team. `lineupAdvice` keys `desks` only by what
    // answered, so this reads that rather than assuming both did.
    const totalsFor = (name) => {
      const desk = its.desks[name];
      return desk ? { now: desk.currentPoints, best: desk.points } : null;
    };

    /*
     * TWO YAHOO NUMBERS THAT ARE NOT THE SAME NUMBER, and keeping them apart is
     * the point. `yahoo` is the desk: the roster page's per-player figures,
     * seated and totalled exactly as the other two desks are, so it has a best
     * lineup like theirs. `yahooPublished` is what the scoreboard says the team
     * is projected at, which Yahoo computed itself.
     *
     * They ought to agree, and a screen showing both is the only cross-check
     * this project has on a scrape of a page with no contract. Folding them
     * into one field would throw that away and would quietly prefer whichever
     * happened to be there.
     */
    const published = yahooProjected.get(roster.teamKey);

    return {
      teamKey: roster.teamKey,
      points: Object.fromEntries(roster.players.map((player) => [player.playerKey, {
        sleeper: bySleeper.points ? bySleeper.points.get(player.playerKey) ?? null : null,
        espn: byEspn.points ? byEspn.points.get(player.playerKey) ?? null : null,
        yahoo: yahooPoints ? yahooPoints.get(player.playerKey) ?? null : null,
      }])),
      totals: {
        sleeper: totalsFor('sleeper'),
        espn: totalsFor('espn'),
        yahoo: totalsFor('yahoo'),
        yahooPublished: published == null ? null : published,
      },
    };
  });

  /*
   * EVERY PLAYER, WITH BOTH DESKS' NUMBERS AND WHAT HE COULD FILL, because the
   * advice cannot be checked from the lineup alone. A screen that shows only
   * the recommended starters cannot answer the question a user actually asks,
   * which is why *not* the other one -- and the honest answer is often that the
   * obvious candidate is projected higher and is not eligible for the open
   * slot. Y9.3 has to demonstrate a superficially attractive move being
   * correctly rejected, and this is the data that demonstrates it.
   */
  const { seats } = startingSeats(slots);
  const roster = own.players.map((player) => {
    const eligible = new Set(player.positions?.length
      ? player.positions
      : [player.displayPosition].filter(Boolean));
    return {
      playerKey: player.playerKey,
      name: player.name,
      team: player.team,
      positions: player.positions,
      selectedPosition: player.selectedPosition,
      byeWeek: player.byeWeek,
      // Distinct slot names rather than seats: two RB seats are one answer to
      // "where could he play".
      fills: [...new Set(seats
        .filter((seat) => seat.accepts.some((position) => eligible.has(position)))
        .map((seat) => seat.slot))],
      points: {
        sleeper: sleeperScored.points ? sleeperScored.points.get(player.playerKey) ?? null : null,
        espn: espnScored.points ? espnScored.points.get(player.playerKey) ?? null : null,
        yahoo: yahooOwn ? yahooOwn.get(player.playerKey) ?? null : null,
      },
    };
  });

  return {
    read: true,
    week,
    teamKey: own.teamKey,
    editable: own.editable,
    advice,
    roster,
    /*
     * Every roster in the league, scored. The user's own is in here too, so a
     * caller needs no special case for it -- and it is the only place its
     * Yahoo projected total appears, since that comes off the scoreboard rather
     * than out of a desk.
     */
    teams,
    // Whom the user plays this week, or null where the installed reader is old
    // enough to have sent no scoreboard. Carried here as well as on the
    // snapshot so a screen showing the week's advice need not fetch the league.
    opponentTeamKey: snapshot.opponentTeamKey ?? null,
    /*
     * The rules this league scores that a desk cannot, per desk rather than per
     * player. A league scoring defensive touchdowns has no component behind it
     * on either desk, and a total that quietly dropped the rule would be the
     * right shape and the wrong number -- so the limit is stated beside the
     * advice it limits.
     */
    unsupported: {
      sleeper: unsupportedRules(snapshot.scoring, SLEEPER_SUPPLIES),
      espn: unsupportedRules(snapshot.scoring, ESPN_SUPPLIES),
      // Empty and not absent. Yahoo's number is this league's own points,
      // computed by Yahoo under its own rules, so no rule can be missing from
      // it -- which is a positive statement and not a gap in the answer.
      yahoo: [],
    },
    // Named, not counted, on the pattern Y8.4 set: a count says a join went
    // wrong and a name says who to go and look at.
    unprojected: {
      sleeper: sleeperScored.unmatched,
      espn: espnScored.unmatched,
      // Named the same way, and null where the reader never scraped a page:
      // a desk that did not answer has said nothing about anybody.
      yahoo: yahooOwn
        ? own.players.filter((p) => !yahooOwn.has(p.playerKey))
          .map((p) => p.name || p.playerKey || 'a player with no name')
        : null,
    },
    feeds: {
      league: { fetchedAt: snapshot.readAt, stale: false, error: null },
      sleeper: feedAge(sleeper, sleeper.value?.meta),
      espn: feedAge(espn, espn.value?.meta),
      vocabulary: feedAge(vocabulary, vocabulary.value?.meta),
    },
    /*
     * Sleeper dates each record rather than the week, and Y9.0 found a future
     * week comes back as a stale vintage inside a fresh fetch -- its own points
     * contradicting its own components by about two points at quarterback. A
     * fetch age cannot show that, so the oldest record's date rides along.
     */
    vintage: {
      sleeper: sleeper.value?.meta?.oldestRecordAt ?? null,
      desk: sleeper.value?.meta?.desk ?? null,
    },
  };
}

/** One feed's age and whether it answered, in the shape every feed reports. */
function feedAge(asked, meta) {
  return {
    fetchedAt: meta?.fetchedAt ?? null,
    stale: !!meta?.stale,
    error: asked.error,
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
  putSnapshot,
  getSnapshot,
  listSnapshots,
  readSeason,
  readLineup,
  isValidId: (id) => IS_ID.test(id),
  idHint: 'A Yahoo league ID is the number in your draft room address.',
  importLeague,
  leagueUsers,
  leagueSetup,
  draftState,
  draftPicks,
};
