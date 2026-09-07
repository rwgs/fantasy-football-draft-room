// Fantasy Football Calculator: the market ADP source.
//
// Free, no key, commercial use allowed, and it asks only for attribution.
// It is the primary source here for one reason no other free feed matches:
// it reports a separate ADP for each scoring format AND each league size, and
// it reports the standard deviation of every pick. That deviation is what the
// simulator uses to decide how far a computer team is willing to reach.
//
// Attribution: https://fantasyfootballcalculator.com

import { cached } from '../cache.js';
import { normPos, normTeam, joinKey } from '../names.js';

const BASE = 'https://fantasyfootballcalculator.com/api/v1/adp';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * How long one request may take before it is a hang rather than a slow feed.
 *
 * There was no bound at all, and a board is built behind these fetches: a
 * connection that opens and never answers held every rebuild of a live draft
 * for as long as the socket stayed up. The payload is forty kilobytes.
 */
const TIMEOUT_MS = 15_000;

/**
 * The formats this app offers.
 *
 * The service also publishes a rookie board. It is not listed here: it drew 37
 * drafts this window and returned zero players, and Sleeper's rookie ADP column
 * is empty for everybody. A format with no data behind it is worse than a
 * missing one, because the draft still runs and quietly means nothing.
 */
export const FORMATS = {
  standard: 'Standard',
  'half-ppr': 'Half PPR',
  ppr: 'PPR',
  '2qb': 'Superflex / 2QB',
  dynasty: 'Dynasty',
};

/** League sizes the service publishes. A draft of any size maps to one of these. */
export const SIZES = [8, 10, 12, 14];

/** Map any league size to the nearest size the service publishes. */
export function nearestSize(teams) {
  const n = Number(teams) || 12;
  return SIZES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), SIZES[0]);
}

export async function fetchAdp({ format, teams, year, force = false }) {
  const size = nearestSize(teams);
  const key = `ffc_${format}_${size}_${year}`;

  const entry = await cached(key, MAX_AGE_MS, async () => {
    const url = `${BASE}/${format}?teams=${size}&year=${year}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Fantasy Football Calculator returned ${res.status}`);
    const body = await res.json();
    if (body.status !== 'Success') throw new Error('Fantasy Football Calculator returned no data');
    /*
     * A SUCCESS THAT NAMES NOBODY IS A FAILED FETCH.
     *
     * Parsing cleanly was being read as having worked, so an empty players list
     * was cached over a usable copy and the board came back with nothing on it
     * and `stale: false` -- the one shape that says the numbers are current.
     * Throwing hands the decision to `cached`, which keeps yesterday's copy and
     * marks it stale, and only fails outright where there is no copy to keep.
     */
    if (!Array.isArray(body.players) || !body.players.length) {
      throw new Error('Fantasy Football Calculator returned no players');
    }
    return body;
  }, force);

  const body = entry.value;
  const players = (body.players || []).map((p) => ({
    key: joinKey(p.name, p.position, p.team),
    name: p.name,
    position: normPos(p.position),
    team: normTeam(p.team),
    bye: p.bye || null,
    adp: p.adp,
    adpFormatted: p.adp_formatted,
    // How much real drafts disagree about this player. Small for the top of
    // round one, large for a rookie nobody has settled on.
    stdev: p.stdev || null,
    high: p.high || null,
    low: p.low || null,
    timesDrafted: p.times_drafted || 0,
  }));

  return {
    players,
    meta: {
      source: 'Fantasy Football Calculator',
      sourceUrl: 'https://fantasyfootballcalculator.com',
      format,
      formatLabel: FORMATS[format] || format,
      adpLeagueSize: size,
      requestedLeagueSize: Number(teams) || 12,
      year: Number(year),
      totalDrafts: body.meta?.total_drafts ?? null,
      window: body.meta ? `${body.meta.start_date} to ${body.meta.end_date}` : null,
      fetchedAt: entry.fetchedAt,
      stale: !!entry.stale,
    },
  };
}
