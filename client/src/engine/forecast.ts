import { biasLever, chooseCpuPick } from './cpu';
import { availablePlayers, currentPick, currentTeam, nextUserPick, presetFor } from './draft';
import { mulberry32 } from './random';
import { positionValues, rankCandidates, recommendPick, replacementPoints } from './value';
import type { DraftEngine } from './draft';
import type { PositionValue, Recommendation } from './value';
import type { CpuConfig, Player, Position, RosterSlots } from './types';
import { POSITIONS } from './types';

/**
 * WHAT THE ROOM IS ACTUALLY DOING
 *
 * The survival bar reads ADP and nothing else, which is the same as assuming
 * every room drafts like the average of thousands of rooms. Yours does not.
 * Six backs off the board in the first ten picks is a fact about this draft,
 * and it is the fact that decides whether the back you want reaches you.
 *
 * Two things are measured here and then simulated forward:
 *
 *   what the room leans towards   counted from picks against what ADP expected
 *   what each team still needs    already in the engine, as their real roster
 *
 * The second one was always there: the computer teams score players by their
 * own open slots. It has only ever been pointed at an invented room. Pointed at
 * the real one, with the real rosters and the real picks behind it, the same
 * model answers who is likely to be gone before your turn comes back.
 */

/** How far a position has to run before the lean reads as the strongest setting. */
const FULL_LEAN = 0.5;

/**
 * The depth `FULL_LEAN` is calibrated at, in rounds.
 *
 * The surplus accumulates as a draft runs and the denominator did not, so the
 * same room read twice as leaned by the eighth round as by the third, and every
 * setting above +3 collapsed onto the same answer. Measured against a room whose
 * dial was known, the mean error in the survival it predicts fell from 0.052 to
 * 0.020 at eight rounds once the denominator grew with it, and improved or held
 * in eleven of twelve position and depth combinations tried.
 *
 * It only ever slows the reading down, never speeds it up: before this many
 * rounds the scale is what it always was, so the early draft is untouched and
 * one round of picks cannot be multiplied into a landslide.
 */
const CALIBRATED_ROUNDS = 3;

/** How many baseline drafts a lean is measured against. */
const BASELINE_RUNS = 3;

/**
 * The room's positional lean, in the same -5 to +5 the dials use.
 *
 * For every position, count what has gone against what a room with no lean at
 * all would have taken by now, and scale by the size of the room. A surplus of
 * half a round is a strong lean; the dial saturates there, because past that
 * the reading is one run rather than a tendency.
 *
 * THE BASELINE IS SIMULATED, NOT THE ADP ORDER. Every real room drafts away
 * from ADP without leaning anywhere: it takes a starting back before a better
 * receiver because it has two back slots to fill, and ADP knows nothing about
 * slots. Measured against ADP, an ordinary room reads as nearly two points of
 * anti-receiver bias, and since the lean is then handed back to a model that
 * already applies the roster need bonus, that bias would be counted twice.
 * Measured against the same model with its position dials zeroed, an ordinary
 * room reads as ordinary, and only what this room does differently survives.
 *
 * It says nothing until a full round is in. Before that the sample is a
 * handful of picks and every position reads as a landslide.
 */
export function observedLean(engine: DraftEngine): Record<Position, number> {
  const { state } = engine;
  const made = state.picks.length;
  const lean = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 } as Record<Position, number>;
  if (made < state.league.teams) return lean;

  const taken = { ...lean };
  for (const pick of state.picks) {
    const player = engine.byId.get(pick.playerId);
    if (player) taken[player.position] += 1;
  }

  const expected = baseline(engine, made);
  const rounds = Math.max(CALIBRATED_ROUNDS, made / state.league.teams);
  const scale = FULL_LEAN * state.league.teams * (rounds / CALIBRATED_ROUNDS);
  for (const pos of POSITIONS) {
    lean[pos] = Math.max(-5, Math.min(5, ((taken[pos] - expected[pos]) / scale) * 5));
  }
  return lean;
}

/**
 * What a room with no lean would hold after this many picks.
 *
 * The same league and the same model with every position dial at zero, drafted
 * from an empty board. A few runs, averaged, because one run of a room that
 * reaches is itself noisy.
 */
function baseline(engine: DraftEngine, picks: number): Record<Position, number> {
  const { state } = engine;
  const out = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 } as Record<Position, number>;
  const cpu: CpuConfig = {
    ...state.cpu,
    positionBias: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
    cpuUsesMyRankings: false,
  };

  for (let run = 0; run < BASELINE_RUNS; run += 1) {
    const rng = mulberry32(state.league.seed + run * 15485863 + 3);
    let live: DraftEngine = {
      ...engine,
      state: {
        ...state,
        teams: state.teams.map((t) => ({
          ...t, playerIds: [], counts: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
        })),
        picks: [],
        availableIds: [...engine.byId.keys()],
        done: false,
      },
      presets: new Map(),
    };

    for (let i = 0; i < picks && !live.state.done; i += 1) {
      const team = currentTeam(live.state);
      if (!team) break;
      const player = chooseCpuPick(availablePlayers(live), {
        league: live.state.league,
        cpu,
        overallPick: currentPick(live.state),
        team: { index: team.index, counts: team.counts, picksMade: team.playerIds.length },
        rankOverride: null,
        rng,
      });
      if (!player) break;
      out[player.position] += 1 / BASELINE_RUNS;
      live = takePlayer(live, player, false);
    }
  }
  return out;
}

/** How many readings a position needs before its fit is about the position. */
const PRIOR_MIN_SAMPLE = 8;

/**
 * The dials this room's own ADP implies, before a single pick is in.
 *
 * `observedLean` says nothing until a full round has happened, which in a 14
 * team league is the whole of the first round. Some rooms publish what their
 * drafters actually do — Yahoo does, to a browser holding the session cookie —
 * and where that is known the lean can be read before the draft starts rather
 * than discovered a round late.
 *
 * Fitted, not guessed. `applyBias` moves an ADP by its lever times the dial, so
 * it is linear in the dial and the setting that best turns this board's ADP
 * into the room's is a least squares fit with a closed form. That keeps the
 * answer in the units the dials and `observedLean` already use, which is what
 * lets it stand in for one.
 *
 * Two things it refuses to read. A room's ADP runs out long before the board
 * does, and past that the gap between them is the end of one list rather than a
 * disagreement, so the fit stops where the room's own deepest reading does. And
 * a position with too few readings gets none: Yahoo reported three kickers
 * against fifty four receivers, and those three fitted a dial of 2.3, which is
 * a number about three players rather than about kickers.
 */
export function priorLean(
  players: Player[],
  roomAdp: Map<string, number>,
): Record<Position, number> {
  const lean = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 } as Record<Position, number>;
  if (!roomAdp.size) return lean;

  let deepest = 0;
  for (const adp of roomAdp.values()) deepest = Math.max(deepest, adp);

  for (const pos of POSITIONS) {
    let weighted = 0;
    let weight = 0;
    let seen = 0;
    for (const p of players) {
      if (p.position !== pos || p.adp > deepest) continue;
      const theirs = roomAdp.get(p.id);
      if (theirs == null) continue;
      const lever = biasLever(p.adp);
      weighted += lever * (p.adp - theirs);
      weight += lever * lever;
      seen += 1;
    }
    if (seen >= PRIOR_MIN_SAMPLE && weight > 0) {
      lean[pos] = Math.max(-5, Math.min(5, (weighted / weight) * 5));
    }
  }
  return lean;
}

export interface Forecast {
  sims: number;
  /** The pick this forecast runs to. */
  targetPick: number;
  /** Per player id, the share of simulations where he was still there. */
  survival: Map<string, number>;
  /** Per position, the mean number taken between now and your next pick. */
  taken: Record<Position, number>;
  /** Per position, the mean value of the best one left, over a replacement starter. */
  expected: Record<Position, number>;
  /** The lean the room was simulated with. */
  lean: Record<Position, number>;
}

/**
 * Play the rest of the round out many times and count what comes back.
 *
 * Every run is the real board, the real rosters and the real picks, carried
 * forward by the same model the computer teams use, with a different seed each
 * time. What survives a hundred of those is a probability that knows about this
 * room, which is exactly what reading ADP alone cannot give you.
 */
export function forecast(
  engine: DraftEngine,
  sims = 120,
  prior: Record<Position, number> | null = null,
): Forecast | null {
  const { state } = engine;
  const target = nextUserPick(state);
  const from = currentPick(state);
  if (target == null || target <= from || state.done) return null;

  // Before a full round `observedLean` has nothing to say. Where the room
  // publishes how it drafts, that stands in until then. After it, what actually
  // happened wins: a measurement of this draft beats a measurement of the site's
  // drafts in general.
  const lean = state.picks.length >= state.league.teams || !prior
    ? observedLean(engine)
    : prior;
  const cpu: CpuConfig = {
    ...state.cpu,
    // The room's own lean sits on top of whatever the dials say, so a setting
    // you chose is still honoured and the measurement moves it.
    positionBias: Object.fromEntries(
      POSITIONS.map((p) => [p, Math.max(-5, Math.min(5, (state.cpu.positionBias[p] ?? 0) + lean[p]))]),
    ) as Record<Position, number>,
  };

  const survived = new Map<string, number>();
  const taken = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 } as Record<Position, number>;
  const bestLeft = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 } as Record<Position, number>;
  const replacement = replacementPoints(
    [...engine.byId.values()], state.league.teams, state.league.roster,
  );

  for (let sim = 0; sim < sims; sim += 1) {
    // A stream of its own per run. Without this every run is the same draft.
    const rng = mulberry32(state.league.seed + sim * 104729 + 7);
    let live = engine;

    while (currentPick(live.state) < target && !live.state.done) {
      const overall = currentPick(live.state);
      const team = currentTeam(live.state);
      if (!team) break;

      const promised = presetFor(live, overall);
      const player = promised ?? chooseCpuPick(availablePlayers(live), {
        league: live.state.league,
        cpu,
        overallPick: overall,
        team: { index: team.index, counts: team.counts, picksMade: team.playerIds.length },
        rankOverride: live.state.cpu.cpuUsesMyRankings ? live.rankOverride : null,
        rng,
      });
      if (!player) break;
      live = takePlayer(live, player, !!promised);
    }

    const left = availablePlayers(live);
    const seen = new Set<string>();
    for (const p of left) {
      survived.set(p.id, (survived.get(p.id) ?? 0) + 1);
      if (!seen.has(p.position)) {
        seen.add(p.position);
        // The pool is in board order, so the first one at a position is the
        // best available by the market. Value it against replacement.
        bestLeft[p.position] += Math.max(0, (p.points ?? 0) - replacement[p.position]);
      }
    }
    for (const pos of POSITIONS) {
      taken[pos] += countAt(engine, live, pos);
    }
  }

  const survival = new Map<string, number>();
  for (const [id, n] of survived) survival.set(id, n / sims);
  for (const pos of POSITIONS) {
    taken[pos] /= sims;
    bestLeft[pos] /= sims;
  }

  return {
    sims, targetPick: target, survival, taken, expected: bestLeft, lean,
  };
}

/** How many at a position went between the real board and the simulated one. */
function countAt(before: DraftEngine, after: DraftEngine, pos: Position): number {
  let n = 0;
  for (let i = before.state.picks.length; i < after.state.picks.length; i += 1) {
    if (after.byId.get(after.state.picks[i].playerId)?.position === pos) n += 1;
  }
  return n;
}

/**
 * Record a simulated pick.
 *
 * This is `applyPick` from the engine with the bookkeeping a simulation does
 * not need left out. A forecast runs this many thousands of times and throws
 * every result away, so it keeps only what the next pick reads: the rosters,
 * the pick count and who is left.
 */
function takePlayer(engine: DraftEngine, player: Player, preset: boolean): DraftEngine {
  const { state } = engine;
  const overall = currentPick(state);
  const teamIndex = state.order[overall - 1];

  const teams = preset
    ? state.teams
    : state.teams.map((t) => (t.index === teamIndex
      ? {
        ...t,
        playerIds: [...t.playerIds, player.id],
        counts: { ...t.counts, [player.position]: t.counts[player.position] + 1 },
      }
      : t));

  return {
    ...engine,
    state: {
      ...state,
      teams,
      picks: [...state.picks, {
        overall,
        round: Math.floor((overall - 1) / state.league.teams) + 1,
        slotInRound: ((overall - 1) % state.league.teams) + 1,
        teamIndex,
        playerId: player.id,
        auto: true,
        preset: null,
      }],
      availableIds: state.availableIds.filter((id) => id !== player.id),
      done: state.picks.length + 1 >= state.order.length,
    },
  };
}

/** The strength at which a lean is worth putting into words. */
const LEAN_WORTH_SAYING = 1.2;

/**
 * What the room is doing, in a sentence, or null when it is doing nothing.
 *
 * Only the two strongest positions are named. A list of six is a table, and a
 * table of small numbers reads as six findings rather than one.
 */
export function describeLean(lean: Record<Position, number>): string | null {
  const strong = POSITIONS
    .filter((p) => Math.abs(lean[p]) >= LEAN_WORTH_SAYING)
    .sort((a, b) => Math.abs(lean[b]) - Math.abs(lean[a]))
    .slice(0, 2);
  if (!strong.length) return null;

  const words = strong.map((p) => (lean[p] > 0 ? 'forcing ' : 'fading ') + p);
  return 'This room is ' + words.join(' and ') + '.';
}

/**
 * Every position priced for this pick, with the room's own reading where there
 * is one.
 *
 * `positionValues` answers off ADP, which is the average of thousands of rooms
 * rather than yours. When the assistant has simulated this one, its expected
 * best and its survival replace those guesses. Both answer the same question
 * and only one of them has watched the draft.
 *
 * It lives here rather than in the panel that draws it because it is no longer
 * drawn in one place: the same reading goes to the bridge, to be shown in the
 * draft room itself, and two copies of this merge would drift apart.
 */
export function pricedPositions(
  available: Player[],
  all: Player[],
  teams: number,
  roster: RosterSlots,
  currentPick: number,
  targetPick: number | null,
  room: Forecast | null,
): PositionValue[] {
  const base = positionValues(available, all, teams, roster, currentPick, targetPick);
  if (!room) return base;

  return base
    .map((row) => {
      const later = room.expected[row.position];
      const odds = row.best ? room.survival.get(row.best.id) ?? 0 : 0;
      return { ...row, later, odds, cost: Math.max(0, row.now - later) };
    })
    .sort((a, b) => b.cost - a.cost);
}

/**
 * The pick this turn is for, and who to take instead when he goes first.
 *
 * A single name is the right answer while he is on the board and no answer at
 * all the moment somebody else takes him, which off the clock is most of the
 * time you spend looking at it. So the same question is asked again with him
 * removed: the board re-prices, and whoever comes out on top is the honest
 * second choice. Repeat, and the list runs as deep as asked.
 *
 * Removing him is what makes the list worth having. It is not the leaders at
 * the other positions, which is what the cost of waiting panel already lists
 * beside this. Take the best back off the board and the next back inherits
 * both the position's urgency and the leader's slot, so he can come second
 * ahead of every other position — which is the answer a run at one position
 * actually has.
 *
 * Your roster does not move as it walks. He is being taken by somebody else,
 * not by you, so what you still have to start is the same at every step.
 *
 * Only the first name is gated on being a clear enough decision to make. Once
 * there is a pick to name, a tie among the alternatives to it is not a reason
 * to withhold them: they are alternatives, and near-equal ones are the most
 * useful kind.
 */
export function recommendChain(
  available: Player[],
  all: Player[],
  teams: number,
  roster: RosterSlots,
  currentPick: number,
  targetPick: number | null,
  room: Forecast | null,
  mine: Record<Position, number>,
  depth: number,
): Recommendation[] {
  const priced = pricedPositions(available, all, teams, roster, currentPick, targetPick, room);
  const first = recommendPick(priced, mine, roster);
  if (!first) return [];

  const out = [first];
  let left = available;
  while (out.length < depth) {
    const gone = out[out.length - 1].player.id;
    left = left.filter((p) => p.id !== gone);
    /*
     * The room's own reading is reused rather than re-simulated. Its survival
     * odds are per player and stay true, and its expected best still counts
     * the man just removed, which can only understate what the next one costs
     * to wait for. A cautious alternative is the safe direction to be wrong
     * in, and a simulation per name is not worth paying for on every render.
     */
    const next = rankCandidates(
      pricedPositions(left, all, teams, roster, currentPick, targetPick, room),
      mine,
      roster,
    )[0];
    if (!next) break;
    out.push(next);
  }
  return out;
}
