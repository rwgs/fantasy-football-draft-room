import type { LivePick, Player, PresetPick } from './types';

/**
 * A stand-in for somebody a real draft took who this board does not hold.
 *
 * Three of the 192 picks in a finished draft were players the current season no
 * longer ranks. Dropping them would leave a hole and every pick after it would
 * sit one column out of place, so they join the board named as they were taken.
 */
export function offBoardPlayer(pick: LivePick): Player {
  return {
    id: pick.playerId,
    key: pick.playerId,
    name: pick.name,
    position: (pick.position || 'RB') as Player['position'],
    team: pick.team || '',
    bye: null,
    adp: 999,
    adpRank: 999,
    adpStdev: 20,
    stdevMeasured: false,
    points: null,
    ffcAdp: null,
    sleeperAdp: null,
    adpBorrowedFrom: null,
    injuryStatus: null,
    timesDrafted: 0,
    sources: [],
  };
}

/** Every pick a real draft has made, as claims on the board. */
export function livePresets(picks: LivePick[]): PresetPick[] {
  return picks.map((p) => ({
    overall: p.overall,
    playerId: p.playerId,
    source: 'live' as const,
  }));
}

/**
 * Whether two readings of a room are the same reading.
 *
 * The assistant used to decide whether to rebuild by comparing how many picks
 * the room had reported, which is a different question. A commissioner who
 * undoes a pick and replaces it, or a feed that corrects a resolved identity,
 * sends back a list of the same length with a different player in it. The board
 * then kept the old player unavailable and the new one draftable -- so advice
 * and any written queue ran against a board the room had already left -- until
 * some later pick changed the count and forced a rebuild.
 *
 * By slot and player, because those are the two things a correction changes.
 * Sorted, so a feed that returns the same picks in a different order is not
 * mistaken for a room that has moved.
 */
export function sameLivePicks(a: PresetPick[], b: PresetPick[]): boolean {
  if (a.length !== b.length) return false;
  const key = (picks: PresetPick[]) => picks
    .map((p) => p.overall + ':' + p.playerId)
    .sort()
    .join('|');
  return key(a) === key(b);
}

/**
 * Keepers and real picks, merged into one set of claims.
 *
 * A draft that has started has already recorded its keepers as picks, so the
 * two lists overlap and the real one wins: it is what happened, and the keeper
 * entry is only ever what was expected to happen. A keeper whose player is
 * already gone is dropped outright rather than left to claim a second slot,
 * which would put the same player on the board twice.
 */
export function mergePresets(keepers: PresetPick[], live: PresetPick[]): PresetPick[] {
  const byOverall = new Map<number, PresetPick>();
  for (const keeper of keepers) byOverall.set(keeper.overall, keeper);
  for (const pick of live) byOverall.set(pick.overall, pick);

  const takenLive = new Set(live.map((p) => p.playerId));
  for (const [overall, pick] of [...byOverall]) {
    if (pick.source === 'keeper' && takenLive.has(pick.playerId)) byOverall.delete(overall);
  }

  return [...byOverall.values()].sort((a, b) => a.overall - b.overall);
}
