// The draft board: one row per player, built from both sources.
//
// WHICH ADP WINS
// Sleeper is the primary ADP. It covers roughly 530 players against Fantasy
// Football Calculator's 230, so a deep roster still has a real board in the
// last rounds instead of a tail of unranked names. Fantasy Football Calculator
// fills the gaps, and it supplies two things Sleeper does not publish at all:
// a standard deviation for every pick, and a separate ADP per league size.
//
// The caller picks the rule with `adpSource`:
//   sleeper  Sleeper first, Fantasy Football Calculator where Sleeper is blank.
//   ffc      Fantasy Football Calculator first, Sleeper where it is blank.
//   blend    The mean of the two, over whichever of them named a pick.
//
// HOW THEY JOIN
// Name plus position, with team defences on the team abbreviation. See names.js
// for why. The match rate is reported on every response, because a join that
// fails silently would just hand the simulator a shorter board.

import { fetchAdp, FORMATS, nearestSize } from './sources/ffc.js';
import { fetchProjections, projectionMap } from './sources/sleeper.js';

export { FORMATS, nearestSize };

export const ADP_SOURCES = {
  sleeper: 'Sleeper first',
  ffc: 'Fantasy Football Calculator first',
  blend: 'Mean of both',
};

/**
 * How much real drafts disagree about a player, in picks.
 *
 * Fantasy Football Calculator measures this. Sleeper does not, so a player it
 * alone ranks gets an estimate. The shape comes from the measured numbers: the
 * spread is about 11 per cent of the pick number, rising from under a pick at
 * the top of round one to roughly 18 picks around pick 175.
 *
 * The ceiling matters more than the slope. The deepest players on the Sleeper
 * board sit past pick 600, and an unbounded estimate would give them a spread
 * of seventy picks, which is how a player nobody drafts ends up in round two.
 * The widest spread ever measured across thousands of real drafts is 41 picks.
 */
const MAX_MEASURED_STDEV = 42;

function estimateStdev(adp) {
  return Math.min(MAX_MEASURED_STDEV, Math.max(1.5, adp * 0.11));
}

/**
 * How deep a real draft goes, in rounds.
 *
 * Past this a number is not a pick, because no draft makes one. Sleeper's board
 * runs to about pick 700, measured over its own deep and best ball drafts,
 * while Fantasy Football Calculator stops at about 230. So a player Fantasy
 * Football Calculator puts at 142 and Sleeper at 700 is not a player the two
 * disagree about by five hundred picks: one measured a pick, the other is
 * saying nobody takes him. Averaging those two gives 421, a number neither
 * source would recognise, and it lands the player outside every draft he was
 * actually in.
 *
 * Twenty rounds is past the end of almost every redraft league, so nothing
 * inside a draft is silenced by it. It is a fixed number of rounds rather than
 * this league's own because the board is built per league size and cached
 * there: it never learns the roster shape, so it cannot know where the draft
 * really ends.
 */
const DRAFTABLE_ROUNDS = 20;

/** A source's ADP where it named a pick some draft would make, else null. */
function votes(adp, teams) {
  if (adp == null) return null;
  return adp <= teams * DRAFTABLE_ROUNDS ? adp : null;
}

function pickAdp(source, sleeperAdp, ffcAdp, teams) {
  if (source === 'ffc') return ffcAdp ?? sleeperAdp ?? null;
  if (source === 'blend') {
    // Only a source that named a pick votes, so one that has run out of players
    // cannot drag a real pick out of the draft.
    const s = votes(sleeperAdp, teams);
    const f = votes(ffcAdp, teams);
    if (s != null && f != null) return (s + f) / 2;
    if (s != null) return s;
    if (f != null) return f;
    // Neither named a pick. The mean is still the best ordering on offer for a
    // tail no draft reaches, and dropping the player would shorten the board.
    if (sleeperAdp != null && ffcAdp != null) return (sleeperAdp + ffcAdp) / 2;
    return sleeperAdp ?? ffcAdp ?? null;
  }
  return sleeperAdp ?? ffcAdp ?? null;
}

export async function buildBoard({ format, teams, year, adpSource = 'sleeper', force = false }) {
  const [ffc, sleeper] = await Promise.all([
    fetchAdp({ format, teams, year, force }),
    fetchProjections({ year, force }),
  ]);

  const projections = projectionMap(sleeper.rows, format);
  const byKey = new Map();

  // Start from the market board. These are the players humans actually draft.
  let matched = 0;
  for (const p of ffc.players) {
    const proj = projections.get(p.key);
    if (proj) matched += 1;
    byKey.set(p.key, {
      id: proj?.sleeperId ? `sl-${proj.sleeperId}` : `ffc-${p.key}`,
      key: p.key,
      name: p.name,
      position: p.position,
      team: p.team,
      bye: p.bye,
      ffcAdp: p.adp,
      sleeperAdp: proj?.sleeperAdp ?? null,
      sleeperAdpFrom: proj?.sleeperAdpFrom ?? null,
      adpStdev: p.stdev ?? null,
      timesDrafted: p.timesDrafted,
      points: proj?.points ?? null,
      gamesProjected: proj?.gamesProjected ?? null,
      injuryStatus: proj?.injuryStatus ?? null,
      yearsExp: proj?.yearsExp ?? null,
      sources: proj ? ['ffc', 'sleeper'] : ['ffc'],
    });
  }

  // Extend past the end of the market board with everyone Sleeper ranks.
  for (const [key, proj] of projections) {
    if (byKey.has(key)) continue;
    if (proj.sleeperAdp == null) continue;
    byKey.set(key, {
      id: `sl-${proj.sleeperId}`,
      key,
      name: proj.name,
      position: proj.position,
      team: proj.team,
      bye: null,
      ffcAdp: null,
      sleeperAdp: proj.sleeperAdp,
      sleeperAdpFrom: proj.sleeperAdpFrom,
      adpStdev: null,
      timesDrafted: 0,
      points: proj.points,
      gamesProjected: proj.gamesProjected,
      injuryStatus: proj.injuryStatus,
      yearsExp: proj.yearsExp,
      sources: ['sleeper'],
    });
  }

  const players = [];
  for (const p of byKey.values()) {
    const adp = pickAdp(adpSource, p.sleeperAdp, p.ffcAdp, teams);
    if (adp == null) continue;
    const borrowed = adpSource !== 'ffc' && p.sleeperAdpFrom && p.sleeperAdpFrom !== format;
    players.push({
      ...p,
      adp: Number(adp.toFixed(2)),
      // True when this player has no ADP in the chosen format and the number
      // was read from another one. Shown in the pool so the borrowing is never
      // silent.
      adpBorrowedFrom: borrowed ? p.sleeperAdpFrom : null,
      adpStdev: Number(Math.min(MAX_MEASURED_STDEV, p.adpStdev ?? estimateStdev(adp)).toFixed(2)),
      stdevMeasured: p.adpStdev != null,
    });
  }

  players.sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));
  players.forEach((p, i) => { p.adpRank = i + 1; });

  const counts = {};
  for (const p of players) counts[p.position] = (counts[p.position] || 0) + 1;

  return {
    players,
    meta: {
      ...ffc.meta,
      adpSource,
      adpSourceLabel: ADP_SOURCES[adpSource] || adpSource,
      poolSize: players.length,
      positionCounts: counts,
      ffcPoolSize: ffc.players.length,
      sleeperPoolSize: projections.size,
      joinMatched: matched,
      joinRate: ffc.players.length
        ? Number((matched / ffc.players.length).toFixed(4))
        : 0,
      withProjectedPoints: players.filter((p) => p.points != null).length,
      adpBorrowed: players.filter((p) => p.adpBorrowedFrom).length,
      sleeperFetchedAt: sleeper.fetchedAt,
      stale: ffc.meta.stale || sleeper.stale,
    },
  };
}
