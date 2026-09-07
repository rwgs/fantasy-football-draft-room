import { survivalOdds } from './survival';
import {
  FLEX_POSITIONS, SUPERFLEX_POSITIONS, emptyCounts, fillsStarter, positionCap, starterCount,
  starterSlot,
  startersFilled,
} from './roster';
import type { StarterSlot } from './roster';
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
  /**
   * The replacement level `now` was taken over, in projected points.
   *
   * Carried rather than recomputed, because a player filling a flex has to be
   * re-priced against a different bar and the two numbers have to come from the
   * same allocation to be subtracted from each other at all.
   */
  replacement: number;
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
      replacement: replacement[pos],
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
 * Only the leader at each position is weighed. What a position is expected to
 * leave behind is measured against the best man left, so it is his number and
 * nobody else's: the fourth receiver does not inherit the first's.
 */
export interface Recommendation {
  player: Player;
  /** What he is worth over a replacement starter at his position. */
  worth: number;
  /** What your next turn is still expected to bring once he is taken. */
  nextTurn: number;
  /**
   * Which starting slot he fills, or null where he fills none.
   *
   * `own`, `flex` or `superflex`. It replaces a boolean that said only whether,
   * which is not enough to say anything to a user: with a flex open, a second
   * tight end fills a starter, and "you still have to start one" reads as
   * needing another tight end. It also names the bar he should be judged
   * against, which for a flex is not a replacement at his own position.
   */
  slot: StarterSlot | null;
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
 * A pick is scored by what two turns come to together: what he is worth now,
 * plus what your next turn is still expected to bring once he is taken. Taking
 * the best man at the one position that would still be nearly as good next turn
 * is what that arithmetic refuses, because it is the pick that leaves the least
 * behind.
 *
 * It used to be `now + (now - later)`, or `2 * now - later`, which counts what
 * he is worth twice and what you would do instead not at all. That is a
 * heuristic for scarcity and it reaches the right answer most of the time, but
 * it is not an optimizer, and the audit found a counterexample inside its own
 * numbers: with both slots open, a receiver worth 100 now and nothing later
 * against a back worth 150 now and 70 later, it scored RB 230 to WR 200 and
 * took the back. The back now and the receiver later comes to 150; the receiver
 * now and the back later comes to 170. It gave up 20 points it had measured
 * itself.
 *
 * A position you can no longer start contributes nothing to the second term,
 * because a turn spent on a bench player was never going to fill a slot. With
 * the lineup full nothing does, the term is zero for everybody, and worth alone
 * decides -- which is the right answer there and the answer this has always
 * given.
 *
 * Two turns and not the whole draft. The continuation this prices is one pick
 * deep, so it is a better comparison than the heuristic it replaces rather than
 * a solved draft. What a bench player adds to a team is still measured as value
 * over a replacement starter, which overstates him, and `review/review.md`
 * keeps that open under M1 and R6.
 *
 * No margin gate here. That gate belongs to naming a single pick, where a tie
 * means there is no decision to report; a ranked list of options is exactly
 * what you want a tie to produce, both of them, in either order.
 *
 * `picksLeft` is how many the draft has still to hand you, and it is the other
 * half of reading your roster. What you hold says which positions you can still
 * play; what is left to come says whether you can still afford to.
 */
export function rankCandidates(
  priced: PositionValue[],
  mine: Record<Position, number>,
  roster: RosterSlots,
  picksLeft: number,
): Recommendation[] {
  // Whatever he is worth, a position nobody can still play is not a pick.
  const legal = priced.filter((row) => row.best != null
    && mine[row.position] < positionCap(roster, row.position));

  /*
   * The same hard rule the computer teams follow in `chooseCpuPick`: once a
   * team has exactly as many picks left as slots it cannot field a lineup
   * without, depth stops being a choice. The advice had no remaining-picks
   * constraint of any kind, so on the last pick of a draft with a receiving
   * slot still empty it would name a backup quarterback worth more over a
   * replacement and say `fillsStarter: false` while doing it. A roster that
   * cannot start a lineup is not a draft result anybody wants to read.
   *
   * It lifts the moment there is a bench to draft, because then the backup is
   * a legitimate pick again. This is compulsion, not a preference.
   */
  const openStarters = Math.max(0, starterCount(roster) - startersFilled(mine, roster));
  const compulsory = picksLeft <= openStarters
    ? legal.filter((row) => fillsStarter(mine, roster, row.position))
    : legal;
  const playable = compulsory.length ? compulsory : legal;

  /*
   * Worth orders this list. It used to decide who was allowed on it as well,
   * and a pool with nobody left worth starting therefore produced no advice and
   * no queue at all -- thirty available backs below replacement returned an
   * empty list -- which by the last rounds of a real draft is most of what is
   * left. A pick still has to be made, and those backs are legitimate bench
   * selections. So the filter applies only while somebody passes it, which is
   * the shape `chooseCpuPick` already has when it falls back to the best man on
   * the board rather than stalling the draft.
   */
  const worthy = playable.filter((row) => row.now > 0);
  const candidates = worthy.length ? worthy : playable;

  /*
   * WHAT A SHARED SLOT COSTS TO FILL.
   *
   * Value over replacement asks how much better your lineup is with him than
   * without him, and the answer depends on what would otherwise be in the slot
   * he takes. For his own position's slot that is a replacement at his own
   * position, which is what `now` already holds. For a flex it is not: a flex
   * takes a back, a receiver or a tight end, so what you would otherwise put
   * there is the best freely available player among all three -- the HIGHEST of
   * their replacement levels, not his own.
   *
   * Reported from a live draft on 2026-09-07. With a tight end already held and
   * the flex open, a second one was priced against roughly TE12 in a one tight
   * end league, where the top of that board is steep, and so read far better
   * than he was: the slot he was actually competing for was the flex, whose bar
   * is a back or a receiver.
   *
   * A player filling no slot at all is left alone. He is overstated too -- a
   * backup priced against a replacement starter he is not replacing -- but that
   * needs expected usable weeks and what you could stream instead, which is the
   * open half of M1 and R6 and not a bar to swap.
   */
  const barOf = (positions: Position[]) => candidates
    .filter((row) => positions.includes(row.position))
    .reduce((high, row) => Math.max(high, row.replacement), -Infinity);
  const flexBar = barOf(FLEX_POSITIONS);
  const superflexBar = barOf(SUPERFLEX_POSITIONS);

  /** What a value taken over `row.replacement` is worth over the slot's bar. */
  const overSlot = (value: number, row: PositionValue, slot: StarterSlot | null) => {
    const bar = slot === 'flex' ? flexBar : slot === 'superflex' ? superflexBar : null;
    return bar == null || !Number.isFinite(bar) ? value : value - (bar - row.replacement);
  };

  const scored = candidates
    .map((row) => {
      const starter = starterSlot(mine, roster, row.position);
      /*
       * The roster advances before the next turn is priced, because a slot he
       * fills is a slot the turn after him no longer has to. His own position
       * is left out of it: this is what you would do instead of him, and doing
       * the same thing one turn later is not an alternative to doing it now.
       */
      const after = { ...mine, [row.position]: mine[row.position] + 1 };
      let nextTurn = 0;
      for (const other of candidates) {
        if (other.position === row.position) continue;
        // Priced against the slot he would fill once this pick is made, which
        // matters where a roster has more than one flex: with only one, taking
        // it here leaves every other candidate filling a slot of his own.
        const otherSlot = starterSlot(after, roster, other.position);
        if (otherSlot == null) continue;
        const later = overSlot(other.later, other, otherSlot);
        if (later > nextTurn) nextTurn = later;
      }
      const now = overSlot(row.now, row, starter);
      return { row, starter, now, nextTurn, score: now + nextTurn };
    })
    .sort((a, b) => b.score - a.score);

  return scored.map((entry, i) => ({
    player: entry.row.best!,
    worth: entry.now,
    nextTurn: entry.nextTurn,
    slot: entry.starter,
    margin: i + 1 < scored.length ? entry.score - scored[i + 1].score : entry.score,
  }));
}

/** The leader, once he is far enough clear of the next one to be a decision. */
export function recommendPick(
  priced: PositionValue[],
  mine: Record<Position, number>,
  roster: RosterSlots,
  picksLeft: number,
): Recommendation | null {
  const [top] = rankCandidates(priced, mine, roster, picksLeft);
  return top && top.margin >= WORTH_NAMING ? top : null;
}
