import { logNormalTail } from './random';
import type { Player } from './types';

/**
 * The chance a player is still on the board when your next pick arrives.
 *
 * The model is the one the data already supports: the pick a player goes at is
 * normal around their ADP, with the spread Fantasy Football Calculator measures
 * across thousands of real drafts. The probability is conditioned on the player
 * being available right now, which matters for anyone falling past their ADP.
 * Without that conditioning a faller reads as zero per cent, which is the
 * opposite of the truth.
 *
 * It does not model this draft's own history. A run on running backs pulls the
 * real numbers down and this will not see it.
 */
export function survivalOdds(player: Player, currentPick: number, targetPick: number): number {
  if (targetPick <= currentPick) return 1;
  const sd = Math.max(0.8, player.adpStdev);
  const logSurvivesTo = (pick: number) => logNormalTail((pick - 0.5 - player.adp) / sd);

  // The ratio is taken in logs because both tails underflow for a player who
  // has fallen far past his ADP, and dividing zero by zero used to read as
  // certainty: the further he fell, the more sure the board became he would
  // last. In logs the conditional probability stays finite and keeps falling as
  // the target moves away, which is what conditioning on "still here" means.
  return Math.max(0, Math.min(1, Math.exp(logSurvivesTo(targetPick) - logSurvivesTo(currentPick))));
}

/**
 * Below this, the board is saying he will not reach your turn.
 *
 * Here rather than beside the bar that draws it, because two things now turn on
 * it and they have to agree. The pool prints "gone by 5.06" instead of a bar
 * pinned near empty, and the advice refuses to name a target it has just called
 * gone. One number means the row and the recommendation cannot contradict each
 * other; two numbers means they can, and eventually will.
 */
export const CERTAINLY_GONE = 0.03;
