// Sleeper's weekly projection, as components rather than as points.
//
// `sleeper.js` next door reads the same upstream for the draft board and takes
// `pts_half_ppr` off it, which is right there: a draft board wants one number
// per player in the format the room is using, and Sleeper publishes exactly
// that. In season it is the wrong field, for two reasons that only showed up
// when somebody looked.
//
// THE PUBLISHED COLUMN IS NOT THIS LEAGUE'S POINTS. Sleeper publishes three
// presets and the league read carried 38 scoring categories against 35
// modifiers. `pts_ppr` is one desk's projection under somebody else's rules, so
// reading it as the answer would quietly substitute Sleeper's scoring for the
// user's — and the two differ in ways that change advice, not just totals:
// Sleeper scores an interception at -1 where the observed league scored it
// differently again.
//
// AND IN A FUTURE WEEK THE PUBLISHED COLUMN CONTRADICTS THE RECORD IT SITS IN.
// Sleeper refreshes the current week and leaves later weeks on an older
// vintage. Inside that older vintage the points disagree with the record's own
// components by about 2.2 points for a quarterback, where the current week
// agrees to 0.02. Computing from components is therefore not only more correct
// about the league, it is more correct about the feed.
//
// So nothing here reads a `pts_` column at all, and `last_modified` is carried
// per record rather than per response, because the staleness is per record.

import { cached } from '../cache.js';
import { joinKey, normTeam } from '../names.js';
import { SCOREABLE_POSITIONS, checkComponents } from './components.js';
import { draftablePosition } from './sleeper.js';

const BASE = 'https://api.sleeper.app/projections/nfl';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * Six hours, matching the other feeds.
 *
 * `PLAN.md` asks for hours and for the update time to be shown either way. The
 * age that matters is the one on the record, not the one on the fetch: a fresh
 * fetch of a stale week is still a stale projection, and only `last_modified`
 * says so.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** One request per position, so one position's timeout is not the whole week's. */
const TIMEOUT_MS = 30_000;

/**
 * Sleeper's component names against this project's.
 *
 * Only the components Y9.0 verified against Sleeper's own published points are
 * here. Sleeper publishes about seventy more — `rec_tgt`, the first-down
 * counts, the kicker distance buckets, the whole team-defence set — and every
 * one of them is left out on purpose. Their key names look self-explanatory,
 * which is exactly the trap: an attempt to recover Sleeper's kicker ruleset by
 * least squares fitted 32 kickers to within 0.008 while returning
 * `fgm_30_39: -0.29`, and the same method mis-recovered a running back's
 * `fum_lost` as -0.68 against its known -2. Twelve free parameters fit 32
 * points whatever they mean, so the fit verified nothing. A rule needing one of
 * those components reports as unsupported instead, which is true.
 */
const COMPONENT_BY_KEY = {
  pass_yd: 'passYd',
  pass_td: 'passTd',
  pass_int: 'passInt',
  pass_2pt: 'pass2pt',
  rush_yd: 'rushYd',
  rush_td: 'rushTd',
  rush_2pt: 'rush2pt',
  rec: 'rec',
  rec_yd: 'recYd',
  rec_td: 'recTd',
  rec_2pt: 'rec2pt',
  fum_lost: 'fumLost',
};

checkComponents(Object.values(COMPONENT_BY_KEY), 'sources/sleeperProjections.js');

/**
 * What this desk has an opinion about, for the scoring join to ask.
 *
 * Derived from the table above rather than written out again, because a list
 * kept by hand beside a mapping is a list that stops matching it. The scoring
 * join needs it to tell a rule this desk does not project from a rule it
 * projects at nothing, and those two must not read alike.
 */
export const COMPONENTS_SUPPLIED = Object.freeze(new Set(Object.values(COMPONENT_BY_KEY)));

/**
 * One record's components, or null if nobody projected him.
 *
 * A PLAYER WITH NO PROJECTION IS DROPPED, NOT SCORED ZERO, and the test for
 * which is the components themselves. Sleeper answers with its whole pool —
 * 3304 records for a week, of which 461 are really projected — so a reader that
 * kept them all would put three thousand players on a lineup screen at zero
 * points and rank them equal with a bye.
 *
 * `pts_ppr` would answer the same question and is deliberately not asked. It is
 * the field this module exists to avoid, and using it as a presence test would
 * make the projected set depend on a column whose value is not trusted. It was
 * checked rather than assumed: over a full week the two agree exactly, 461
 * records carrying both and 2843 carrying neither, with none carrying one
 * without the other.
 */
export function readComponents(stats) {
  if (!stats) return null;
  const components = {};
  let found = false;
  for (const [key, component] of Object.entries(COMPONENT_BY_KEY)) {
    const value = stats[key];
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
 * Pure, and separate from the fetch so the reading is checkable without a
 * network. The position a record is keyed at is the one `sleeper.js` already
 * settles for the draft board — a player filed off the roster is drafted at his
 * fantasy position — because two modules keying the same feed differently would
 * be two answers to "is this the same player".
 */
export function readWeek(list) {
  const byKey = new Map();
  const rows = [];
  for (const record of Array.isArray(list) ? list : []) {
    const player = record?.player || {};
    const position = draftablePosition(player);
    // Asked before the components, not after: a kicker has no projection this
    // can read whatever his record holds, so reading one and then discarding it
    // would only invite somebody to keep it. See SCOREABLE_POSITIONS.
    if (!position || !SCOREABLE_POSITIONS.has(position)) continue;

    const components = readComponents(record.stats);
    if (!components) continue;
    const name = [player.first_name, player.last_name].filter(Boolean).join(' ').trim();
    if (!name) continue;
    const team = normTeam(record.team || player.team || '');

    const row = {
      name,
      position,
      team,
      components,
      // Per record, not per response. See the note at the top of the file: a
      // future week is a stale vintage inside a fresh fetch.
      modifiedAt: Number(record.last_modified) || null,
      // Which desk, which Sleeper names itself and which is worth carrying:
      // the whole point of reading two sources is that they are two desks.
      desk: record.company || null,
    };
    rows.push(row);
    const key = joinKey(name, position, team);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return { byKey, rows };
}

/**
 * Sleeper's projection for one week, cached like the other public feeds.
 *
 * One request per position because that is the only way Sleeper answers, and
 * one cache key for the joined result so a week is fresh or stale as a whole
 * rather than six positions at six ages.
 */
export async function fetchSleeperWeek({ year, week, force = false }) {
  const entry = await cached(`sleeper_week_${year}_${week}`, MAX_AGE_MS, async () => {
    const responses = await Promise.all(POSITIONS.map(async (position) => {
      const url = `${BASE}/${year}/${week}?season_type=regular&position[]=${position}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Sleeper week ${week} returned ${res.status} for ${position}.`);
      return res.json();
    }));

    const merged = responses.flatMap((list) => (Array.isArray(list) ? list : []));
    const { rows } = readWeek(merged);
    // Nobody projected is a failed fetch rather than a week nobody has an
    // opinion about. On the same reasoning as ffc.js, this leaves whatever is
    // on disk in place rather than replacing it with an empty week.
    if (!rows.length) throw new Error(`Sleeper projected nobody for week ${week}.`);
    return rows;
  }, force);

  const rows = entry.value || [];
  const byKey = new Map();
  for (const row of rows) {
    const key = joinKey(row.name, row.position, row.team);
    if (!byKey.has(key)) byKey.set(key, row);
  }

  return {
    byKey,
    rows,
    meta: {
      source: 'Sleeper',
      sourceUrl: 'https://sleeper.com',
      // Rotowire, as Sleeper's own records say. Read off the data rather than
      // written in here, because it is the feed's claim and not this project's.
      desk: rows.find((row) => row.desk)?.desk ?? null,
      week: Number(week),
      year: Number(year),
      projected: rows.length,
      // The oldest record in the week, which is what a reader needs to know
      // before trusting it: a fresh fetch of a stale vintage is still stale.
      oldestRecordAt: rows.reduce(
        (at, row) => (row.modifiedAt && (at === null || row.modifiedAt < at) ? row.modifiedAt : at),
        null,
      ),
      fetchedAt: entry.fetchedAt,
      stale: !!entry.stale,
    },
  };
}
