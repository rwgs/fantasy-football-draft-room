// The draft board: one row per player, built from the sources the caller chose.
//
// WHICH ADP WINS
// Sleeper is the default lead. It covers roughly 530 players against Fantasy
// Football Calculator's 230, so a deep roster still has a real board in the
// last rounds instead of a tail of unranked names. Fantasy Football Calculator
// fills the gaps, and it supplies two things Sleeper does not publish at all:
// a standard deviation for every pick, and a separate ADP per league size.
//
// The caller says which sources vote and how, with `adpSource`. It reads
// `<rule>:<source>,<source>` — `avg:sleeper,ffc,espn` for the mean of three,
// `order:ffc,sleeper` for Fantasy Football Calculator with Sleeper filling its
// gaps. See `parseAdpSource` for the two rules and the four older namings.
//
// HOW THEY JOIN
// Name plus position, with team defences on the team abbreviation. See names.js
// for why. The match rate is reported on every response, because a join that
// fails silently would just hand the simulator a shorter board.

import { fetchAdp, FORMATS, nearestSize } from './sources/ffc.js';
import { fetchProjections, projectionMap } from './sources/sleeper.js';
import { fetchEspnRanks } from './sources/espnRanks.js';

export { FORMATS, nearestSize };

/**
 * The feeds that may vote, and what each is called.
 *
 * `room` is not fetched here and is not always on offer. It is the ADP of the
 * platform whose draft is being followed, which only that platform's own users
 * can read, so it reaches this file as `buildBoard`'s `roomAdp` argument or not
 * at all. Where none was passed it is not offered and a choice naming it is
 * read without it.
 */
export const ADP_FEEDS = {
  sleeper: 'Sleeper',
  ffc: 'Fantasy Football Calculator',
  espn: 'ESPN',
  room: 'Your draft room',
};

/** How the chosen feeds are put together. */
export const ADP_RULES = {
  avg: 'Averaged',
  order: 'In order',
};

/**
 * The four namings that predate a selectable list, and what each always meant.
 *
 * Kept because they are what every saved league in somebody's browser holds.
 * They are not a second way of expressing a choice: each is rewritten into the
 * one encoding on the way in, so nothing downstream ever sees these words.
 */
const LEGACY_SOURCES = {
  sleeper: 'order:sleeper,ffc',
  ffc: 'order:ffc,sleeper',
  blend: 'avg:sleeper,ffc',
  consensus: 'avg:sleeper,ffc,espn',
};

/**
 * Read `adpSource` into the rule and the feeds it names.
 *
 * Unknown feeds are dropped rather than refused, because this string outlives
 * the app that wrote it: a league saved while a Yahoo room was open still says
 * `room` months later in a mock draft where no room exists, and the useful
 * answer there is the rest of the choice rather than an error. A choice that
 * drops to nothing falls back to the default.
 *
 * @param {string} raw
 * @param {string[]} [offered] the feeds available to this call, room included
 */
export function parseAdpSource(raw, offered = Object.keys(ADP_FEEDS)) {
  const text = LEGACY_SOURCES[raw] || String(raw || '');
  const [head, tail] = text.includes(':') ? text.split(/:(.*)/s) : ['order', text];
  const rule = ADP_RULES[head] ? head : 'order';

  const seen = new Set();
  const sources = tail.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => offered.includes(s) && !seen.has(s) && seen.add(s));

  if (!sources.length) return parseAdpSource('sleeper', offered);
  return { rule, sources, id: rule + ':' + sources.join(',') };
}

/** What a parsed choice is called on screen. */
export function adpSourceLabel({ rule, sources }) {
  const names = sources.map((s) => ADP_FEEDS[s] || s);
  if (names.length === 1) return names[0];
  return rule === 'avg'
    ? 'Mean of ' + names.join(', ')
    : names.join(', then ');
}

/**
 * THE CONSENSUS BOARD, AND WHY IT IS AVERAGED IN PICKS
 *
 * Three sources, one number each, averaged over the ones that cover a player.
 *
 *   Sleeper   ADP, measured over Sleeper drafts
 *   FFC       ADP, measured over its own drafts
 *   ESPN      its published draft rank, which is an editorial opinion
 *
 * Sleeper and FFC measure the same thing over different populations. ESPN's
 * rank is the only one here that is a judgement rather than a measurement, so
 * it is the one that can disagree with the market for a reason, and the gap
 * between it and the other two is the part worth looking at.
 *
 * ESPN publishes an ADP of its own as well. It is carried for display and
 * deliberately left out of the average: counting it would give ESPN two votes
 * out of four and make a consensus of three sources mostly a report on one.
 *
 * The average is taken in picks, and ESPN's rank has to be converted before it
 * can join one. A RANK IS NOT A PICK NUMBER. ESPN ranks about twelve hundred
 * players; a twelve team draft of fifteen rounds makes a hundred and eighty
 * picks. Averaged raw, the two scales disagree worst exactly where the board
 * is thinnest: Seattle's defence reads 113 on Sleeper, 85 on FFC and 242 on
 * ESPN, and nothing about that 242 is an opinion that the defence is bad. It
 * is a rank over a longer list.
 *
 * So ESPN's ranks are mapped onto the market's own scale by position: the
 * player ESPN ranks nth of the ones on this board takes the ADP of the nth
 * player by ADP. The ordering ESPN chose is untouched — a player it likes more
 * than the market still reads earlier — and only the units change. What is left
 * after that is disagreement worth reading.
 *
 * KICKERS AND DEFENCES ARE LEFT TO THE MARKET. ESPN's ranks put them below
 * hundreds of skill players, which is not a view about Seattle's defence: it is
 * the convention that you draft those two positions last, and every ranking
 * desk that follows it produces the same shape. After the rescale above they
 * still sit about 130 picks from where the market actually takes them, against
 * 80 for the board as a whole, so ESPN abstains on those two and the market
 * decides. It matters for more than accuracy: the disagreement flag exists to
 * point at a handful of players worth a second look, and thirty two defences
 * flagged at once would bury every real one.
 *
 * Where a source does not cover a player at all it does not vote, and how many
 * did is reported per player rather than hidden, because a consensus of one is
 * not a consensus.
 */
const ESPN_ABSTAINS = new Set(['K', 'DEF']);

/**
 * How deep a real draft goes, in rounds. Twenty is past the end of almost
 * every redraft league, so nothing inside a draft is silenced by it.
 *
 * Past it a number is not a pick, because no draft has one. Sleeper's board
 * runs to about pick 700, measured over its own deep and best ball drafts, and
 * Fantasy Football Calculator stops at about 230. So a player FFC puts at 142
 * and Sleeper at 700 is not a player the two disagree about by five hundred
 * picks. FFC measured a pick; Sleeper is saying nobody takes him. Averaging
 * those two produces a number neither source would recognise, and flagging it
 * as a disagreement buries the handful of real ones under the tail of the
 * board. A source that has run out of players abstains instead.
 */
const DRAFTABLE_ROUNDS = 20;

function votes(value, teams) {
  if (value == null || !Number.isFinite(value)) return null;
  return value <= teams * DRAFTABLE_ROUNDS ? value : null;
}
function consensusOf(votes) {
  const real = votes.filter((v) => v != null && Number.isFinite(v));
  if (!real.length) return null;
  const mean = real.reduce((a, b) => a + b, 0) / real.length;
  return {
    consensus: Number(mean.toFixed(2)),
    // How far apart the sources are, in picks. A player the market and the
    // desk disagree about by three rounds is the one to look at twice.
    spread: real.length > 1
      ? Number((Math.max(...real) - Math.min(...real)).toFixed(2))
      : null,
    votes: real.length,
  };
}

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

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The chosen feeds, combined into one pick number.
 *
 * `order` takes the first feed that has heard of the player at all. It does not
 * ask whether the number is inside a draft, because the point of the rule is
 * that the feeds are ranked by how much you trust them and the first one wins.
 *
 * `avg` averages only the feeds that named a pick a real draft could reach, so
 * one that has run out of players cannot drag a drafted player out of the
 * draft. Where none of them did the mean of whatever they hold is still the
 * best ordering on offer for a tail nobody reaches, and dropping the player
 * would shorten the board instead.
 *
 * @param {'avg'|'order'} rule
 * @param {string[]} sources
 * @param {Record<string, number|null>} values one pick number per feed
 */
function combineAdp(rule, sources, values, teams) {
  if (rule === 'order') {
    for (const s of sources) {
      const v = values[s];
      if (v != null && Number.isFinite(v)) return v;
    }
    return null;
  }

  const named = sources.map((s) => votes(values[s], teams)).filter((v) => v != null);
  if (named.length) return mean(named);

  const held = sources.map((s) => values[s]).filter((v) => v != null && Number.isFinite(v));
  return held.length ? mean(held) : null;
}

/**
 * @param {object} opts
 * @param {Map<string, number>|null} [opts.roomAdp] ADP from the room being
 *   followed, keyed the way `names.js` keys everything. Only a platform's own
 *   users can read it, so it is passed in rather than fetched.
 */
export async function buildBoard({
  format, teams, year, adpSource = 'sleeper', roomAdp = null, force = false,
}) {
  const offered = Object.keys(ADP_FEEDS).filter((s) => s !== 'room' || roomAdp);
  const chosen = parseAdpSource(adpSource, offered);
  const [ffc, sleeper, espn] = await Promise.all([
    fetchAdp({ format, teams, year, force }),
    fetchProjections({ year, force }),
    // A third opinion is worth having and never worth failing over. If ESPN is
    // slow or down the board is built from the two feeds that answered, and the
    // response says the consensus is short a source rather than pretending.
    fetchEspnRanks({ format, year, force }).catch((err) => ({
      byKey: new Map(),
      meta: { source: 'ESPN', ranked: 0, error: String(err.message || err) },
    })),
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

  /*
   * ESPN's ranks, put on the market's scale.
   *
   * Built off the plain Sleeper-first ADP rather than off whichever source the
   * caller asked for, so the mapping is the same board whatever `adpSource`
   * says and choosing the consensus cannot quietly redefine it.
   */
  const rateable = [];
  for (const p of byKey.values()) {
    const rated = espn.byKey.get(p.key);
    const base = p.sleeperAdp ?? p.ffcAdp;
    if (rated && base != null) rateable.push({ key: p.key, rank: rated.rank, base });
  }
  const scale = [...rateable].map((r) => r.base).sort((a, b) => a - b);
  const espnPick = new Map();
  [...rateable]
    .sort((a, b) => a.rank - b.rank)
    .forEach((r, i) => espnPick.set(r.key, scale[i]));

  const players = [];
  for (const p of byKey.values()) {
    const rated = espn.byKey.get(p.key) || null;
    const espnVote = ESPN_ABSTAINS.has(p.position) ? null : (espnPick.get(p.key) ?? null);
    const agreed = consensusOf([
      votes(p.sleeperAdp, teams), votes(p.ffcAdp, teams), votes(espnVote, teams),
    ]);
    const room = roomAdp?.get(p.key) ?? null;
    const values = { sleeper: p.sleeperAdp, ffc: p.ffcAdp, espn: espnVote, room };

    /*
     * A PLAYER THE CHOSEN FEEDS DO NOT PRICE STILL BELONGS ON THE BOARD.
     *
     * Dropping him is not a smaller board, it is a broken one. ESPN abstains on
     * kickers and defences, so ESPN chosen on its own emptied both positions
     * outright — 45 kickers and 32 defences gone — and a league that starts one
     * of each cannot fill a roster from what is left.
     *
     * So the choice decides who is *asked* first, not who is allowed to answer.
     * Where nobody it names has a view, the rest are read on the same rule, and
     * the player is marked rather than quietly renumbered.
     */
    let adp = combineAdp(chosen.rule, chosen.sources, values, teams);
    const outside = adp == null;
    if (outside) adp = combineAdp(chosen.rule, offered, values, teams);
    if (adp == null) continue;
    const borrowed = chosen.sources.includes('sleeper')
      && p.sleeperAdpFrom && p.sleeperAdpFrom !== format;
    players.push({
      ...p,
      adp: Number(adp.toFixed(2)),
      // True when this player has no ADP in the chosen format and the number
      // was read from another one. Shown in the pool so the borrowing is never
      // silent.
      adpBorrowedFrom: borrowed ? p.sleeperAdpFrom : null,
      /** True where no feed you chose had a view and the others answered. */
      adpOutsideChoice: outside,
      adpStdev: Number(Math.min(MAX_MEASURED_STDEV, p.adpStdev ?? estimateStdev(adp)).toFixed(2)),
      stdevMeasured: p.adpStdev != null,
      espnRank: rated?.rank ?? null,
      /** Whether ESPN's number counted: false for K, DEF and the deep tail. */
      espnVotes: votes(espnVote, teams) != null,
      /** That rank read as a pick on this board's own scale. */
      espnPick: espnPick.get(p.key) ?? null,
      espnAdp: rated?.adp ?? null,
      espnAuction: rated?.auction ?? null,
      /** What the room being followed drafts him at, when one is being read. */
      roomAdp: room,
      consensus: agreed?.consensus ?? null,
      /** How far apart the sources are about him, in picks. */
      consensusSpread: agreed?.spread ?? null,
      /** How many of the three had an opinion. One is not a consensus. */
      consensusVotes: agreed?.votes ?? 0,
      sources: rated ? [...p.sources, 'espn'] : p.sources,
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
      adpSource: chosen.id,
      adpSourceLabel: adpSourceLabel(chosen),
      adpRule: chosen.rule,
      adpFeeds: chosen.sources,
      /** Which feeds this board could have used, so the client greys the rest. */
      adpOffered: offered,
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
      /** How many no chosen feed had a view about. Kickers, mostly. */
      adpOutsideChoice: players.filter((p) => p.adpOutsideChoice).length,
      espn: espn.meta,
      espnRanked: players.filter((p) => p.espnRank != null).length,
      /** How many the room being followed has an ADP for. Zero when none is. */
      roomRanked: players.filter((p) => p.roomAdp != null).length,
      /** Players all three sources had an opinion about. */
      consensusOfThree: players.filter((p) => p.consensusVotes >= 3).length,
      consensusOfTwo: players.filter((p) => p.consensusVotes === 2).length,
      sleeperFetchedAt: sleeper.fetchedAt,
      stale: ffc.meta.stale || sleeper.stale,
    },
  };
}
