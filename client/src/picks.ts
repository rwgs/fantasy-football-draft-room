/**
 * What a pick is called on screen.
 *
 * Two numbers name the same pick and neither is redundant. `3.05` says where
 * you sit inside the round, which is the thing a snake draft turns on. The
 * total is what a real draft room calls the pick: Yahoo counts picks straight
 * through, so a screen that only says `3.05` cannot be matched against the
 * room in front of you without counting seats.
 */

import { locate } from './engine/order';

/** The round, then the place inside it. */
export function pickLabel(overall: number, teams: number): string {
  const { round, slotInRound } = locate(overall, teams);
  return round + '.' + String(slotInRound).padStart(2, '0');
}

/** The same pick, with the number the draft room calls it by. */
export function pickLabelWithOverall(overall: number, teams: number): string {
  return pickLabel(overall, teams) + ' #' + overall;
}
