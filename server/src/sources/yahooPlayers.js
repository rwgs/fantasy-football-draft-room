// Yahoo's public game scope: the player pool and the vocabularies it is written in.
//
// This is the half of Yahoo's API that needs no account. `/fantasy/v2/game/nfl/…`
// answers 200 with no cookie at all, while every `/fantasy/v2/league/…` path
// answers 401 — measured against the same league in the same minute, which is
// why the two halves are two different things in this project. The league stays
// in the browser and in memory; this is an ordinary feed, fetched by the service
// and cached on disk exactly as Fantasy Football Calculator, Sleeper and ESPN
// are. See `DECISIONS.md`, 2026-09-08, "The service fetches Yahoo's public half".
//
// What that buys, and it is most of what weekly advice needs to know about a
// player: the whole pool, injury status and detail, bye weeks, an ownership
// percentage carrying a weekly delta, and the stat and slot vocabularies a
// league's own settings have to be read against.
//
// Free, no key. Yahoo publishes no terms for this path because it does not
// document it; it is the same data its own league pages read.

import { cached } from '../cache.js';
import { flatten, listOf, pick, subResource, teamAbbr, toNumber } from '../yahooJson.js';

const BASE = 'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl';

/**
 * How long the pool stays fresh.
 *
 * Injury status is the fastest-moving thing in it and moves through the week
 * rather than by the minute, so six hours matches what `ffc.js` chose for the
 * same reason. `percent_owned` carries a weekly delta and moves slower still.
 */
const POOL_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The vocabularies change once a season, if that. */
const REFERENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** How long one request may take before it is a hang rather than a slow feed. */
const TIMEOUT_MS = 20_000;

/**
 * How many players to ask for at once.
 *
 * The official API documents a cap of 25. That is not what this path enforces:
 * 500 comes back in one response, so the 2888-player pool is six requests
 * rather than 116.
 */
const PAGE_SIZE = 500;

/**
 * How many pages to walk before calling it a runaway.
 *
 * The pool is six pages. This is not a tuning knob, it is the bound that stops
 * a paging bug becoming an endless loop against someone else's service, and
 * hitting it throws rather than returning what was collected so far. A
 * truncated pool is the dangerous failure here: Y8.4 has to guarantee that an
 * interrupted fetch cannot turn an owned player into an available one, and
 * silently returning half a pool is exactly how that would happen.
 */
const MAX_PAGES = 40;

/** Pull the named half out of a `game` resource, refusing anything else. */
function gameResource(body, name) {
  const game = pick(body?.fantasy_content ?? {}, 'game', `the ${name} response`);
  return subResource(game, name);
}

/**
 * One player, as the pool describes him.
 *
 * THE STATUS FIELDS ARE ABSENT, NOT EMPTY, WHEN THERE IS NOTHING TO REPORT.
 *
 * They arrive only when Yahoo has something to say: across the whole pool 1234
 * of 2888 players carry no status at all and 549 carry an `injury_note`. That
 * is not a partial response and not a shape change, so absence is normalised to
 * `null` here, once, rather than left for every caller to meet as an
 * `undefined`.
 *
 * WHAT IT IS NOT IS AN INJURY FLAG, which is worth writing down because reading
 * it as one is the obvious mistake and it is wrong for nearly half the pool.
 * Nine codes appear, and three are nothing to do with fitness:
 *
 *   Q     Questionable                    O      Out
 *   IR    Injured Reserve                 IR-R   Injured Reserve, to return
 *   PUP-R Physically Unable to Perform    NFI-R  Non-Football Injury (Reserve)
 *
 *   NA    Inactive: Coach's Decision or Not on Roster   1280 players, 44%
 *   SUSP  Suspended                                        7
 *   CEL   Reserve: Commissioner Exempt List                 3
 *
 * `NA` is most of the pool's deep end and means unrostered, not hurt. So this
 * reader carries the code through and derives nothing from it. Which codes make
 * a player unstartable is a question about a league's rules, and it belongs
 * where those are known rather than here.
 *
 * `eligible_positions` is kept whole and unnormalised, for the same reason.
 * Which of them a league can actually start is a question about that league's
 * slots, and joining the pool to a roster is Y8.2's job, not this reader's.
 */
function readPlayer(node) {
  const meta = flatten(node[0]);
  const owned = flatten(node[1]?.percent_owned);
  return {
    playerKey: pick(meta, 'player_key', 'a player'),
    playerId: String(meta.player_id ?? ''),
    name: meta.name?.full ?? null,
    team: teamAbbr(meta.editorial_team_abbr),
    displayPosition: meta.display_position ?? null,
    positionType: meta.position_type ?? null,
    positions: listOf(meta.eligible_positions).map((entry) => entry.position).filter(Boolean),
    byeWeek: toNumber(meta.bye_weeks?.week),
    // `||` and not `??`: an empty string is the same "nothing to report" as a
    // missing key, and reading the three of them two different ways is how one
    // player came out both flagged and unflagged at once.
    status: meta.status || null,
    statusFull: meta.status_full || null,
    injuryNote: meta.injury_note || null,
    percentOwned: toNumber(owned.value),
    // What the ownership percentage did over the last week. An ownership number
    // that is moving is the signal waiver advice wants; a static one is not.
    percentOwnedDelta: toNumber(owned.delta),
    percentOwnedWeek: toNumber(owned.week),
  };
}

/** Read one page of `players` into records. Pure, so the pager can be tested. */
export function readPlayers(body) {
  return listOf(gameResource(body, 'players'))
    .map((entry) => entry.player)
    .filter(Boolean)
    .map(readPlayer);
}

/**
 * Walk the pool to its end.
 *
 * `fetchPage(start, count)` answers one response body, so the network stays out
 * of here and the end condition is what gets checked.
 *
 * THE END OF A LIST IS A SHAPE CHANGE, WHICH IS WHY THIS COUNTS RECORDS.
 *
 * Everywhere else in this API a list is an object keyed by index with a `count`
 * beside it. Past the end of the pool it is a bare `[]`, so `.count` reads
 * `undefined` rather than zero and `undefined < PAGE_SIZE` is false — a pager
 * that trusted `count` would never stop. `count` is not dependable in the other
 * direction either: `game/nfl/roster_positions` answers 21 slots and no `count`
 * at all. So the number of records actually read is the only honest measure,
 * and it ends the walk on a short page and an empty one alike.
 */
export async function collectPlayers(fetchPage, { pageSize = PAGE_SIZE } = {}) {
  const players = [];
  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) {
      throw new Error(`Yahoo's player pool did not end after ${MAX_PAGES} pages of ${pageSize}.`);
    }
    const read = readPlayers(await fetchPage(page * pageSize, pageSize));
    players.push(...read);
    if (read.length < pageSize) return players;
  }
}

async function getJson(path, what) {
  const res = await fetch(`${BASE}/${path}${path.includes('?') ? '&' : '?'}format=json`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status} for ${what}.`);
  return res.json();
}

/**
 * The whole player pool, with ownership.
 *
 * A pool that names nobody is a failed fetch, not an empty league — the same
 * reading `ffc.js` arrived at the hard way. Throwing hands the decision to
 * `cached`, which keeps yesterday's copy and marks it stale.
 */
export async function fetchPlayerPool({ force = false } = {}) {
  const entry = await cached('yahoo_game_players', POOL_MAX_AGE_MS, async () => {
    const players = await collectPlayers((start, count) => getJson(
      `players;start=${start};count=${count};out=percent_owned`,
      'the player pool',
    ));
    if (!players.length) throw new Error('Yahoo returned no players.');
    return players;
  }, force);

  return { players: entry.value, meta: sourceMeta(entry) };
}

/**
 * The 21 roster slots, composites included.
 *
 * `displayName` is load-bearing rather than decoration: no entry carries an
 * eligible-set field, and a composite's display name is the single positions'
 * display names joined by a slash, which is how `platforms/yahoo/inSeason.js`
 * resolves one without a letter table. `positionType` is what separates a slot
 * holding a position from `BN` and `IR`, which carry none.
 */
export function readRosterPositions(body) {
  return listOf(gameResource(body, 'roster_positions'))
    .map((entry) => entry.roster_position ?? entry)
    .filter((slot) => slot && slot.position)
    .map((slot) => ({
      position: slot.position,
      abbreviation: slot.abbreviation ?? null,
      displayName: slot.display_name ?? null,
      positionType: slot.position_type ?? null,
    }));
}

/** The stat vocabulary a league's own `stat_modifiers` are written against. */
export function readStatCategories(body) {
  return listOf(gameResource(body, 'stat_categories').stats)
    .map((entry) => entry.stat)
    .filter((stat) => stat && stat.stat_id !== undefined)
    .map((stat) => ({
      statId: String(stat.stat_id),
      name: stat.name ?? null,
      displayName: stat.display_name ?? null,
      positionTypes: listOf(stat.position_types)
        .map((entry) => entry.position_type)
        .filter(Boolean),
    }));
}

/**
 * Week boundaries.
 *
 * These date a week; they do not time a kickoff. Lineup locks need a kickoff
 * time and Yahoo publishes none at any scope — `docs/in-season-data-sources.md`
 * records that ESPN is the only source that has one.
 */
export function readGameWeeks(body) {
  return listOf(gameResource(body, 'game_weeks'))
    .map((entry) => entry.game_week ?? entry)
    .filter((week) => week && week.week !== undefined)
    .map((week) => ({
      week: toNumber(week.week),
      displayName: week.display_name ?? null,
      start: week.start ?? null,
      end: week.end ?? null,
      current: week.current ?? null,
    }));
}

/**
 * The three reference lists, each cached under its own key.
 *
 * Separate keys rather than one, because Y8.3 shows how old each feed behind a
 * view is and a shared key could only report one age for all three.
 */
const REFERENCES = {
  rosterPositions: { path: 'roster_positions', read: readRosterPositions },
  statCategories: { path: 'stat_categories', read: readStatCategories },
  gameWeeks: { path: 'game_weeks', read: readGameWeeks },
};

export async function fetchReference(name, { force = false } = {}) {
  const spec = REFERENCES[name];
  if (!spec) throw new Error(`No such Yahoo reference list: ${name}.`);

  const entry = await cached(`yahoo_game_${spec.path}`, REFERENCE_MAX_AGE_MS, async () => {
    const read = spec.read(await getJson(spec.path, spec.path));
    if (!read.length) throw new Error(`Yahoo returned an empty ${spec.path}.`);
    return read;
  }, force);

  return { [name]: entry.value, meta: sourceMeta(entry) };
}

function sourceMeta(entry) {
  return {
    source: 'Yahoo Fantasy',
    sourceUrl: 'https://football.fantasysports.yahoo.com',
    fetchedAt: entry.fetchedAt,
    stale: !!entry.stale,
  };
}
