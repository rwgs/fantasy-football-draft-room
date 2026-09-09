// ESPN's weekly projection, as components rather than as points.
//
// The second desk. `espnRanks.js` next door takes ESPN's editorial draft rank
// off a season-scope request; this takes its weekly stat projection, which is a
// different view of the same season path and a genuinely separate opinion from
// Sleeper's Rotowire numbers. Keeping both and showing the spread is the
// 2026-09-08 decision, and Y9.0 measured what that spread is: a median 1.22
// points on the players either desk would start, with the two reversing the
// order of a pair below about three points of separation.
//
// Free, no key, and the same cost `espnRanks.js` records: ESPN ignores every
// limit in the filter and answers with its player universe, which for a week
// with the stat view attached is about eighteen megabytes. Fetched once and
// cached; what is kept is the dozen components per player.
//
// THE TRAP IN THIS FEED IS `seasonId`, and it is not a rare edge. ESPN returns
// LAST season's weekly projection beside this one, under the same
// `scoringPeriodId`, on 896 of 1036 players. Only `seasonId` separates them, so
// a reader taking the first match gets a coin flip: Jahmyr Gibbs answers 18.42
// and 22.50 for the same week 1 query. Everything else about the two rows is
// identical in shape, which is why this cannot be caught downstream — a wrong
// but plausible projection looks exactly like a right one.

import { cached } from '../cache.js';
import { joinKey } from '../names.js';
import { SCOREABLE_POSITIONS, checkComponents } from './components.js';

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

/** Six hours, matching `espnRanks.js` and the other feeds. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Long, because this is the largest response the service fetches. Twice what
 * `espnRanks.js` allows, which is already twice what the small feeds get.
 */
const TIMEOUT_MS = 60_000;

const POSITION_BY_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

const TEAM_BY_ID = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

/**
 * A projection rather than an actual, for one week rather than a season.
 *
 * ESPN files every reading of a player in one `stats` list and distinguishes
 * them only by these three fields, so all three are conditions and not one of
 * them is decoration. `statSourceId: 1` is a projection where `0` is what
 * happened; `statSplitTypeId: 1` is a single week where `0` is the season.
 */
const PROJECTED = 1;
const BY_WEEK = 1;

/**
 * ESPN's stat ids against this project's components.
 *
 * Read off ESPN's own `scoringItems` for `leaguedefaults/3` rather than guessed
 * at, and then confirmed a second way: for each id, the median ratio between
 * ESPN's value and the Sleeper component naming the same quantity, over players
 * both desks project. Passing yards came out at 0.986 of Sleeper's, receiving
 * yards 0.991, receptions 0.980 — two desks measuring one quantity, not two
 * quantities that happen to correlate. That second check matters because
 * correlation alone cannot tell them apart: inside a position group every stat
 * correlates above 0.95 with every other, since they all scale with volume.
 *
 * The kicker and team-defence ids are deliberately absent. ESPN publishes no
 * name for any id, its `scoringItems` gives those ids either 0 points or the
 * same 6 as four other ids, and Sleeper's counterparts could not be verified
 * either. So they are the one thing this file will not do: put a number in
 * front of the user that rests on a guess about what a field means.
 */
const COMPONENT_BY_ID = {
  3: 'passYd',
  4: 'passTd',
  19: 'pass2pt',
  20: 'passInt',
  24: 'rushYd',
  25: 'rushTd',
  26: 'rush2pt',
  42: 'recYd',
  43: 'recTd',
  44: 'rec2pt',
  53: 'rec',
  72: 'fumLost',
  101: 'kickReturnTd',
  102: 'puntReturnTd',
};

checkComponents(Object.values(COMPONENT_BY_ID), 'sources/espnProjections.js');

/**
 * What this desk has an opinion about, for the scoring join to ask.
 *
 * Derived from the table above rather than written out again. The difference
 * from Sleeper's set is itself a finding worth keeping: ESPN projects the
 * return touchdowns its own PPR preset pays 6 for, and Sleeper projects none,
 * so a league scoring return touchdowns gets an answer from one desk and an
 * honest silence from the other.
 */
export const COMPONENTS_SUPPLIED = Object.freeze(new Set(Object.values(COMPONENT_BY_ID)));

/**
 * This season's projection for this week, out of the rows ESPN files together.
 *
 * The `seasonId` condition is the whole reason this is a named function. A
 * caller writing the other three conditions and forgetting this one gets a
 * plausible answer for a plausible-looking player and no indication at all, so
 * the filter is not left to callers to remember.
 */
export function weekRow(player, { year, week }) {
  const rows = (player?.stats || []).filter((row) => row
    && row.statSourceId === PROJECTED
    && row.statSplitTypeId === BY_WEEK
    && Number(row.scoringPeriodId) === Number(week)
    && Number(row.seasonId) === Number(year));
  return rows.find((row) => row.stats && Object.keys(row.stats).length) || null;
}

/** One row's components, or null if the row projects nothing this scores. */
export function readComponents(stats) {
  if (!stats) return null;
  const components = {};
  let found = false;
  for (const [id, component] of Object.entries(COMPONENT_BY_ID)) {
    const value = stats[id];
    if (value === undefined || value === null) continue;
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    components[component] = number;
    found = true;
  }
  return found ? components : null;
}

/**
 * A week of projections, keyed the way the rest of the app joins.
 *
 * Pure, and separate from the fetch, so the `seasonId` rule can be checked
 * against a body holding both seasons without eighteen megabytes of network.
 *
 * `appliedTotal` is carried and never used as the answer, for the same reason
 * Sleeper's `pts_ppr` is not: it is ESPN's own preset, which is not this
 * league's scoring. It is kept because it is what the scoring join is checked
 * against — components times ESPN's own modifiers must reproduce it — and a
 * check needs the number it is checking.
 */
export function readWeek(body, { year, week }) {
  const rows = [];
  for (const entry of body?.players || []) {
    const player = entry?.player;
    if (!player) continue;
    const position = POSITION_BY_ID[player.defaultPositionId];
    // Asked before the row, and this feed is the reason the rule exists: ESPN
    // files a return-touchdown projection against all 32 team defences, so a
    // reader keeping any row with any component put every defence on the board
    // holding two hundredths of a return touchdown. See SCOREABLE_POSITIONS.
    if (!position || !SCOREABLE_POSITIONS.has(position)) continue;

    const row = weekRow(player, { year, week });
    if (!row) continue;
    const components = readComponents(row.stats);
    if (!components) continue;

    const name = String(player.fullName || '').trim();
    if (!name) continue;

    rows.push({
      name,
      position,
      team: TEAM_BY_ID[player.proTeamId] || '',
      components,
      // ESPN's own preset, for the reproduction check and for nothing else.
      publishedTotal: Number(row.appliedTotal),
    });
  }

  const byKey = new Map();
  for (const row of rows) {
    const key = joinKey(row.name, row.position, row.team);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return { byKey, rows };
}

/**
 * ESPN's scoring for the preset this feed's published points are on.
 *
 * Not the league's scoring and never used as such. It is here so the check that
 * matters can run: components times these modifiers must reproduce the
 * `appliedTotal` ESPN publishes, which is what makes the id mapping above a
 * reading rather than an assertion. `pointsOverrides` is ignored, because an
 * override is per league and this is the default league.
 */
export function readOwnScoring(body) {
  const items = body?.settings?.scoringSettings?.scoringItems;
  const scoring = [];
  for (const item of Array.isArray(items) ? items : []) {
    const component = COMPONENT_BY_ID[item?.statId];
    if (!component || typeof item.points !== 'number') continue;
    scoring.push({ component, points: item.points });
  }
  return scoring;
}

/** ESPN's projection for one week, cached like the other public feeds. */
export async function fetchEspnWeek({ year, week, force = false }) {
  const entry = await cached(`espn_week_${year}_${week}`, MAX_AGE_MS, async () => {
    const url = `${BASE}/${year}/segments/0/leaguedefaults/3`
      + `?view=kona_player_info&view=mSettings&scoringPeriodId=${week}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        // Honoured for sorting but not for the limit, exactly as
        // `espnRanks.js` records. Sent so that the day it is honoured this
        // gets smaller rather than wrong.
        'x-fantasy-filter': JSON.stringify({
          players: { limit: 1500, sortPercOwned: { sortAsc: false, sortPriority: 1 } },
        }),
      },
    });
    if (!res.ok) throw new Error(`ESPN week ${week} returned ${res.status}.`);
    const body = await res.json();

    const { rows } = readWeek(body, { year, week });
    // Nobody projected is a failed fetch rather than a week with no opinions.
    if (!rows.length) throw new Error(`ESPN projected nobody for week ${week}.`);
    return { rows, ownScoring: readOwnScoring(body) };
  }, force);

  const rows = entry.value?.rows || [];
  const byKey = new Map();
  for (const row of rows) {
    const key = joinKey(row.name, row.position, row.team);
    if (!byKey.has(key)) byKey.set(key, row);
  }

  return {
    byKey,
    rows,
    ownScoring: entry.value?.ownScoring || [],
    meta: {
      source: 'ESPN',
      sourceUrl: 'https://fantasy.espn.com',
      desk: 'ESPN',
      week: Number(week),
      year: Number(year),
      projected: rows.length,
      fetchedAt: entry.fetchedAt,
      stale: !!entry.stale,
    },
  };
}
