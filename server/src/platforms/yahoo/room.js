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

import { decodeFrame } from './frames.js';

/** Rooms kept at once. A person drafts in one league at a time. */
const MAX_ROOMS = 8;
/** Yahoo's pool was 1195 entries. This leaves room without leaving it open. */
const MAX_POOL = 5000;
/** A whole 16 team, 20 round draft is 320 picks. One post never needs more. */
const MAX_FRAMES = 1000;
/** Lines of advice held for the bridge to show. A panel nobody reads past. */
const MAX_ADVICE_ROWS = 5;
/** Characters kept from one field of it. Everything here is a name or a count. */
const MAX_ADVICE_TEXT = 120;

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
  room.advice = {
    onClock: !!advice?.onClock,
    pickLabel: text(advice?.pickLabel),
    lean: advice?.lean ? text(advice.lean) : null,
    rows: rows.map((row) => ({
      position: text(row?.position),
      name: text(row?.name),
      cost: Number(row?.cost) || 0,
      odds: Number(row?.odds) || 0,
    })),
    at: Date.now(),
  };
  return true;
}

/** What the app last worked out, or null when it has said nothing yet. */
export function getAdvice(leagueId) {
  return rooms.get(String(leagueId))?.advice || null;
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
