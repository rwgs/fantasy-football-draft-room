// Sleeper: season projections, injury status and a deeper player pool.
//
// Fantasy Football Calculator publishes roughly 230 players, which covers a
// 12 team draft of 15 rounds and nothing longer. Sleeper publishes a Rotowire
// season projection for roughly 640 players, so it both extends the pool past
// the end of the market board and supplies the points the draft grade needs.
//
// Free, no key. The endpoint returns every player at a position; only the ones
// that carry `pts_half_ppr` are really projected. The rest are not projected to
// play and are dropped, not scored as zero.

import { cached } from '../cache.js';
import { DRAFTABLE, normPos, normTeam, joinKey } from '../names.js';

const BASE = 'https://api.sleeper.app/projections/nfl';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** How long one position's request may take. See the note in ffc.js. */
const TIMEOUT_MS = 15_000;

/** Which projected points column each scoring format reads. */
const POINTS_FIELD = {
  standard: 'pts_std',
  'half-ppr': 'pts_half_ppr',
  ppr: 'pts_ppr',
  // 2QB is a roster shape, not a scoring rule. Half PPR is the common pairing.
  '2qb': 'pts_half_ppr',
  dynasty: 'pts_half_ppr',
  rookie: 'pts_half_ppr',
};

/**
 * Which Sleeper ADP column each scoring format reads.
 *
 * `adp_dynasty` looks like the right field for dynasty and is not: it holds the
 * 999 placeholder for every player Sleeper returns. The scored dynasty numbers
 * live in the per format columns, and `adp_dynasty_half_ppr` carries 476 of
 * them. `adp_rookie` is empty for everybody, which is why rookie drafts are not
 * offered at all rather than offered with nothing in them.
 */
export const ADP_FIELD = {
  standard: 'adp_std',
  'half-ppr': 'adp_half_ppr',
  ppr: 'adp_ppr',
  '2qb': 'adp_2qb',
  dynasty: 'adp_dynasty_half_ppr',
};

/**
 * Where to look when the chosen format has no ADP for a player.
 *
 * The columns are not equally populated. Half PPR carries 529 players, standard
 * carries 310. A tight end with a half PPR ADP and no standard one is not a
 * player who does not exist in standard leagues; he is a player nobody bothered
 * to record separately. Dropping him left real, rostered players off the board
 * and reported them to the user as names that matched nothing.
 *
 * Every column counts picks in the same units, so a borrowed number sits on the
 * same scale. The board records which column each ADP came from.
 */
const FALLBACK_ORDER = ['half-ppr', 'ppr', 'standard', '2qb', 'dynasty'];

export async function fetchProjections({ year, force = false }) {
  const rows = [];
  const ages = [];
  let stale = false;

  for (const pos of POSITIONS) {
    const entry = await cached(`sleeper_${year}_${pos}`, MAX_AGE_MS, async () => {
      const url = `${BASE}/${year}?season_type=regular&position%5B%5D=${pos}&order_by=pts_half_ppr`;
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Sleeper returned ${res.status} for ${pos}`);
      const body = await res.json();
      /*
       * One request per position, so an answer with nothing projected in it is
       * a position the board expects and cannot fill -- which is a failed
       * fetch, not a position nobody plays. Rows without `pts_half_ppr` are
       * dropped downstream as players not projected to play, so a payload of
       * only those would leave a whole position with market prices, no points,
       * no worth and no part in a grade. See the note in ffc.js for what
       * throwing buys.
       */
      if (!Array.isArray(body) || !body.some((rec) => rec?.stats?.pts_half_ppr != null)) {
        throw new Error(`Sleeper projected no ${pos} at all`);
      }
      return body;
    }, force);

    ages.push(entry.fetchedAt);
    stale = stale || !!entry.stale;
    for (const rec of entry.value || []) rows.push(rec);
  }

  /*
   * The oldest of the six, not the newest. Each position is its own cache key
   * and its own fetch, so they expire apart: reading the newest let a fresh
   * receiver list speak for a quarterback copy from yesterday, and the age
   * shown beside the board was the one component that had nothing wrong with
   * it. What the board is working from is the oldest thing in it.
   */
  return { rows, fetchedAt: Math.min(...ages), stale };
}

/**
 * The position a roster can hold this player at, or null if there is none.
 *
 * `position` is what a player is on the field and `fantasy_positions` is where
 * he can be drafted, and for a two-way player the two disagree: Travis Hunter
 * is filed as a DB with fantasy positions of DB and WR. Reading only the first
 * dropped his record, which left the WR row Fantasy Football Calculator had
 * already put on the board with no projected points at all.
 *
 * The points columns are the fantasy ones either way. His 65.6, 83.1 and 100.6
 * are one receiving projection read at three reception values -- each 17.5
 * apart, which is his 35 catches at half a point -- and not an IDP total, which
 * would be the same number in all three and would reflect his 31 tackles.
 *
 * Exported because `sleeperProjections.js` reads the same feed for the weekly
 * numbers and has to key it the same way. Two modules deciding this
 * differently would be two answers to whether a record is the same player.
 *
 * @param {object} player Sleeper's `player` record
 */
export function draftablePosition(player) {
  const primary = normPos(player.position);
  if (DRAFTABLE.has(primary)) return primary;
  for (const alt of player.fantasy_positions || []) {
    const pos = normPos(alt);
    if (DRAFTABLE.has(pos)) return pos;
  }
  return null;
}

/**
 * Turn the raw payload into one record per projected player, keyed for the join.
 * @param {object[]} rows
 * @param {string} format scoring format
 */
export function projectionMap(rows, format) {
  const pointsField = POINTS_FIELD[format] || 'pts_half_ppr';
  const adpField = ADP_FIELD[format] || 'adp_half_ppr';
  const out = new Map();

  for (const rec of rows) {
    const s = rec.stats || {};
    if (s.pts_half_ppr == null) continue; // Not projected to play.

    const p = rec.player || {};
    // Not just "has a position": one the engine can put in a roster slot. A
    // DB row joins as a different person from the same player's WR row.
    const position = draftablePosition(p);
    if (!position) continue;

    const team = normTeam(rec.team || p.team);
    const name = position === 'DEF'
      ? `${p.first_name || ''} ${p.last_name || ''}`.trim()
      : `${p.first_name || ''} ${p.last_name || ''}`.trim();

    // Sleeper parks unranked players at 999. That is a placeholder, not a pick.
    const read = (field) => {
      const v = s[field];
      return v != null && v < 900 ? v : null;
    };

    let adp = read(adpField);
    let adpFrom = adp != null ? format : null;
    if (adp == null) {
      for (const other of FALLBACK_ORDER) {
        if (other === format) continue;
        const borrowed = read(ADP_FIELD[other]);
        if (borrowed != null) {
          adp = borrowed;
          adpFrom = other;
          break;
        }
      }
    }

    const record = {
      key: joinKey(name, position, team),
      sleeperId: String(rec.player_id),
      name,
      position,
      team,
      points: Number(s[pointsField] ?? s.pts_half_ppr ?? 0),
      gamesProjected: Number(s.gp ?? 0),
      sleeperAdp: adp,
      sleeperAdpFrom: adpFrom,
      injuryStatus: p.injury_status || null,
      yearsExp: p.years_exp ?? null,
    };

    // Sleeper ships duplicate person records. The better projection wins.
    const prior = out.get(record.key);
    if (!prior || record.points > prior.points) out.set(record.key, record);
  }

  return out;
}
