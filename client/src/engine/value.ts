import { survivalOdds } from './survival';
import {
  FLEX_POSITIONS, SUPERFLEX_POSITIONS, emptyCounts, fillsStarter, positionCap, starterCount,
} from './roster';
import type { Player, Position, RosterSlots } from './types';
import { POSITIONS } from './types';

/**
 * What one position is worth right now, and what it will be worth if you wait.
 *
 * The survival bar answers "will he last". It does not answer the question you
 * actually have on the clock, which is "does it matter". A receiver with a 20
 * per cent chance of lasting is a crisis if the next receiver is 40 points
 * worse and a shrug if the next one is 3 points worse. That gap is the whole
 * decision, and nothing on the board was showing it.
 */
export interface PositionValue {
  position: Position;
  /** The best player available at this position, by points over replacement. */
  best: Player | null;
  /** His value over replacement, in projected points. */
  now: number;
  /** The value you expect to still be there at your next pick. */
  later: number;
  /** now - later: what this pick buys you over waiting one turn. */
  cost: number;
  /** The chance `best` himself lasts until then. */
  odds: number;
  /** How many players are left before the biggest drop in value. */
  beforeCliff: number;
}

/**
 * The projected points of a replacement player at each position.
 *
 * Replacement is the first player at a position nobody has to start, so it
 * depends on how many of that position a league starts in total. Rather than
 * split the flex slots by a table of made up shares, the split is read off the
 * market: count the positions among the first `teams * starters` players by
 * ADP. A superflex league drafts quarterbacks earlier, so more of them land in
 * that window and the quarterback replacement moves down on its own.
 *
 * It is measured against the whole board, drafted players included, because
 * replacement level is a fact about the league's shape and not about how this
 * particular draft has gone so far.
 */
export function replacementPoints(
  all: Player[],
  teams: number,
  roster: RosterSlots,
): Record<Position, number> {
  const started = startingAllocation(all, teams, roster);

  const out = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    const pool = all
      .filter((p) => p.position === pos && p.points != null)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    if (!pool.length) {
      out[pos] = 0;
      continue;
    }
    out[pos] = pool[Math.min(started[pos], pool.length - 1)].points ?? 0;
  }
  return out;
}

/**
 * How many starters at each position the league actually starts.
 *
 * The roster decides the size and the market decides the shape. Dedicated slots
 * are owed outright, which is what stops a kicker becoming his own replacement:
 * he never appears inside the starter window at all, and without his own slots
 * every kicker on the board would price at zero. The flex slots on top are
 * shared, so they go out in the proportions the market is taking players beyond
 * those dedicated slots -- to the positions eligible for them, and only as many
 * as exist.
 *
 * The counts used to be read straight off the ADP window and then floored at
 * the dedicated slots independently, one position at a time, with nothing
 * removing the excess or reconciling the total. A run on quarterbacks that put
 * 24 of them inside a 12 team window therefore priced a one quarterback
 * league's replacement at QB24 while the league starts twelve, and the baseline
 * counted 48 starters against 36 slots. Because those counts come from the
 * market, changing ADP source moved WORTH with no change to projections or
 * roster rules.
 */
export function startingAllocation(
  all: Player[],
  teams: number,
  roster: RosterSlots,
): Record<Position, number> {
  const out = {} as Record<Position, number>;
  for (const pos of POSITIONS) out[pos] = teams * roster[pos];

  const eligible = POSITIONS.filter(
    (pos) => (roster.FLEX > 0 && FLEX_POSITIONS.includes(pos))
      || (roster.SUPERFLEX > 0 && SUPERFLEX_POSITIONS.includes(pos)),
  );
  const flexSlots = teams * (roster.FLEX + roster.SUPERFLEX);
  if (!flexSlots || !eligible.length) return out;

  const counts = emptyCounts();
  for (const p of [...all].sort((a, b) => a.adp - b.adp).slice(0, teams * starterCount(roster))) {
    counts[p.position] += 1;
  }

  const weight = emptyCounts();
  let total = 0;
  for (const pos of eligible) {
    weight[pos] = Math.max(0, counts[pos] - out[pos]);
    total += weight[pos];
  }
  // A window taking nobody beyond his dedicated slots says nothing about where
  // the flex is spent, so the slots themselves stand in for the market.
  if (total === 0) {
    for (const pos of eligible) {
      weight[pos] = roster[pos];
      total += weight[pos];
    }
  }
  if (total === 0) return out;

  let given = 0;
  const share = eligible.map((pos) => {
    const exact = (flexSlots * weight[pos]) / total;
    const whole = Math.floor(exact);
    given += whole;
    return { pos, whole, rest: exact - whole };
  });
  // Largest remainder, so what is handed out sums to the slots that exist.
  share.sort((a, b) => b.rest - a.rest);
  for (let i = 0; i < flexSlots - given; i += 1) share[i % share.length].whole += 1;
  for (const s of share) out[s.pos] += s.whole;
  return out;
}

/**
 * The value you expect the best survivor at a position to carry.
 *
 * Walking the position in value order, a player is the best one left exactly
 * when he survives and everyone better than him does not. Those terms sum to
 * the expected best, which is the number to compare against taking one now.
 *
 * A player below replacement contributes nothing: he is not a reason to wait,
 * and counting him would make a barren position look like a full one.
 */
function expectedBest(
  ranked: Player[],
  replacement: number,
  currentPick: number,
  targetPick: number,
): number {
  let gone = 1;
  let total = 0;
  for (const p of ranked) {
    const value = (p.points ?? 0) - replacement;
    if (value <= 0) break;
    const odds = survivalOdds(p, currentPick, targetPick);
    total += gone * odds * value;
    gone *= 1 - odds;
    if (gone < 1e-4) break;
  }
  return total;
}

/**
 * How far down this position's list the biggest drop in value sits.
 *
 * Only the top of the list is worth reading: a cliff eight players away is not
 * a cliff you can fall off before your next turn.
 */
function playersBeforeCliff(ranked: Player[]): number {
  const top = ranked.slice(0, 9);
  let at = top.length;
  let worst = 0;
  for (let i = 0; i + 1 < top.length; i += 1) {
    const drop = (top[i].points ?? 0) - (top[i + 1].points ?? 0);
    if (drop > worst) {
      worst = drop;
      at = i + 1;
    }
  }
  return at;
}

/**
 * Every position, priced by what waiting one turn would cost.
 *
 * Sorted by that cost, so the position at the top is the one this pick is
 * worth spending on. Positions with no projected points behind them are left
 * out rather than shown as zero, which would read as "no drop off" when it
 * means "no data".
 */
export function positionValues(
  available: Player[],
  all: Player[],
  teams: number,
  roster: RosterSlots,
  currentPick: number,
  targetPick: number | null,
): PositionValue[] {
  const replacement = replacementPoints(all, teams, roster);
  const out: PositionValue[] = [];

  for (const pos of POSITIONS) {
    const ranked = available
      .filter((p) => p.position === pos && p.points != null)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    if (!ranked.length) continue;

    const best = ranked[0];
    const now = (best.points ?? 0) - replacement[pos];
    const later = targetPick == null
      ? now
      : expectedBest(ranked, replacement[pos], currentPick, targetPick);

    out.push({
      position: pos,
      best,
      now,
      later,
      cost: now - later,
      odds: targetPick == null ? 1 : survivalOdds(best, currentPick, targetPick),
      beforeCliff: playersBeforeCliff(ranked),
    });
  }

  return out.sort((a, b) => b.cost - a.cost);
}

/**
 * The one player this pick is for, or nothing.
 *
 * Three things decide a pick and the app was showing them in three places. The
 * pool says what a player is worth. The cost of waiting says which position
 * runs out first, off this room once enough of it has been drafted. Your roster
 * says which of those you actually have to start. Reading across all three,
 * every turn, is the work this does.
 *
 * Only the leader at each position is weighed. Cost of waiting is measured
 * against the best man left, so it is his number and nobody else's: the fourth
 * receiver does not inherit the urgency of the first.
 */
export interface Recommendation {
  player: Player;
  /** What he is worth over a replacement starter at his position. */
  worth: number;
  /** What waiting one turn costs at his position, when that cost is yours. */
  urgency: number;
  /** Whether he fills a starting slot you have still to fill. */
  fillsStarter: boolean;
  /** How far clear of the next position's leader he came. */
  margin: number;
}

/**
 * How far clear the leader has to be before naming him.
 *
 * Under about a field goal there is nothing to choose between the top two, and
 * naming one anyway invents a decision rather than reporting one. Saying
 * nothing is the honest answer there, and the pool's own sort is a better one.
 */
const WORTH_NAMING = 3;

/**
 * Every position's leader, in the order this pick is worth spending on them.
 *
 * Urgency only counts where it is yours. A position you can no longer start
 * contributes none of it, because waiting a turn for a bench player costs you
 * nothing this turn. That leaves worth alone to decide, which is the right
 * answer once the lineup is full.
 *
 * No margin gate here. That gate belongs to naming a single pick, where a tie
 * means there is no decision to report; a ranked list of options is exactly
 * what you want a tie to produce, both of them, in either order.
 */
export function rankCandidates(
  priced: PositionValue[],
  mine: Record<Position, number>,
  roster: RosterSlots,
): Recommendation[] {
  const scored = priced
    .filter((row) => row.best != null && row.now > 0)
    // Whatever it is worth, a position nobody can still play is not a pick.
    .filter((row) => mine[row.position] < positionCap(roster, row.position))
    .map((row) => {
      const starter = fillsStarter(mine, roster, row.position);
      const urgency = starter ? row.cost : 0;
      return { row, starter, urgency, score: row.now + urgency };
    })
    .sort((a, b) => b.score - a.score);

  return scored.map((entry, i) => ({
    player: entry.row.best!,
    worth: entry.row.now,
    urgency: entry.urgency,
    fillsStarter: entry.starter,
    margin: i + 1 < scored.length ? entry.score - scored[i + 1].score : entry.score,
  }));
}

/** The leader, once he is far enough clear of the next one to be a decision. */
export function recommendPick(
  priced: PositionValue[],
  mine: Record<Position, number>,
  roster: RosterSlots,
): Recommendation | null {
  const [top] = rankCandidates(priced, mine, roster);
  return top && top.margin >= WORTH_NAMING ? top : null;
}
