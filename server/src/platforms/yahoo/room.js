// What a Yahoo draft room has told us, held in memory and nowhere else.
//
// Sleeper is pulled: the service asks an open feed whenever the client wants to
// know something. Yahoo cannot be, because every endpoint the draft room uses
// authenticates on the browser's session cookie and refuses anything without
// one. So Yahoo is pushed instead — a userscript in the user's own tab reads
// the room and posts here, and this file is where that arrives.
//
// Deliberately never written to disk. `server/src/cache.js` exists for upstream
// feeds that are the same for everybody and expensive to fetch; this is one
// person's league, mid-draft, and a cached copy would be both stale on arrival
// and a second copy of their draft sitting in a file. It lives as long as the
// process and no longer, which is also why losing it is survivable: Yahoo
// replays every pick on connect, so a bridge that is asked to start again can.
//
// Bounded at both ends. Anything able to reach the service can name a league,
// so the number of rooms, the size of a pool and the number of frames in one
// post are all capped rather than left for the caller to decide.

import { noteBridge } from '../../bridge.js';
import { decodeFrame } from './frames.js';

/** Rooms kept at once. A person drafts in one league at a time. */
const MAX_ROOMS = 8;
/** Yahoo's pool was 1195 entries. This leaves room without leaving it open. */
const MAX_POOL = 5000;
/** A whole 16 team, 20 round draft is 320 picks. One post never needs more. */
const MAX_FRAMES = 1000;
/** Lines of advice held for the bridge to show. A panel nobody reads past. */
const MAX_ADVICE_ROWS = 5;
/** Names to fall back on when the pick goes first. The app sends three. */
const MAX_ADVICE_ALTS = 5;
/** Characters kept from one field of it. Everything here is a name or a count. */
const MAX_ADVICE_TEXT = 120;
/**
 * How deep a queue the app will ever write.
 *
 * A queue is insurance against a clock running out, and fifteen is more picks
 * than anyone is away for. It is also a bound on something a request can name,
 * which is the reason it is a constant rather than a judgement.
 */
const MAX_QUEUE = 15;
/** Players the app may ask for. Larger than the above, which does the merging. */
const MAX_WANTED = 40;

/** leagueId to room. Insertion order is eviction order; see `touch`. */
const rooms = new Map();

/**
 * A number Yahoo actually reported, or null.
 *
 * Yahoo writes these as strings, and writes a player it has no reading on as
 * `0` or an empty string rather than leaving the field out. Zero is not a pick
 * anyone made, so it is absence and is stored as such: a nought here would
 * otherwise read as the first overall selection.
 */
function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function blank(leagueId) {
  return {
    leagueId,
    /** Yahoo player id to the person, as the pool named them. */
    pool: new Map(),
    /** Seat number to what that seat is called. Seat number is the team id. */
    seats: new Map(),
    /** Seat per overall pick, straight from the `R|` frame. Never derived. */
    order: null,
    settings: null,
    /** Overall pick number to the pick. A map, so a replayed pick overwrites
     *  rather than duplicating: the same pick arrives live and again in the
     *  `P|` catch-up whenever a tab reconnects. */
    picks: new Map(),
    /** The seat the person running the bridge sits in, from the room URL. */
    mySeat: null,
    /**
     * What the board on this machine currently makes of the room.
     *
     * Written by the app, read by the bridge, and never computed here. The
     * engine that works this out lives in the client and stays there; this is
     * a pigeonhole between two things that cannot address each other directly,
     * because the draft tab and the app tab are different origins.
     */
    advice: null,
    /**
     * The queue Yahoo says it holds, from the last `Q|` frame.
     *
     * Null until one has arrived, which is not the same as empty: null is a
     * room that has never said, and an empty array is one that has said it
     * holds nothing. Nothing can ask — a `Q|` only ever answers a change — so
     * null persists until the queue is written or edited. `queuePlan` treats it
     * as empty and reports that it did.
     */
    queue: null,
    /** What the app wants queued, already resolved to Yahoo ids. */
    wanted: null,
    /**
     * Which copy of the userscript is posting, as it describes itself.
     *
     * Null is two different things, so `bridgeSeen` keeps them apart: a room
     * nothing has posted to knows of no bridge at all, while a room being
     * posted to by something that sends no identity is being posted to by a
     * copy older than the stamp. That second case is the one that cost a
     * session on 2026-09-07. See `server/src/bridge.js`.
     */
    bridge: null,
    bridgeSeen: false,
    updatedAt: 0,
  };
}

/**
 * Move a room to the back of the queue and drop the oldest if we are over.
 *
 * A Map iterates in insertion order, so deleting and re-setting a key is what
 * makes the first entry the least recently used one.
 */
function touch(leagueId, room) {
  rooms.delete(leagueId);
  rooms.set(leagueId, room);
  while (rooms.size > MAX_ROOMS) {
    const oldest = rooms.keys().next().value;
    rooms.delete(oldest);
  }
}

/** The room for a league, or null when nothing has been posted for it. */
export function getRoom(leagueId) {
  return rooms.get(String(leagueId)) || null;
}

/**
 * Fold one post from the bridge into the room, and say what is still missing.
 *
 * The pool and the seats are sent once and kept; the frames arrive continuously.
 * If the service was restarted mid-draft the pool is gone, and the reply says
 * so, so the bridge sends it again rather than the picks resolving to nobody.
 */
export function applyPost(leagueId, body) {
  const id = String(leagueId);
  const room = rooms.get(id) || blank(id);

  if (Number(body?.team) > 0) room.mySeat = Number(body.team);

  // Recorded before anything can throw, so a post that fails halfway still
  // counts as a bridge having spoken. Silence is the signal being read here.
  room.bridgeSeen = true;
  noteBridge(body?.bridge);
  if (body?.bridge && typeof body.bridge === 'object') {
    room.bridge = {
      version: String(body.bridge.version ?? '').slice(0, 32) || null,
      build: String(body.bridge.build ?? '').slice(0, 64) || null,
    };
  }

  // The pool is the only thing here that maps a pick to a person, so it is
  // replaced wholesale rather than merged: a partial pool would resolve some
  // picks and silently leave holes for the rest.
  if (Array.isArray(body?.pool) && body.pool.length) {
    room.pool = new Map();
    for (const entry of body.pool.slice(0, MAX_POOL)) {
      const playerId = String(entry?.id ?? '').trim();
      if (!playerId) continue;
      room.pool.set(playerId, {
        // Yahoo carries the full forename in the feed even though the room
        // shows `C. Olave`. That matters: the name matching needs three shared
        // opening letters and would reject an initial against the full name.
        name: `${entry.fname || ''} ${entry.lname || ''}`.trim(),
        position: String(entry.display_pos || '').trim(),
        team: String(entry.team_abbr || '').trim(),
        // What Yahoo's own drafters do, which no feed this service can reach
        // will tell it. Absent for anyone Yahoo has no reading on, which is
        // most of the pool: it reports an ADP for the few hundred that get
        // drafted and a rank for everybody.
        adp: positive(entry.adp),
        rank: positive(entry.rank),
      });
    }
  }

  if (Array.isArray(body?.seats) && body.seats.length) {
    room.seats = new Map();
    for (const seat of body.seats) {
      const teamId = Number(seat?.id);
      if (!(teamId > 0)) continue;
      room.seats.set(teamId, {
        name: String(seat.teamname || '').trim() || null,
        manager: String(seat.manager || '').trim() || null,
      });
    }
  }

  const frames = Array.isArray(body?.frames) ? body.frames.slice(0, MAX_FRAMES) : [];
  for (const frame of frames) {
    const decoded = decodeFrame(frame);
    if (!decoded) continue;
    if (decoded.kind === 'settings') room.settings = decoded;
    if (decoded.kind === 'order') room.order = decoded.order;
    if (decoded.kind === 'pick') room.picks.set(decoded.pick.overall, decoded.pick);
    // The room's own account of the queue, and the only one there is. It
    // replaces rather than merges, because that is what the frame means.
    if (decoded.kind === 'queue') room.queue = decoded.queue;
    if (decoded.kind === 'picks') {
      for (const pick of decoded.picks) {
        // A replayed pick carries no roster slot. Keeping the live one where we
        // already have it means a reconnect never blanks what was known.
        const had = room.picks.get(pick.overall);
        room.picks.set(pick.overall, had?.rosterSlot ? { ...pick, rosterSlot: had.rosterSlot } : pick);
      }
    }
  }

  room.updatedAt = Date.now();
  touch(id, room);

  const plan = queuePlan(id);

  return {
    ok: true,
    // The bridge resends the pool when this is true, which is what makes a
    // service restart mid-draft cost nothing.
    needPool: room.pool.size === 0,
    needSeats: room.seats.size === 0,
    picks: room.picks.size,
    pool: room.pool.size,
    seats: room.seats.size,
    orderKnown: !!room.order,
    // The queue to write, in the reply to the post that carried the frames. It
    // rides here rather than on a poll of its own because the bridge is already
    // talking on this beat, and a second channel to the same tab is a second
    // thing to go wrong. Null means write nothing, whether that is because the
    // user has not asked for one or because the room has not said what it holds.
    queue: plan.write,
    // A service restarted mid-draft has forgotten the queue, and Yahoo only
    // reports one when it changes. Saying so lets the bridge send back the last
    // it saw, exactly as it resends the pool.
    needQueue: room.queue == null,
  };
}

/** One field of advice, trimmed to something a panel can show. */
function text(value) {
  return String(value ?? '').slice(0, MAX_ADVICE_TEXT);
}

/**
 * Hold what the app worked out, for the bridge to collect.
 *
 * A room has to exist already. The app only ever has advice about a draft it
 * is following, and refusing to create one here means this route cannot be
 * used to fill the room table with leagues nobody is drafting.
 */
export function setAdvice(leagueId, advice) {
  const room = rooms.get(String(leagueId));
  if (!room) return false;

  const rows = Array.isArray(advice?.rows) ? advice.rows.slice(0, MAX_ADVICE_ROWS) : [];
  const alts = Array.isArray(advice?.alternates)
    ? advice.alternates.slice(0, MAX_ADVICE_ALTS)
    : [];
  const pick = advice?.pick;
  const source = advice?.source;
  room.advice = {
    onClock: !!advice?.onClock,
    pickLabel: text(advice?.pickLabel),
    lean: advice?.lean ? text(advice.lean) : null,
    // Null is a real answer here, not a missing one: the app says nothing when
    // the top two are close enough that naming one would invent a decision.
    pick: pick ? {
      name: text(pick.name),
      position: text(pick.position),
      worth: Number(pick.worth) || 0,
      // What his next turn is still expected to bring once he is taken. The
      // two added together are what the pick was chosen on.
      nextTurn: Number(pick.nextTurn) || 0,
      fillsStarter: !!pick.fillsStarter,
    } : null,
    // Who the pick is instead, once the name above has gone. Kept beside it
    // rather than inside it because the pick is null far more often than these
    // are interesting, and a panel that has one has both.
    alternates: alts.map((alt) => ({
      name: text(alt?.name),
      position: text(alt?.position),
      worth: Number(alt?.worth) || 0,
    })),
    // Anything but a room reading is read off ADP, including a malformed one.
    source: source?.kind === 'room'
      ? { kind: 'room', sims: Number(source.sims) || 0 }
      : { kind: 'adp' },
    rows: rows.map((row) => ({
      position: text(row?.position),
      name: text(row?.name),
      worth: Number(row?.worth) || 0,
      cost: Number(row?.cost) || 0,
      odds: Number(row?.odds) || 0,
      beforeCliff: Number(row?.beforeCliff) || 0,
    })),
    at: Date.now(),
  };
  return true;
}

/** What the app last worked out, or null when it has said nothing yet. */
export function getAdvice(leagueId) {
  return rooms.get(String(leagueId))?.advice || null;
}

/**
 * Hold the queue the app wants written, already resolved to Yahoo's own ids.
 *
 * The resolution happens in `index.js`, where the pool and `names.js` are, so
 * nothing here has to know what a player is called. This stores ids and an
 * order, and `queuePlan` below turns them into the list to send.
 *
 * Passing null is how the app says it no longer wants a queue written, which is
 * what turning the setting off does. It does not clear the queue in Yahoo: what
 * is already there is the user's, and abandoning it is not the same as deleting
 * it.
 */
export function setWanted(leagueId, wanted) {
  const room = rooms.get(String(leagueId));
  if (!room) return false;
  room.wanted = wanted
    ? {
      ids: wanted.ids.slice(0, MAX_WANTED),
      // Anything but Yahoo's order means the app's, including a malformed one.
      priority: wanted.priority === 'yahoo' ? 'yahoo' : 'app',
    }
    : null;
  room.updatedAt = Date.now();
  return true;
}

/**
 * The queue to send, or why there is not one.
 *
 * Three answers:
 *
 *   - `off`, when the app has asked for nothing. The bridge stays a reader.
 *   - `first`, when the app has asked but the room has never reported a queue.
 *     What is sent replaces whatever was in it, unseen.
 *   - `ready`, once a `Q|` has said what the room holds, after which the two
 *     lists merge and nothing on either side is dropped.
 *
 * `first` used to be a refusal, on the reasoning that `S|` replaces the whole
 * list and a write made in ignorance of it is a deletion. That reasoning was
 * sound and the conclusion was still wrong, though not for the reason recorded
 * here at the time, which was that nothing can read a Yahoo queue. That is
 * false: the connect burst carries one, arriving bare when the queue is empty,
 * observed twice on 2026-09-07 in league `10893050` by a recorder attached
 * before the room loaded. Every capture that missed it began after the socket
 * was already open. See `docs/yahoo-draft-protocol.md` and `DECISIONS.md`.
 *
 * So `first` should be rare, and means the bridge attached late rather than
 * that the queue is unknowable. It was not rare in testing because the browser
 * was running bridge 1.0.0, whose filter is `/^(?:0|H|R|P)(?:\||$)/` and drops
 * every `Q` before it leaves the page. Nothing here needs changing for that,
 * but whether `first` should still write in ignorance is worth revisiting now
 * that it is a narrow case rather than the ordinary one.
 *
 * Also recorded at the time: an empty queue appears to drop a seat straight
 * into autodraft. Nothing since supports it. Every drop watched has followed a
 * clock expiring unpicked, which accounts for all of them without the queue
 * coming into it at all.
 *
 * What survives of the caution: an empty list is never the answer here, so a
 * queue is never replaced by nothing. Turning the setting on with nothing
 * starred writes nothing at all.
 *
 * Drafted players are dropped from both sides. Yahoo prunes its own list and
 * never reports it, so a queue read off `Q|` still names players who are long
 * gone; sending them back would be asking for a player nobody can have.
 */
export function queuePlan(leagueId) {
  const room = rooms.get(String(leagueId));
  if (!room || !room.wanted) {
    return { write: null, queue: room?.queue ?? null, reason: 'off' };
  }

  const gone = new Set();
  for (const pick of room.picks.values()) gone.add(pick.playerId);

  const mine = room.wanted.ids;
  // Null is a room that has never said. Treated as empty to merge against,
  // which is what makes the write happen; `reason` below keeps the difference
  // so the app can say which of the two it is doing.
  const theirs = room.queue || [];
  const first = room.wanted.priority === 'yahoo' ? theirs : mine;
  const second = room.wanted.priority === 'yahoo' ? mine : theirs;

  const write = [];
  const seen = new Set();
  for (const id of [...first, ...second]) {
    if (gone.has(id) || seen.has(id)) continue;
    seen.add(id);
    write.push(id);
    if (write.length >= MAX_QUEUE) break;
  }

  return { write, queue: room.queue, reason: room.queue == null ? 'first' : 'ready' };
}

/** How many seats the room has, by the most reliable evidence it holds. */
export function teamCount(room) {
  if (room.seats.size) return room.seats.size;
  // The order names every seat once per round, so the highest is the count.
  if (room.order?.length) return Math.max(...room.order);
  if (room.picks.size) return Math.max(...[...room.picks.values()].map((p) => p.teamId));
  return 0;
}

/** How many rounds, from the order Yahoo sent rather than from a roster. */
export function roundCount(room) {
  const teams = teamCount(room);
  if (!teams || !room.order?.length) return 0;
  return Math.floor(room.order.length / teams);
}

/** Only for the self-test, which needs a room it did not have to draft for. */
export function resetRooms() {
  rooms.clear();
}
