/**
 * A check on the draft engine that runs without a browser.
 *
 *   npm run engine:test
 *
 * It pulls a real board from the data service, runs whole drafts, and asserts
 * the things a mock draft has to get right: every team fills a lineup, nobody
 * holds three kickers, the snake order is a snake, and the position dials move
 * the board in the direction the label promises.
 */

import { existsSync, readFileSync } from 'node:fs';

import { PRESETS, DEFAULT_CPU, applyBias, biasLever } from './cpu';
import {
  autoDraftRest, availablePlayers, createDraft, currentPick, currentTeam, draftPlayer,
  nextUserChoice, nextUserPick, presetFor, runCpuPick, runPresetsOnly, runToUserTurn, undoPick,
} from './draft';
import { boardCsv } from './exportBoard';
import { NO_FIXTURES, loadFixtures } from './fixtures';
import { biggestSteals, gradeDraft } from './grade';
import { mergePresets } from './live';
import {
  keeperPicksIn, pickOrder, picksForTeam, picksInRound, roundOrder, seatOf,
} from './order';
import { DEFAULT_ROSTER, bestLineup, emptyCounts, rosterSize, startersFilled } from './roster';
import { positionValues, recommendPick, replacementPoints } from './value';
import { forecast, observedLean, priorLean } from './forecast';
import type { Board, CpuConfig, LeagueConfig, Position, RosterSlots } from './types';
import { POSITIONS } from './types';

const API = process.env.API || 'http://localhost:5178';

/**
 * The real leagues to check against, or null when nobody named any.
 *
 * The blocks that need one say they were skipped rather than fail. Everything
 * that runs off the board alone still runs. See `fixtures.ts`.
 */
const fixtures = loadFixtures();

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log('  pass  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : ''));
  }
}

function league(over: Partial<LeagueConfig> = {}): LeagueConfig {
  const roster: RosterSlots = { ...DEFAULT_ROSTER, ...(over.roster || {}) };
  return {
    teamNames: null,
    tradedPicks: null,
    teams: 12,
    rounds: rosterSize(roster),
    mySlot: 5,
    draftType: 'snake',
    scoring: 'half-ppr',
    adpSource: 'sleeper',
    year: 2026,
    seed: 12345,
    ...over,
    roster,
  };
}

function runDraft(board: Board, lg: LeagueConfig, cpu: CpuConfig) {
  let engine = createDraft(lg, cpu, board.players, null);
  engine = autoDraftRest(engine);
  return engine;
}

/**
 * The overall pick the nth player at a position went at.
 *
 * This is the metric that answers "did the dial work", and the average round is
 * not. Forcing a position drafts more of them, which drags deeper and cheaper
 * players into the average and hides the very move you asked for.
 */
function nthAt(engine: ReturnType<typeof runDraft>, pos: Position, n: number): number {
  const hits = engine.state.picks.filter((p) => engine.byId.get(p.playerId)?.position === pos);
  return hits[n - 1] ? hits[n - 1].overall : NaN;
}

/** The average round a position came off the board in. */
function averageRound(engine: ReturnType<typeof runDraft>, pos: Position): number {
  const rounds = engine.state.picks
    .filter((p) => engine.byId.get(p.playerId)?.position === pos)
    .map((p) => p.round);
  if (!rounds.length) return NaN;
  return rounds.reduce((a, b) => a + b, 0) / rounds.length;
}

async function main() {
  console.log('Fetching a live board from ' + API);
  const res = await fetch(API + '/api/board?scoring=half-ppr&teams=12&adpSource=sleeper');
  if (!res.ok) throw new Error('The data service is not running. Start it with: npm run dev:server');
  const board: Board = await res.json();
  console.log('Board: ' + board.players.length + ' players, join rate '
    + Math.round(board.meta.joinRate * 100) + '%\n');

  console.log('Pick order');
  {
    const snake = pickOrder('snake', 12, 3);
    check('snake round 1 runs 1 to 12', snake.slice(0, 12).join() === '0,1,2,3,4,5,6,7,8,9,10,11');
    check('snake round 2 runs 12 to 1', snake.slice(12, 24).join() === '11,10,9,8,7,6,5,4,3,2,1,0');
    const linear = pickOrder('linear', 12, 2);
    check('linear never reverses', linear.slice(0, 12).join() === linear.slice(12, 24).join());
    const trr = pickOrder('third-round-reversal', 12, 3);
    check('third round repeats round two', trr.slice(12, 24).join() === trr.slice(24, 36).join());
    const mine = picksForTeam('snake', 12, 4, 4);
    check('slot 5 owns picks 5, 20, 29, 44', mine.join() === '5,20,29,44', mine.join());
  }

  console.log('\nTraded picks');
  {
    // Slot 5 sells its second to slot 1. In a snake round two that pick is
    // overall 20, and it must stay at 20: a trade changes the hand that makes
    // a pick, never where the pick sits.
    const trade = [{ round: 2, fromSlot: 5, toSlot: 1 }];
    const order = pickOrder('snake', 12, 4, trade);
    check('a traded pick keeps its place in the order',
      order.length === 48 && order[19] === 0, 'overall 20 -> team ' + order[19]);
    check('the seller loses it',
      !picksForTeam('snake', 12, 4, 4, trade).includes(20));
    check('the buyer gains it',
      picksForTeam('snake', 12, 4, 0, trade).includes(20));
    check('no other pick moves',
      pickOrder('snake', 12, 4).filter((t, i) => t !== order[i]).length === 1);

    // Two of one round and none of another is the case every "one pick per
    // team per round" assumption in this app used to get wrong.
    check('a team can hold two picks in a round',
      picksInRound('snake', 12, 2, 0, trade).join() === '20,24',
      picksInRound('snake', 12, 2, 0, trade).join());
    check('a team can hold none',
      picksInRound('snake', 12, 2, 4, trade).length === 0);
    check('the seat a pick sits in does not change', seatOf('snake', 12, 20) === 4);

    // A trade out and back is two rows in Sleeper's feed and no change here.
    check('a pick traded away and bought back is unchanged',
      pickOrder('snake', 12, 4, [{ round: 2, fromSlot: 5, toSlot: 5 }]).join()
        === pickOrder('snake', 12, 4).join());

    // Every pick still belongs to exactly one team, and the draft is the same
    // length. A swap that loses or duplicates a pick would desync the board.
    const swapped = pickOrder('snake', 12, 16, [
      { round: 3, fromSlot: 2, toSlot: 11 }, { round: 3, fromSlot: 11, toSlot: 2 },
    ]);
    check('a two way swap keeps the draft the same length', swapped.length === 192);
    check('a two way swap gives each side the same number of picks',
      swapped.filter((t) => t === 1).length === swapped.filter((t) => t === 10).length);

    const lg = league({ teams: 12, rounds: 4, mySlot: 5, tradedPicks: trade });
    const engine = autoDraftRest(createDraft(lg, DEFAULT_CPU, board.players, null));
    check('a draft with a traded pick still makes every pick',
      engine.state.picks.length === 48, String(engine.state.picks.length));
    check('the buyer ends up with the extra player',
      engine.state.teams[0].playerIds.length === 5, String(engine.state.teams[0].playerIds.length));
    check('the seller ends up one short',
      engine.state.teams[4].playerIds.length === 3, String(engine.state.teams[4].playerIds.length));
    check('the pick at 20 was made by the buyer',
      engine.state.picks.find((p) => p.overall === 20)?.teamIndex === 0);

    /*
     * Which pick a keeper costs, when a team holds several in the round.
     *
     * Seat 4 bought round eight from seats 11 and 5 and still owns its own, so
     * it holds 8.02, 8.08 and 8.09. A keeper costing "a round eight pick" costs
     * 8.09: the one the seat owns by right. Taking the earliest instead spent
     * the pick bought from seat 11, and the board showed the keeper sitting in
     * that manager's slot.
     */
    const many = [
      { round: 8, fromSlot: 11, toSlot: 4 },
      { round: 8, fromSlot: 5, toSlot: 4 },
    ];
    const held = picksInRound('snake', 12, 8, 3, many);
    check('a team can hold three picks in one round', held.join() === '86,92,93', held.join());
    const forKeeper = keeperPicksIn('snake', 12, 8, 3, many);
    check('a keeper costs the seat its own pick first', forKeeper[0] === 93,
      'first choice ' + forKeeper[0]);
    check('the bought picks are still available to spend',
      forKeeper.slice(1).sort().join() === '86,92', forKeeper.slice(1).join());
    check('a seat that sold its own falls back on one it bought',
      keeperPicksIn('snake', 12, 8, 3, [...many, { round: 8, fromSlot: 4, toSlot: 1 }])[0] === 86);
  }

  console.log('\nResuming a mock from a real draft');
  {
    const lg = league({ teams: 12, rounds: 4, mySlot: 5 });
    const ids = board.players.slice(0, 30).map((p) => p.id);

    // Three keepers, and a draft that has run eleven picks. Two of the keepers
    // were among those eleven, because a draft records its keepers as picks.
    const keepers = [
      { overall: 3, playerId: ids[0], source: 'keeper' as const },
      { overall: 9, playerId: ids[1], source: 'keeper' as const },
      { overall: 40, playerId: ids[2], source: 'keeper' as const },
    ];
    const live = Array.from({ length: 11 }, (_, i) => ({
      overall: i + 1,
      playerId: i === 2 ? ids[0] : (i === 8 ? ids[1] : ids[10 + i]),
      source: 'live' as const,
    }));

    const merged = mergePresets(keepers, live);
    check('the real picks and the keepers ahead of them all survive',
      merged.length === 12, String(merged.length));
    check('a keeper the draft has already taken does not claim a second slot',
      merged.filter((p) => p.playerId === ids[0]).length === 1);
    check('the real pick wins where the two disagree',
      merged.find((p) => p.overall === 3)?.source === 'live');
    check('a keeper the draft has not reached is left alone',
      merged.find((p) => p.overall === 40)?.source === 'keeper');
    check('the claims are in pick order',
      merged.every((p, i) => i === 0 || p.overall > merged[i - 1].overall));

    // The whole point: the picks made stay made, and the rest is simulated.
    const resumed = autoDraftRest(createDraft(lg, DEFAULT_CPU, board.players, null, merged));
    check('a resumed mock still finishes the draft',
      resumed.state.picks.length === 48, String(resumed.state.picks.length));
    check('the picks the room really made are the ones on the board',
      live.every((p) => resumed.state.picks.find((made) => made.overall === p.overall)
        ?.playerId === p.playerId));
    check('the keeper past the live point is still honoured',
      resumed.state.picks.find((p) => p.overall === 40)?.playerId === ids[2]);
    check('nobody appears twice',
      new Set(resumed.state.picks.map((p) => p.playerId)).size === resumed.state.picks.length);
  }

  console.log('\nRoster maths');
  {
    const r = DEFAULT_ROSTER;
    check('default roster is 15 rounds', rosterSize(r) === 15, String(rosterSize(r)));
    const three = { QB: 3, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 } as Record<Position, number>;
    check('three quarterbacks fill one slot', startersFilled(three, r) === 1, String(startersFilled(three, r)));
    const flexed = { QB: 1, RB: 3, WR: 2, TE: 1, K: 1, DEF: 1 } as Record<Position, number>;
    check('the third back takes the flex', startersFilled(flexed, r) === 9, String(startersFilled(flexed, r)));
  }

  console.log('\nA consensus of three sources');
  {
    const res = await fetch(API + '/api/board?scoring=half-ppr&teams=12&adpSource=consensus');
    const con = (await res.json()) as Board;
    const m = con.meta as unknown as Record<string, number>;

    check('ESPN ranked most of the board', (m.espnRanked ?? 0) > 400, String(m.espnRanked));
    check('some players carry all three opinions', (m.consensusOfThree ?? 0) > 100,
      String(m.consensusOfThree));
    console.log('        ' + m.espnRanked + ' ranked by ESPN, ' + m.consensusOfThree
      + ' with all three, ' + m.consensusOfTwo + ' with two');

    const rated = con.players.filter((p) => (p.consensusVotes ?? 0) >= 3);
    check('a consensus never rests on one opinion',
      con.players.every((p) => p.consensus == null || (p.consensusVotes ?? 0) >= 1));
    check('a lone opinion has nothing to disagree with',
      con.players.every((p) => (p.consensusVotes ?? 0) > 1 || p.consensusSpread == null));

    /*
     * A rank is not a pick number. ESPN ranks about twelve hundred players and
     * a draft makes a hundred and eighty picks, so ESPN's raw rank averaged
     * against an ADP puts every defence a hundred picks adrift of where anyone
     * drafts one. The mapped number is what has to sit on the market's scale.
     */
    const plain = await (await fetch(API + '/api/board?scoring=half-ppr&teams=12')).json() as Board;
    const mapped = con.players.filter((p) => p.espnPick != null);
    // The mapping draws its values from the plain board's own ADPs, so every
    // mapped number has to be one of them and none can fall outside that range.
    const floor = Math.min(...plain.players.map((p) => p.adp));
    const ceiling = Math.max(...plain.players.map((p) => p.adp));
    check('ESPN sits inside the range the market uses',
      mapped.every((p) => p.espnPick! >= floor && p.espnPick! <= ceiling),
      floor.toFixed(1) + ' to ' + ceiling.toFixed(1)
        + ', worst ' + Math.max(...mapped.map((p) => p.espnPick!)).toFixed(1));

    /*
     * The point of the mapping, stated as a number rather than as an intention:
     * ESPN's opinion should end up closer to the market than its raw rank was,
     * because most of that raw distance was the length of ESPN's list and not a
     * disagreement about anybody. What is left after it is the real argument.
     */
    const gap = (pick: (p: typeof mapped[number]) => number) => mapped
      .reduce((n, p) => n + Math.abs(pick(p) - (p.sleeperAdp ?? p.ffcAdp ?? 0)), 0) / mapped.length;
    const raw = gap((p) => p.espnRank!);
    const put = gap((p) => p.espnPick!);
    console.log('        mean distance from the market: rank ' + raw.toFixed(1)
      + ' picks, mapped ' + put.toFixed(1) + ' picks');
    check('mapping moves ESPN towards the market, not away', put < raw * 0.6,
      raw.toFixed(1) + ' -> ' + put.toFixed(1));

    /*
     * Defences were the worst case and so are the clearest check. What is
     * asserted is that the rescale closed most of the gap, NOT that ESPN ends
     * up agreeing with the market about them: it does not, it rates them later
     * than anyone drafts them, and that surviving disagreement is a real
     * opinion rather than an artefact of how long ESPN's list is.
     */
    const defs = con.players.filter((p) => p.position === 'DEF' && p.espnPick != null);
    const defGap = defs
      .reduce((n, p) => n + Math.abs(p.espnPick! - (p.sleeperAdp ?? p.ffcAdp ?? 0)), 0) / defs.length;
    console.log('        defences still sit ' + defGap.toFixed(0)
      + ' picks off the market after the rescale, against '
      + put.toFixed(0) + ' for the board, so ESPN abstains on them');
    check('ESPN abstains on kickers and defences',
      con.players.every((p) => (p.position !== 'K' && p.position !== 'DEF') || !p.espnVotes));
    /*
     * A defence anybody drafts is still priced, by the two market sources.
     * The eight sitting past pick 600 on Sleeper and unranked by FFC are not:
     * no source puts them inside a draft, so none of them votes and there is
     * no consensus to report, which is the honest answer rather than a number.
     */
    check('a defence anyone drafts is still priced by the market',
      defs.filter((p) => p.adp <= 240).every((p) => p.consensus != null));
    check('a player no source puts in a draft gets no consensus',
      con.players.filter((p) => p.consensus == null)
        .every((p) => (p.sleeperAdp ?? 999) > 240 && (p.ffcAdp ?? 999) > 240));
    check('the disagreement flag is not buried by defences', (() => {
      const worst30 = con.players.filter((p) => (p.consensusSpread ?? 0) > 0)
        .sort((a, b) => (b.consensusSpread ?? 0) - (a.consensusSpread ?? 0)).slice(0, 30);
      return worst30.filter((p) => p.position === 'DEF' || p.position === 'K').length < 8;
    })());

    /* The mapping must not reorder ESPN's own opinion, only rescale it. */
    const pairs = mapped.slice().sort((a, b) => a.espnRank! - b.espnRank!);
    check('the mapping keeps ESPN\u2019s own order',
      pairs.every((p, i) => i === 0 || pairs[i - 1].espnPick! <= p.espnPick!));

    check('the consensus lies between the sources it averages',
      rated.every((p) => {
        const votes = [p.sleeperAdp, p.ffcAdp, p.espnPick].filter((v): v is number => v != null);
        return p.consensus! >= Math.min(...votes) - 0.01
          && p.consensus! <= Math.max(...votes) + 0.01;
      }));
    check('the spread is the distance between the outermost sources',
      rated.every((p) => {
        const votes = [p.sleeperAdp, p.ffcAdp, p.espnPick].filter((v): v is number => v != null);
        return Math.abs((p.consensusSpread ?? 0) - (Math.max(...votes) - Math.min(...votes))) < 0.02;
      }));

    const board = con.players;
    check('the consensus board is still a board in order',
      board.every((p, i) => i === 0 || board[i - 1].adp <= p.adp));

    const worst = rated.slice(0, 150).sort(
      (a, b) => (b.consensusSpread ?? 0) - (a.consensusSpread ?? 0),
    )[0];
    if (worst) {
      console.log('        most argued over inside 150: ' + worst.name + ' — Sleeper '
        + worst.sleeperAdp + ', FFC ' + worst.ffcAdp + ', ESPN ' + worst.espnPick?.toFixed(1));
    }

    /* A board built off the consensus is a different board, or it did nothing. */
    const moved = con.players.slice(0, 100)
      .filter((p, i) => plain.players[i]?.id !== p.id).length;
    check('choosing the consensus changes the board', moved > 0, moved + ' of the top 100 moved');
  }

  console.log('\nThe cost of waiting');
  {
    const r = DEFAULT_ROSTER;
    const all = board.players;
    const byAdp = [...all].sort((a, b) => a.adp - b.adp);
    /** A rough draft state: the players the market takes first are gone. */
    const after = (n: number) => byAdp.slice(n);

    const rep = replacementPoints(all, 12, r);
    check('every position has a replacement level', POSITIONS.every((p) => rep[p] > 0),
      JSON.stringify(rep));
    check('a replacement is worse than the best player at his position',
      POSITIONS.every((pos) => {
        const top = all.filter((p) => p.position === pos && p.points != null)
          .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
        return !top || (top.points ?? 0) > rep[pos];
      }));
    /*
     * Kickers and defences never appear inside the starter window, so before
     * the floor was added the best kicker on the board was his own replacement
     * and every kicker priced at exactly zero.
     */
    const kickers = all.filter((p) => p.position === 'K' && p.points != null)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    check('the best kicker is not his own replacement',
      (kickers[0]?.points ?? 0) > rep.K, (kickers[0]?.points ?? 0) + ' vs ' + rep.K);

    check('replacement level does not move as the draft runs',
      JSON.stringify(replacementPoints(all, 12, r))
        === JSON.stringify(replacementPoints(all, 12, r)));
    const deeper = replacementPoints(all, 14, r);
    check('a deeper league has a worse replacement back', deeper.RB < rep.RB,
      deeper.RB + ' vs ' + rep.RB);

    const at20 = positionValues(after(19), all, 12, r, 20, 29);
    check('every position is priced', at20.length === POSITIONS.length, String(at20.length));
    check('waiting is never free money', at20.every((v) => v.cost >= -1e-9),
      at20.map((v) => v.position + ' ' + v.cost.toFixed(1)).join(' '));
    check('the costliest position comes first',
      at20.every((v, i) => i === 0 || at20[i - 1].cost >= v.cost));
    check('the best available at a position is the one shown',
      at20.every((v) => {
        const pool = after(19).filter((p) => p.position === v.position && p.points != null);
        return !pool.length || pool.every((p) => (p.points ?? 0) <= (v.best?.points ?? 0));
      }));

    /*
     * The whole claim of the panel: a longer wait costs more. Sixteen picks
     * away cannot be cheaper than seven picks away at any position.
     */
    const soon = positionValues(after(19), all, 12, r, 20, 27);
    const late = positionValues(after(19), all, 12, r, 20, 44);
    check('a longer wait never costs less',
      POSITIONS.every((pos) => {
        const a = soon.find((v) => v.position === pos);
        const b = late.find((v) => v.position === pos);
        return !a || !b || b.cost >= a.cost - 1e-9;
      }),
      POSITIONS.map((pos) => pos + ' ' + (soon.find((v) => v.position === pos)?.cost ?? 0).toFixed(0)
        + '->' + (late.find((v) => v.position === pos)?.cost ?? 0).toFixed(0)).join(' '));

    const back = at20.find((v) => v.position === 'RB');
    const tight = at20.find((v) => v.position === 'TE');
    console.log('        at pick 20 with your next at 29: '
      + at20.map((v) => v.position + ' ' + v.cost.toFixed(0)).join(', '));
    check('a run of similar players is cheap to wait on',
      !back || !tight || back.beforeCliff >= 1);

    check('no next pick means nothing to lose by waiting',
      positionValues(after(19), all, 12, r, 20, null).every((v) => v.cost === 0));

    /*
     * A position emptied of everyone worth starting is left out rather than
     * priced at zero, which would read as "no drop off" and mean "nobody left".
     */
    const noBacks = after(19).filter((p) => p.position !== 'RB');
    check('a position with nobody left is not priced',
      positionValues(noBacks, all, 12, r, 20, 29).every((v) => v.position !== 'RB'));
  }

  console.log('\nThe pick it recommends');
  {
    const r = DEFAULT_ROSTER;
    const all = board.players;
    const byAdp = [...all].sort((a, b) => a.adp - b.adp);
    const after = (n: number) => byAdp.slice(n);
    const counts = (held: Partial<Record<Position, number>>) => ({ ...emptyCounts(), ...held });
    const priced = positionValues(after(19), all, 12, r, 20, 29);

    const empty = recommendPick(priced, counts({}), r);
    check('an empty roster gets a recommendation', empty != null,
      empty ? empty.player.name + ' ' + empty.player.position : 'none');
    check('and it is somebody still available',
      !empty || after(19).some((p) => p.id === empty.player.id));
    check('and it is the leader at his own position',
      !empty || after(19)
        .filter((p) => p.position === empty.player.position && p.points != null)
        .every((p) => (p.points ?? 0) <= (empty.player.points ?? 0)));
    check('and he is worth more than a replacement', !empty || empty.worth > 0,
      empty ? empty.worth.toFixed(1) : '');

    /*
     * The whole point of reading the roster. A position filled to its cap
     * cannot be the recommendation however much the best man left is worth.
     */
    const stuffed = recommendPick(priced, counts({ QB: 9, TE: 9, K: 9, DEF: 9 }), r);
    check('a position filled to its cap is never the pick',
      !stuffed || !['QB', 'TE', 'K', 'DEF'].includes(stuffed.player.position),
      stuffed ? stuffed.player.position : 'none');

    /*
     * Urgency is only yours while you still have to start one. Filling every
     * starting slot can only take urgency away, so the score cannot rise.
     */
    const full = counts({ QB: 3, RB: 6, WR: 6, TE: 3, K: 2, DEF: 2 });
    const late = recommendPick(priced, full, r);
    check('a full lineup adds no urgency to anybody',
      !late || late.urgency === 0, late ? String(late.urgency) : 'none');

    check('nothing is recommended out of an empty pool',
      recommendPick([], counts({}), r) === null);

    /*
     * Saying nothing is a real answer. Two positions within a field goal of
     * each other is not a decision, and naming one would invent it.
     */
    const tied = priced.slice(0, 2).map((v, i) => ({ ...v, now: 50, cost: i === 0 ? 1 : 0.5 }));
    check('a tie close enough to be noise is left unnamed',
      recommendPick(tied, counts({}), r) === null);
  }

  console.log('\nReading the room');
  {
    const play = (cpu: CpuConfig, n: number) => {
      let e = createDraft(league(), cpu, board.players, null);
      while (e.state.picks.length < n && !e.state.done) e = runCpuPick(e);
      return e;
    };
    const leanOf = (id: string, picks = 36) => {
      const preset = PRESETS.find((p) => p.id === id)!;
      return observedLean(play(preset.cpu, picks));
    };

    /*
     * Quarterbacks need a deeper draft before the reading means anything.
     *
     * A lean is a surplus counted against a no-lean room, so its signal is only
     * as big as the number of picks the position has taken. Three rounds of a
     * twelve team draft hold two or three quarterbacks, and the difference
     * between a room forcing them and an ordinary one was a single pick: over
     * eight seeds the gap ran 0.8 to 3.3, and one seed in eight read under the
     * threshold on noise alone. Four rounds is enough that quarterbacks are
     * actually coming off the board, and the same eight seeds then run 1.7 to
     * 4.2 with none under it.
     *
     * The backs need no such thing, and are still read at three rounds: they go
     * from the first pick, so the sample is there from the start. This is a
     * fact about scarce positions rather than a weakness in the reading, and it
     * is the same reason `observedLean` says nothing at all before a full round.
     */
    const QB_PICKS = 48;

    const market = leanOf('market');
    const robust = leanOf('robust-rb');
    const zero = leanOf('zero-rb');
    const marketDeep = leanOf('market', QB_PICKS);
    const earlyQb = leanOf('early-qb', QB_PICKS);

    console.log('        market ' + POSITIONS.map((p) => p + ' ' + market[p].toFixed(1)).join(' '));
    console.log('        zero RB ' + POSITIONS.map((p) => p + ' ' + zero[p].toFixed(1)).join(' '));

    /*
     * The baseline is a simulated room with its dials at zero, not the ADP
     * order. Measured against ADP an ordinary room reads as almost two points
     * of anti-receiver lean, purely because ADP knows nothing about starting
     * slots, and that lean would then be applied on top of the very roster
     * need bonus that produced it.
     */
    check('an ordinary room reads as no lean',
      POSITIONS.every((p) => Math.abs(market[p]) < 1.5),
      POSITIONS.map((p) => p + ' ' + market[p].toFixed(1)).join(' '));

    check('a room forcing backs reads as forcing backs', robust.RB > 1.5, robust.RB.toFixed(1));
    check('a room fading backs reads as fading backs', zero.RB < -1.5, zero.RB.toFixed(1));
    check('the two rooms are read apart', robust.RB - zero.RB > 4,
      robust.RB.toFixed(1) + ' vs ' + zero.RB.toFixed(1));
    check('a receiver room reads as a receiver room', zero.WR > market.WR + 1.5,
      zero.WR.toFixed(1) + ' vs ' + market.WR.toFixed(1));
    check('a quarterback run reads on the quarterback dial',
      earlyQb.QB > marketDeep.QB + 1,
      earlyQb.QB.toFixed(1) + ' vs ' + marketDeep.QB.toFixed(1) + ' at ' + QB_PICKS + ' picks');

    check('less than a round is not a reading',
      POSITIONS.every((p) => observedLean(play(PRESETS[3].cpu, 6))[p] === 0));
  }

  console.log('\nForecasting the rest of the round');
  {
    let e = createDraft(league(), DEFAULT_CPU, board.players, null);
    while (e.state.picks.length < 36 && !e.state.done) e = runCpuPick(e);

    const from = currentPick(e.state);
    const target = nextUserPick(e.state)!;
    const f = forecast(e, 120)!;

    check('a forecast is made', !!f && f.targetPick === target, String(f?.targetPick));
    check('every chance is a chance',
      [...f.survival.values()].every((v) => v >= 0 && v <= 1));
    check('a player already gone has no chance to survive',
      e.state.picks.every((p) => !f.survival.has(p.playerId)));
    check('the picks it forecasts are the picks that happen',
      Math.abs(POSITIONS.reduce((n, p) => n + f.taken[p], 0) - (target - from)) < 1e-6,
      POSITIONS.reduce((n, p) => n + f.taken[p], 0) + ' vs ' + (target - from));

    /*
     * The forecast has to be replayable for the same reason the draft does:
     * a number that changes when nothing changed cannot be acted on.
     */
    const again = forecast(e, 120)!;
    check('the same board forecasts the same way',
      [...f.survival].every(([id, v]) => again.survival.get(id) === v));

    /* A player the whole room wants cannot be likelier to last than one nobody
     * has a slot for, however their ADP reads. */
    const top = e.state.availableIds.map((id) => e.byId.get(id)!)
      .sort((a, b) => a.adp - b.adp);
    check('the best player left is not the likeliest to last',
      (f.survival.get(top[0].id) ?? 0) <= (f.survival.get(top[40].id) ?? 1) + 1e-9,
      (f.survival.get(top[0].id) ?? 0) + ' vs ' + (f.survival.get(top[40].id) ?? 1));

    const later = { ...e, state: { ...e.state, league: { ...e.state.league, mySlot: 5 } } };
    check('a forecast with no turn left is no forecast',
      forecast({ ...later, state: { ...later.state, done: true } }) === null);

    const runs = POSITIONS.map((p) => p + ' ' + f.taken[p].toFixed(1)).join(' ');
    console.log('        of the ' + (target - from) + ' picks before your turn: ' + runs);
  }

  console.log('\nWhat the room says before it drafts');
  {
    /*
     * Yahoo publishes its own ADP, so a room that drafts quarterbacks early can
     * be read before a pick is made rather than a round late. The fit has to
     * recover a dial that was actually applied, or it is not measuring one.
     */
    const all = board.players;
    /** A room exactly like this board, except it moves one position by `level`. */
    const roomWhere = (pos: Position, level: number, cap = 140) => new Map(
      all.filter((p) => p.adp <= cap)
        .map((p) => [p.id, p.position === pos ? applyBias(p.adp, level) : p.adp]),
    );

    check('a room that drafts nothing differently reads as no lean',
      POSITIONS.every((p) => Math.abs(priorLean(all, roomWhere('QB', 0))[p]) < 0.05),
      POSITIONS.map((p) => p + ' ' + priorLean(all, roomWhere('QB', 0))[p].toFixed(2)).join(' '));

    for (const level of [3, -3, 1.5]) {
      const got = priorLean(all, roomWhere('QB', level)).QB;
      check('a room forcing quarterbacks at ' + level + ' is read back as ' + level,
        Math.abs(got - level) < 0.25, got.toFixed(2));
    }

    const only = priorLean(all, roomWhere('QB', 4));
    check('the position that moved is the only one that reads',
      POSITIONS.filter((p) => p !== 'QB').every((p) => Math.abs(only[p]) < 0.05),
      POSITIONS.map((p) => p + ' ' + only[p].toFixed(2)).join(' '));

    /*
     * Yahoo reported an ADP for three kickers and fifty four receivers, and
     * those three fitted a dial of 2.3. A number about three players is not a
     * number about kickers.
     */
    const thin = new Map([...roomWhere('K', 5)].filter(([id]) => {
      const p = all.find((x) => x.id === id)!;
      return p.position !== 'K' || all.filter((x) => x.position === 'K').indexOf(p) < 3;
    }));
    check('three of a position is not a reading about the position',
      priorLean(all, thin).K === 0, priorLean(all, thin).K.toFixed(2));

    check('no readings at all is no lean, not a lean of zero confidence',
      POSITIONS.every((p) => priorLean(all, new Map())[p] === 0));

    // The fit inverts applyBias, so it has to be reading the same lever.
    check('the fit and the dial agree on what a dial does',
      Math.abs(applyBias(100, 5) - (100 - biasLever(100))) < 1e-9,
      applyBias(100, 5).toFixed(3) + ' vs ' + (100 - biasLever(100)).toFixed(3));

    /*
     * The prior is a stand-in, not a rival. Once the picks can speak the
     * measurement of this draft wins over a measurement of Yahoo at large.
     */
    const teams = 12;
    const lg = league({ teams });
    const fresh = createDraft(lg, DEFAULT_CPU, all, null);
    const loud = { QB: 5, RB: -5, WR: 0, TE: 0, K: 0, DEF: 0 } as Record<Position, number>;
    check('before a round is in, the prior is what the forecast leans on',
      forecast(fresh, 20, loud)?.lean.QB === 5);
    check('and without one it still leans on nothing',
      forecast(fresh, 20)?.lean.QB === 0);

    let full = fresh;
    while (full.state.picks.length < teams) full = runCpuPick(full);
    const after = forecast(full, 20, loud)?.lean;
    check('once a round is in, what happened wins over what was published',
      !!after && after.QB !== 5 && after.RB !== -5,
      after ? 'QB ' + after.QB.toFixed(1) + ' RB ' + after.RB.toFixed(1) : 'none');
  }

  console.log('\nA full draft, market settings');
  {
    const lg = league();
    const engine = runDraft(board, lg, DEFAULT_CPU);
    check('every pick was made', engine.state.picks.length === lg.teams * lg.rounds,
      engine.state.picks.length + ' of ' + lg.teams * lg.rounds);
    check('no player went twice', new Set(engine.state.picks.map((p) => p.playerId)).size === engine.state.picks.length);
    check('the draft reports itself done', engine.state.done);
    check('nobody is on the clock', currentTeam(engine.state) === null);

    let allFieldLineups = true;
    let maxK = 0;
    let maxDef = 0;
    for (const team of engine.state.teams) {
      const players = team.playerIds.map((id) => engine.byId.get(id)!);
      const { starters } = bestLineup(players, lg.roster);
      if (starters.length !== 9) allFieldLineups = false;
      maxK = Math.max(maxK, team.counts.K);
      maxDef = Math.max(maxDef, team.counts.DEF);
    }
    check('every team fields a full lineup', allFieldLineups);
    check('nobody drafted two kickers', maxK <= 1, 'max ' + maxK);
    check('nobody drafted two defences', maxDef <= 1, 'max ' + maxDef);

    // Kickers and defences carry the widest measured ADP spread on the board, so
    // the odd early one is the model telling the truth about real drafts. What
    // must never happen is one in the middle of the draft.
    const kRound = averageRound(engine, 'K');
    const defRound = averageRound(engine, 'DEF');
    const earliest = (pos: Position) => Math.min(...engine.state.picks
      .filter((p) => engine.byId.get(p.playerId)?.position === pos).map((p) => p.round));
    console.log('        kickers average round ' + kRound.toFixed(1)
      + ', earliest ' + earliest('K')
      + '. Defences average ' + defRound.toFixed(1) + ', earliest ' + earliest('DEF'));
    check('kickers land in the back third', kRound >= lg.rounds - 2.2);
    check('defences land in the back third', defRound >= lg.rounds - 2.8);
    check('no kicker goes in the first two thirds', earliest('K') > lg.rounds * 0.66);
    check('no defence goes in the first two thirds', earliest('DEF') > lg.rounds * 0.66);

    /*
     * WHICH WAY VALUE RUNS
     *
     * You beat ADP by taking a player later than the market does. Nothing
     * checked the direction, and it was subtracted the other way round: a
     * kicker taken at pick 5 on an ADP of 200 scored as the best value pick in
     * the draft, at +195.
     */
    {
      const pickAt = new Map(engine.state.picks.map((p) => [p.playerId, p.overall]));
      let fell = null as null | { name: string; adp: number; at: number };
      let reached = null as null | { name: string; adp: number; at: number };
      for (const p of engine.state.picks) {
        const player = engine.byId.get(p.playerId)!;
        const row = { name: player.name, adp: player.adp, at: p.overall };
        if (!fell || row.at - row.adp > fell.at - fell.adp) fell = row;
        if (!reached || row.at - row.adp < reached.at - reached.adp) reached = row;
      }
      console.log('        furthest fall  ' + fell!.name + ' adp ' + fell!.adp.toFixed(1)
        + ' taken at ' + fell!.at);
      console.log('        furthest reach ' + reached!.name + ' adp ' + reached!.adp.toFixed(1)
        + ' taken at ' + reached!.at);

      const steals = biggestSteals(engine, 5);
      check('a steal is a player taken after his ADP',
        steals.every((s) => s.gain > 0 && s.pick.overall > s.player.adp));
      check('the biggest steal is the player who fell furthest',
        steals[0].player.name === fell!.name, steals[0].player.name);
      check('the steal list runs from biggest to smallest',
        steals.every((s, i) => i === 0 || s.gain <= steals[i - 1].gain));

      // A team's value is the sum of the same measure over its own picks.
      const someone = gradeDraft(engine)[0];
      const byHand = someone.players.reduce(
        (sum, p) => sum + ((pickAt.get(p.id) ?? 0) - p.adp), 0,
      );
      check('a team value is the sum of its own picks against ADP',
        Math.abs(someone.value - byHand) < 0.2,
        someone.value + ' against ' + byHand.toFixed(1));
      check('the best value pick fell, and the worst reach did not',
        someone.bestValuePick!.gain >= someone.worstReach!.gain);
    }

    const results = gradeDraft(engine);
    check('every team is graded', results.every((r) => r.grade !== ''));
    check('ranks run 1 to 12', new Set(results.map((r) => r.rank)).size === 12);
    const top = results.find((r) => r.rank === 1)!;
    const bottom = results.find((r) => r.rank === 12)!;
    check('the top team outscores the bottom', top.points > bottom.points,
      top.points + ' against ' + bottom.points);
    console.log('        top lineup ' + top.points.toFixed(1) + ' points, '
      + 'bottom ' + bottom.points.toFixed(1));
  }

  console.log('\nThe position dials');
  {
    check('bias +5 pulls pick 60 forward', applyBias(60, 5) < 36, applyBias(60, 5).toFixed(1));
    check('bias -5 pushes pick 60 back', applyBias(60, -5) > 84, applyBias(60, -5).toFixed(1));
    check('bias 0 changes nothing', applyBias(60, 0) === 60);
    check('bias +5 still moves the top of the board', applyBias(10, 5) < 4, applyBias(10, 5).toFixed(1));

    const lg = league();
    const flat = runDraft(board, lg, DEFAULT_CPU);
    const heavyRb = runDraft(board, lg, {
      ...DEFAULT_CPU,
      positionBias: { QB: 0, RB: 5, WR: 0, TE: 0, K: 0, DEF: 0 },
    });
    const lightRb = runDraft(board, lg, {
      ...DEFAULT_CPU,
      positionBias: { QB: 0, RB: -5, WR: 0, TE: 0, K: 0, DEF: 0 },
    });

    const row = (label: string, e: ReturnType<typeof runDraft>) => label.padEnd(8)
      + ' RB12 at pick ' + String(nthAt(e, 'RB', 12)).padStart(3)
      + ',  RB24 at pick ' + String(nthAt(e, 'RB', 24)).padStart(3)
      + ',  WR12 at pick ' + String(nthAt(e, 'WR', 12)).padStart(3);
    console.log('        ' + row('neutral', flat));
    console.log('        ' + row('forced', heavyRb));
    console.log('        ' + row('avoided', lightRb));

    check('forcing running backs takes RB12 sooner',
      nthAt(heavyRb, 'RB', 12) < nthAt(flat, 'RB', 12) - 2);
    check('forcing running backs takes RB24 sooner',
      nthAt(heavyRb, 'RB', 24) < nthAt(flat, 'RB', 24) - 5);
    check('avoiding running backs takes RB12 later',
      nthAt(lightRb, 'RB', 12) > nthAt(flat, 'RB', 12) + 2);
    check('avoiding running backs takes RB24 later',
      nthAt(lightRb, 'RB', 24) > nthAt(flat, 'RB', 24) + 5);
    check('forcing running backs pushes receivers back',
      nthAt(heavyRb, 'WR', 12) > nthAt(flat, 'WR', 12));

    // Every level in between has to move the board too, or the dial is a switch.
    const rb12 = [-5, -3, 0, 3, 5].map((level) => nthAt(runDraft(board, lg, {
      ...DEFAULT_CPU, positionBias: { QB: 0, RB: level, WR: 0, TE: 0, K: 0, DEF: 0 },
    }), 'RB', 12));
    console.log('        RB12 at settings -5, -3, 0, +3, +5: ' + rb12.join(', '));
    // The metric is a pick number, so neighbouring settings can tie. What has to
    // hold is that the sequence never turns back on itself and that the two ends
    // sit far apart.
    check('the dial never reverses across its range',
      rb12.every((v, i) => i === 0 || v <= rb12[i - 1]), rb12.join(', '));
    check('the two ends of the dial are a round apart',
      rb12[0] - rb12[4] >= 8, String(rb12[0] - rb12[4]));

    void averageRound;
  }

  console.log('\nRandomness and repeatability');
  {
    const lg = league();
    const a = runDraft(board, lg, DEFAULT_CPU);
    const b = runDraft(board, lg, DEFAULT_CPU);
    check('the same seed replays the same draft',
      a.state.picks.map((p) => p.playerId).join() === b.state.picks.map((p) => p.playerId).join());

    const c = runDraft(board, league({ seed: 999 }), DEFAULT_CPU);
    check('a new seed makes a new draft',
      a.state.picks.map((p) => p.playerId).join() !== c.state.picks.map((p) => p.playerId).join());

    const strict = runDraft(board, lg, { ...DEFAULT_CPU, randomness: 0 });
    const strictOrder = strict.state.picks.slice(0, 24).map((p) => strict.byId.get(p.playerId)?.position);
    check('randomness 0 is deterministic', strictOrder.length === 24);

    const chaos = runDraft(board, lg, { ...DEFAULT_CPU, randomness: 10 });
    const spreadStrict = reachSpread(strict);
    const spreadChaos = reachSpread(chaos);
    console.log('        average gap between pick and ADP: '
      + 'randomness 0 is ' + spreadStrict.toFixed(1) + ' picks, '
      + 'randomness 10 is ' + spreadChaos.toFixed(1));
    check('more randomness means more reaching', spreadChaos > spreadStrict * 1.5);
    check('even chaos stays inside the draft', spreadChaos < 70, spreadChaos.toFixed(1));
    const chaosFirst = chaos.byId.get(chaos.state.picks[0].playerId)!;
    check('chaos still opens with a first round player', chaosFirst.adp <= 40,
      chaosFirst.name + ' at ADP ' + chaosFirst.adp);
  }

  console.log('\nRoster need');
  {
    const lg = league({ rounds: 9, roster: { ...DEFAULT_ROSTER, BENCH: 0 } });
    const needy = runDraft(board, lg, { ...DEFAULT_CPU, needWeight: 10 });
    const blind = runDraft(board, lg, { ...DEFAULT_CPU, needWeight: 0 });

    const complete = (e: typeof needy) => e.state.teams.filter((t) => {
      const players = t.playerIds.map((id) => e.byId.get(id)!);
      return bestLineup(players, lg.roster).starters.length === 9;
    }).length;

    console.log('        teams with a full lineup in a 9 round draft: '
      + 'need 10 gives ' + complete(needy) + ' of 12, '
      + 'need 0 gives ' + complete(blind) + ' of 12');
    check('roster need fills every lineup', complete(needy) === 12);
    check('ignoring roster need leaves holes', complete(blind) < 12);
  }

  console.log('\nEvery preset runs');
  for (const preset of PRESETS) {
    const lg = league();
    const engine = runDraft(board, lg, preset.cpu);
    check(preset.name, engine.state.picks.length === lg.teams * lg.rounds);
  }

  console.log('\nOther league shapes');
  {
    // A superflex roster needs the superflex ADP board. Run it against the half
    // PPR board and the room reads quarterbacks as cheap, because on that board
    // they are. The settings panel warns about the same mismatch.
    const sfRes = await fetch(API + '/api/board?scoring=2qb&teams=10&adpSource=sleeper');
    const sfBoard: Board = await sfRes.json();
    const sf = league({
      roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DEF: 1, BENCH: 6 },
      teams: 10,
      scoring: '2qb',
    });
    const engine = runDraft(sfBoard, { ...sf, rounds: rosterSize(sf.roster) }, DEFAULT_CPU);
    const qbPerTeam = engine.state.teams.map((t) => t.counts.QB);
    check('superflex leagues draft two quarterbacks a team',
      qbPerTeam.filter((n) => n >= 2).length >= 8, qbPerTeam.join(' '));

    const deep = league({ teams: 14, roster: { ...DEFAULT_ROSTER, BENCH: 10 } });
    const deepEngine = runDraft(board, { ...deep, rounds: rosterSize(deep.roster) }, DEFAULT_CPU);
    check('a 14 team, 19 round draft completes',
      deepEngine.state.picks.length === 14 * 19, String(deepEngine.state.picks.length));

    const tiny = league({ teams: 4, rounds: 5 });
    const tinyEngine = runDraft(board, tiny, DEFAULT_CPU);
    check('a 4 team, 5 round draft completes', tinyEngine.state.picks.length === 20);
  }

  console.log('\nBlending two ADP sources');
  {
    // Sleeper's board runs past pick 700 and Fantasy Football Calculator stops
    // around 230, so the two do not disagree about a player one puts at 142 and
    // the other at 700. One measured a pick; the other is saying nobody takes
    // him. A source with no pick to report does not vote, and the blend is of
    // whoever did.
    const blendRes = await fetch(API + '/api/board?scoring=half-ppr&teams=12&adpSource=blend');
    const blend: Board = await blendRes.json();
    const deepest = 12 * 20;

    const exiled = blend.players.filter((p) => {
      const best = Math.min(p.sleeperAdp ?? Infinity, p.ffcAdp ?? Infinity);
      return best <= deepest && p.adp > deepest;
    });
    check('a player one source drafts is not blended out of the draft',
      exiled.length === 0,
      exiled.slice(0, 3).map((p) => p.name + ' ' + p.sleeperAdp + '/' + p.ffcAdp
        + ' -> ' + p.adp).join(', '));

    // The fix is abstention, not "Fantasy Football Calculator first". Where both
    // sources actually measured a pick the blend is still the mean of the two.
    const agreed = blend.players.filter((p) => p.sleeperAdp != null && p.ffcAdp != null
      && p.sleeperAdp <= deepest && p.ffcAdp <= deepest);
    const meaned = agreed.filter((p) => Math.abs(p.adp - ((p.sleeperAdp! + p.ffcAdp!) / 2)) < 0.01);
    check('two sources that both measured a pick are averaged',
      agreed.length > 100 && meaned.length === agreed.length,
      meaned.length + ' of ' + agreed.length);

    // Both past the end of any draft is not a reason to drop a player: the
    // board still has to put the tail in some order.
    const tail = blend.players.filter((p) => (p.sleeperAdp ?? 0) > deepest
      && (p.ffcAdp ?? 0) > deepest);
    check('a player no source drafts still holds a place in the tail',
      tail.every((p) => Number.isFinite(p.adp) && p.adp > deepest), String(tail.length));
  }

  console.log('\nChoosing which sources price the board');
  {
    const get = async (adpSource: string) => (await (await fetch(
      API + '/api/board?scoring=half-ppr&teams=12&adpSource=' + encodeURIComponent(adpSource),
    )).json()) as Board;

    /*
     * THE FOUR OLDER NAMINGS STILL MEAN WHAT THEY MEANT.
     *
     * They are what every saved league in somebody's browser holds, and one
     * loaded from last season must open on the board it opened on then.
     *
     * `consensus` is compared only over the players a draft can reach. Past
     * that it now takes the mean of whatever the feeds hold rather than the
     * first of them, which is what `blend` always did: two rules that differed
     * only in a tail nobody drafts are worth less than one rule.
     */
    const deepest12 = 12 * 20;
    for (const [legacy, encoded] of [
      ['sleeper', 'order:sleeper,ffc'],
      ['ffc', 'order:ffc,sleeper'],
      ['blend', 'avg:sleeper,ffc'],
      ['consensus', 'avg:sleeper,ffc,espn'],
    ]) {
      const was = await get(legacy);
      const now = await get(encoded);
      const byKey = new Map(now.players.map((p) => [p.key, p.adp]));
      const drafted = was.players.filter((p) => p.adp <= deepest12);
      check(legacy + ' still means ' + encoded,
        was.players.length === now.players.length
          && drafted.every((p) => Math.abs((byKey.get(p.key) ?? -1) - p.adp) < 0.001)
          && now.meta.adpSource === encoded,
        drafted.length + ' drafted players compared, read as ' + now.meta.adpSource);
    }

    /*
     * A CHOICE MAY NOT EMPTY A POSITION.
     *
     * ESPN abstains on kickers and defences, because its ranks there are the
     * convention that you draft those two last rather than a view about
     * anybody. So ESPN chosen on its own priced neither, and both fell off the
     * board outright: 45 kickers and 32 defences gone, and a league starting
     * one of each could not fill a roster from what was left.
     *
     * The choice decides who is asked first, not who is allowed to answer.
     */
    for (const feed of ['sleeper', 'ffc', 'espn']) {
      const solo = await get('avg:' + feed);
      const counts = solo.meta.positionCounts;
      check(feed + ' alone still prices every position',
        POSITIONS.every((pos) => (counts[pos] || 0) > 0),
        POSITIONS.map((pos) => pos + ' ' + (counts[pos] || 0)).join(' '));
    }

    const espnOnly = await get('avg:espn');
    check('a player the choice has no view on is marked, not silently renumbered',
      espnOnly.players.filter((p) => p.position === 'K').every((p) => p.adpOutsideChoice)
        && espnOnly.players.filter((p) => p.espnVotes).every((p) => !p.adpOutsideChoice),
      String(espnOnly.meta.adpOutsideChoice) + ' priced from outside the choice');

    /* An average is of the feeds named, and of no others. */
    const pair = await get('avg:sleeper,espn');
    const both = pair.players.filter((p) => !p.adpOutsideChoice
      && p.sleeperAdp != null && p.sleeperAdp <= deepest12
      && p.espnPick != null && p.espnVotes && p.espnPick <= deepest12);
    check('an average is of the feeds you named and no others',
      both.length > 100
        && both.every((p) => Math.abs(p.adp - (p.sleeperAdp! + p.espnPick!) / 2) < 0.01),
      both.length + ' priced by both');

    /*
     * A ROOM NOBODY IS IN IS NOT ON OFFER.
     *
     * The app names a room whenever it is following a draft, whatever the
     * platform, because asking is how it learns whether that platform publishes
     * an ADP at all. Naming one that is not there has to cost nothing.
     */
    const noRoom = await get('avg:sleeper,room');
    const plain = await get('avg:sleeper');
    check('a room nobody has posted is dropped rather than refused',
      JSON.stringify(noRoom.meta.adpFeeds) === JSON.stringify(['sleeper'])
        && !noRoom.meta.adpOffered.includes('room'),
      JSON.stringify(noRoom.meta.adpFeeds) + ' of ' + JSON.stringify(noRoom.meta.adpOffered));
    check('and the board it prices is the one without it',
      noRoom.players.length === plain.players.length
        && noRoom.players.every((p, i) => p.key === plain.players[i].key
          && p.adp === plain.players[i].adp));
  }

  console.log('\nEntering the picks by hand');
  {
    /*
     * A draft on a site this app cannot read is still a draft worth having the
     * board for, so assistant mode can take the picks typed in instead. The
     * whole feature rests on one property of the engine: a pick is recorded
     * against whoever is on the clock, not against you. Typing somebody else's
     * pick has to fill their roster, or a board built this way is a board of
     * one team holding everyone.
     */
    const lg = league({ mySlot: 5 });
    let e = createDraft(lg, DEFAULT_CPU, board.players, null);
    const byAdp = [...board.players].sort((a, b) => a.adp - b.adp);

    check('the first pick is not yours', !currentTeam(e.state)?.isUser);
    e = draftPlayer(e, byAdp[0].id);
    check('a pick typed on their turn is theirs, not yours',
      e.state.teams[0].playerIds[0] === byAdp[0].id
        && e.state.teams.find((t) => t.isUser)!.playerIds.length === 0);

    // Four more, taking the board down to your own turn at slot 5.
    for (let i = 1; i < 4; i += 1) e = draftPlayer(e, byAdp[i].id);
    check('the clock reaches you after four more', !!currentTeam(e.state)?.isUser,
      'pick ' + currentPick(e.state));
    e = draftPlayer(e, byAdp[4].id);
    check('your own pick is still yours',
      e.state.teams.find((t) => t.isUser)!.playerIds[0] === byAdp[4].id);

    check('every pick landed on a different team',
      new Set(e.state.picks.map((p) => p.teamIndex)).size === 5);
    check('the counts follow the players',
      e.state.teams.every((t) => t.playerIds.length === (t.index < 5 ? 1 : 0)));

    // Undo is the only correction a typed board has, so it has to put the
    // player back rather than merely forget the pick.
    const back = undoPick(e);
    check('undo returns the player to the pool',
      back.state.picks.length === 4 && back.state.availableIds.includes(byAdp[4].id));
  }

  console.log('\nThe name matcher');
  {
    const post = async (csv: string, overrides: Record<string, string | null> = {}) => {
      const r = await fetch(API + '/api/rankings?scoring=standard&teams=12&adpSource=sleeper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, overrides }),
      });
      return r.json();
    };

    type Row = { sourceName: string; name: string; position: string; matchedBy: string; rank: number };
    const find = (set: { entries: Row[] }, source: string) => set.entries.find(
      (e) => e.sourceName === source,
    );

    // A shallow board must not lose real players. Before the cross format
    // fallback, standard scoring held 311 of the 599 Sleeper ranks and every
    // missing one was reported to the user as a name that matched nothing.
    const shallow = await fetch(API + '/api/board?scoring=standard&teams=12&adpSource=sleeper');
    const shallowBoard: Board = await shallow.json();
    console.log('        the standard board holds ' + shallowBoard.players.length
      + ' players, ' + shallowBoard.meta.adpBorrowed + ' with an ADP borrowed from another format');
    check('a shallow scoring format still gets a full board',
      shallowBoard.players.length > 550, String(shallowBoard.players.length));

    // A real export carries six columns with "rank" in the name. Only one of
    // them is the ranking, and reading the wrong one sorts your board into
    // market order while still calling it yours.
    const etrHeader = 'Player,Position,Team,ETR Rank,ADP,Ranking Diff,'
      + 'ETR Pos Rank,ADP Pos Rank,Pos Rank Diff,id';
    const etr = await post([
      etrHeader,
      'Jahmyr Gibbs,RB,DET,1,1.5,0.5,RB01,RB01,0,4429795',
      'Kenneth Walker,RB,KC,2,22.7,20.7,RB02,RB09,7,4567048',
      'Omarion Hampton,RB,LAC,3,12.2,9.2,RB03,RB05,2,4685702',
      'Chase Brown,RB,CIN,4,17.8,13.8,RB04,RB07,3,4362238',
    ].join(String.fromCharCode(10)));

    check('the ranking column beats the ADP column',
      etr.columns.rank === 'etr rank', String(etr.columns.rank));
    check('your order is your order, not the market order',
      etr.entries.map((e: Row) => e.name).join(' | ')
        === 'Jahmyr Gibbs | Kenneth Walker | Omarion Hampton | Chase Brown',
      etr.entries.map((e: Row) => e.name).join(' | '));
    check('every header is offered back so the column can be changed',
      etr.columns.headers.length === 10, String(etr.columns.headers.length));

    // THE BOARD HAS TO SURVIVE ITS OWN EXPORT.
    // The download writes the headers this same reader scores, and `Rank` has
    // to beat `ADP` at 40 or the file comes back sorted by the market and
    // still calls itself yours. Every name in it came off
    // the board, so anything short of an exact match on every row is the
    // writer's fault rather than the matcher's.
    const exported = await post(boardCsv(shallowBoard.players));
    check('the exported board picks its own rank column',
      exported.columns.rank === 'rank', String(exported.columns.rank));
    check('the exported board comes back whole',
      exported.entries.length === shallowBoard.players.length
        && exported.unmatched.length === 0,
      exported.entries.length + ' of ' + shallowBoard.players.length + ' rows, '
        + exported.unmatched.length + ' unmatched');
    check('every exported row matches exactly',
      exported.entries.every((e: Row) => e.matchedBy === 'exact'),
      Object.keys(exported.tiers).join(', '));
    check('the exported order is the board order',
      exported.entries.every((e: Row, i: number) => e.name === shallowBoard.players[i].name));

    // And when detection is wrong anyway, pointing at a column wins.
    const forced = await fetch(API + '/api/rankings?scoring=standard&teams=12&adpSource=sleeper', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        csv: [
          etrHeader,
          'Jahmyr Gibbs,RB,DET,1,1.5,0.5,RB01,RB01,0,4429795',
          'Kenneth Walker,RB,KC,2,22.7,20.7,RB02,RB09,7,4567048',
          'Omarion Hampton,RB,LAC,3,12.2,9.2,RB03,RB05,2,4685702',
        ].join(String.fromCharCode(10)),
        rankColumn: 4,
      }),
    }).then((r) => r.json());
    check('choosing a column by hand overrides detection',
      forced.entries.map((e: Row) => e.name).join(' | ')
        === 'Jahmyr Gibbs | Omarion Hampton | Kenneth Walker',
      forced.entries.map((e: Row) => e.name).join(' | '));

    const hard = await post([
      'Player,Pos,Team,Rank',
      'Pat Freiermuth,TE,PIT,1',
      'Kenneth Gainwell,RB,PIT,2',
      'Cameron Ward,QB,TEN,3',
      'WAS DST,DST,,4',
      'Washington Commanders,DST,,5',
      'Mike Evans,WR,TB,6',
      'Nobody Whatsoever,WR,XXX,7',
    ].join(String.fromCharCode(10)));

    check('a deep tight end matches on a shallow board', !!find(hard, 'Pat Freiermuth'));
    check('a short first name matches',
      find(hard, 'Kenneth Gainwell')?.name === 'Kenny Gainwell',
      find(hard, 'Kenneth Gainwell')?.name);
    check('a long first name matches its short form',
      find(hard, 'Cameron Ward')?.name === 'Cam Ward', find(hard, 'Cameron Ward')?.name);
    check('a defence written as an abbreviation matches',
      find(hard, 'WAS DST')?.position === 'DEF', JSON.stringify(find(hard, 'WAS DST')));
    check('two names for one defence collapse to one pick', hard.duplicates === 1,
      String(hard.duplicates));
    check('a name that means nobody is reported, not guessed',
      hard.unmatched.length === 1 && hard.unmatched[0].name === 'Nobody Whatsoever',
      JSON.stringify(hard.unmatched.map((u: { name: string }) => u.name)));

    // A misspelling that shares a surname gets the real players offered to it.
    const near = await post('Player,Pos,Team,Rank' + String.fromCharCode(10)
      + 'Jonathin Tayler,RB,IND,1');
    const suggestions = near.unmatched[0]?.suggestions ?? [];
    check('a misspelt name is offered the players it might have meant',
      suggestions.some((x: { name: string }) => x.name === 'Jonathan Taylor'),
      suggestions.map((x: { name: string }) => x.name).join(', ') || 'none');

    // The user maps it once. The mapping wins over every automatic tier.
    const target = suggestions.find((x: { name: string }) => x.name === 'Jonathan Taylor');
    const key = near.unmatched[0].key;
    const fixed = await post('Player,Pos,Team,Rank' + String.fromCharCode(10)
      + 'Jonathin Tayler,RB,IND,1', { [key]: target.id });
    check('a saved mapping resolves the name',
      fixed.entries[0]?.name === 'Jonathan Taylor', fixed.entries[0]?.name);
    check('a saved mapping is reported as yours',
      fixed.entries[0]?.matchedBy === 'override', fixed.entries[0]?.matchedBy);

    // The same mapping applies to a completely different file.
    const later = await post('Player,Pos,Team,Rank' + String.fromCharCode(10)
      + 'Bijan Robinson,RB,ATL,1' + String.fromCharCode(10)
      + 'Jonathin Tayler,RB,IND,2', { [key]: target.id });
    check('the mapping applies to the next file with no prompt',
      later.unmatched.length === 0 && later.entries.length === 2,
      later.unmatched.length + ' unmatched');

    // A name mapped to nothing is left out for good and never asked about again.
    const dropped = await post('Player,Pos,Team,Rank' + String.fromCharCode(10)
      + 'Jonathin Tayler,RB,IND,1', { [key]: null });
    check('a name you chose to leave out stays out',
      dropped.entries.length === 0 && dropped.unmatched.length === 0
      && dropped.ignored.length === 1, JSON.stringify(dropped.ignored));
  }

  console.log('\nPlayer notes');
  {
    const NL = String.fromCharCode(10);
    const post = async (path: string, csv: string) => {
      const r = await fetch(API + '/api/' + path + '?scoring=standard&teams=12&adpSource=sleeper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      return r.json();
    };
    type Noted = { sourceName: string; name: string; note: string | null };

    // A notes column rides along in a ranking file and must not be mistaken
    // for the ranking. Six columns here contain a word the scorer looks at.
    const withNotes = await post('rankings', [
      'Player,Position,Team,ETR Rank,ADP,Notes',
      'Jahmyr Gibbs,RB,DET,1,1.5,Locked in.',
      'Kenneth Walker,RB,KC,2,22.7,',
      'Omarion Hampton,RB,LAC,3,12.2,Rookie workload is the whole question, and nobody says so.',
    ].join(NL));

    check('a notes column is found', withNotes.columns.note === 'notes',
      String(withNotes.columns.note));
    check('a notes column does not steal the ranking',
      withNotes.columns.rank === 'etr rank', String(withNotes.columns.rank));

    const gibbs = withNotes.entries.find((e: Noted) => e.sourceName === 'Jahmyr Gibbs');
    const walker = withNotes.entries.find((e: Noted) => e.sourceName === 'Kenneth Walker');
    const hampton = withNotes.entries.find((e: Noted) => e.sourceName === 'Omarion Hampton');
    check('a note reaches its player', gibbs?.note === 'Locked in.', String(gibbs?.note));
    check('an empty note is no note', walker?.note === null, String(walker?.note));

    // The note is the last column, so the comma inside it is part of the
    // sentence rather than the start of another column. The spacing after it
    // has to survive too: these are words somebody typed.
    check('a comma inside a note keeps the note whole',
      hampton?.note === 'Rookie workload is the whole question, and nobody says so.',
      String(hampton?.note));

    // A notes file is a ranking file with the ranking left out, so a bare list
    // of names and notes works and matches on the name alone.
    const bare = await post('notes', [
      'Player,Notes',
      'Jahmyr Gibbs,From the notes file.',
      'Nobody Realhere,This one matches nothing.',
    ].join(NL));

    check('a bare notes file matches on the name alone', bare.notes.length === 1,
      bare.notes.length + ' of 1');
    check('a name that matches nothing is reported, not dropped',
      bare.unmatched.length === 1 && bare.unmatched[0].name === 'Nobody Realhere',
      JSON.stringify(bare.unmatched.map((u: { name: string }) => u.name)));

    // A position and a team are optional and they are what the awkward tiers
    // run on: "Cameron Ward" reaches "Cam Ward" through surname, position and
    // team, and reaches nobody without them. This is why the screen asks for
    // the columns rather than only the name.
    const rich = await post('notes', [
      'Player,Pos,Team,Notes',
      'Cameron Ward,QB,TEN,Matched on the surname, the position and the team.',
    ].join(NL));

    check('a notes file with a position uses the same matching tiers',
      rich.notes.length === 1 && rich.notes[0].name === 'Cam Ward',
      JSON.stringify(rich.notes.map((n: { name: string }) => n.name)));

    // A file with nowhere to read a note from is refused, because a silent
    // success here means notes that never appear and no reason given.
    const noColumn = await fetch(
      API + '/api/notes?scoring=standard&teams=12&adpSource=sleeper',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv: 'Player,Rank' + NL + 'Jahmyr Gibbs,1' }),
      },
    );
    check('a file with no notes column is refused', noColumn.status === 400,
      String(noColumn.status));
  }

  console.log('\nSleeper leagues');
  if (!fixtures) {
    console.log(NO_FIXTURES);
  } else {
    const leagues = fixtures.leagues;

    for (const want of leagues) {
      const res2 = await fetch(API + '/api/sleeper/league/' + want.id);
      const got = await res2.json();
      const ok = got.teams === want.teams && got.rounds === want.rounds
        && got.scoring === want.scoring && got.draftType === 'snake';
      check(got.name || want.id, ok,
        got.error || (got.teams + ' teams, ' + got.rounds + ' rounds, ' + got.scoring));

      // A league that imports must produce a draft that actually runs.
      const lg = league({
        teams: got.teams, rounds: got.rounds, roster: got.roster, scoring: got.scoring,
        mySlot: Math.min(6, got.teams),
      });
      const boardRes = await fetch(API + '/api/board?scoring=' + got.scoring
        + '&teams=' + got.teams + '&adpSource=sleeper');
      const leagueBoard: Board = await boardRes.json();
      const engine = runDraft(leagueBoard, lg, DEFAULT_CPU);
      check('  ' + (got.name || want.id) + ' drafts to the last pick',
        engine.state.picks.length === got.teams * got.rounds,
        engine.state.picks.length + ' of ' + got.teams * got.rounds);

      // The one that has no kicker slot must not draft one.
      if (got.roster.K === 0) {
        const kickers = engine.state.picks
          .filter((p) => engine.byId.get(p.playerId)?.position === 'K').length;
        check('  a league with no kicker slot drafts no kickers', kickers === 0, String(kickers));
      }
    }

    // Settings are pulled once and kept, so the same league read twice must
    // give the same answer. A cached league that drifts from the live one is a
    // draft set up for a league you are not in.
    const first = leagues[0].id;
    const twice = await Promise.all([
      fetch(API + '/api/sleeper/league/' + first).then((r) => r.json()),
      fetch(API + '/api/sleeper/league/' + first + '?force=1').then((r) => r.json()),
    ]);
    check('a cached league matches a forced re-read',
      JSON.stringify(twice[0]) === JSON.stringify(twice[1]));
  }

  {
    // These need no fixture. The first ID belongs to nobody and never will.
    const bad = await fetch(API + '/api/sleeper/league/12345678901234567890');
    check('an unknown league ID gives a clear error', bad.status === 400);

    // A league ID is a run of digits. Anything else is refused before it
    // reaches Sleeper, rather than passed through and answered with a 404.
    const junk = await fetch(API + '/api/sleeper/league/not-an-id/users');
    check('a league ID that is not digits is refused', junk.status === 400,
      String(junk.status));
  }

  console.log('\nKeepers and settled picks');
  {
    const boardRes = await fetch(API + '/api/board?scoring=ppr&teams=12&adpSource=sleeper');
    const b12: Board = await boardRes.json();
    const lg = league({ teams: 12, mySlot: 3 });

    // One keeper a team, each on the pick that team really owns in its round.
    // Half of them sit late, which is where the bug lived: a player promised to
    // round eight has to survive rounds one to seven.
    const kept = b12.players.slice(0, 12).map((p, i) => {
      const round = i < 6 ? 2 : 8;
      const order = roundOrder('snake', round, 12);
      const slot = order.indexOf(i);
      return {
        overall: (round - 1) * 12 + slot + 1,
        playerId: p.id,
        source: 'keeper' as const,
      };
    });

    let e = createDraft(lg, DEFAULT_CPU, b12.players, null, kept);
    e = autoDraftRest(e);

    check('a keeper draft still fills every pick',
      e.state.picks.length === lg.teams * lg.rounds, String(e.state.picks.length));
    check('every keeper landed on the pick it cost',
      kept.every((k) => e.state.picks.find((p) => p.overall === k.overall)?.playerId === k.playerId));
    check('a kept player is never drafted again',
      new Set(e.state.picks.map((p) => p.playerId)).size === e.state.picks.length);
    check('kept picks are marked as kept',
      e.state.picks.filter((p) => p.preset === 'keeper').length === 12,
      String(e.state.picks.filter((p) => p.preset === 'keeper').length));

    const keptIds = new Set(kept.map((k) => k.playerId));
    const teamsHolding = e.state.teams.filter(
      (t) => t.playerIds.some((id) => keptIds.has(id)),
    ).length;
    check('the keepers went to twelve different teams', teamsHolding === 12, String(teamsHolding));

    // A keeper is on the roster from pick one, not from the pick that claims
    // him. Without that the team holding a receiver in round eight spends
    // rounds one to seven believing it has none, and drafts one too many.
    const lateWr = b12.players.filter((p) => p.position === 'WR').slice(4, 16);
    const keeperRound = 8;
    const wrKept = lateWr.slice(0, 12).map((p, i) => {
      const order = roundOrder('snake', keeperRound, 12);
      return {
        overall: (keeperRound - 1) * 12 + order.indexOf(i) + 1,
        playerId: p.id,
        source: 'keeper' as const,
      };
    });

    const seeded = createDraft(lg, DEFAULT_CPU, b12.players, null, wrKept);
    check('a keeper is on the roster before his pick arrives',
      seeded.state.teams.every((t) => t.playerIds.length === 1),
      seeded.state.teams.map((t) => t.playerIds.length).join(','));
    check('a keeper counts at his position from the start',
      seeded.state.teams.every((t) => t.counts.WR === 1));

    const kept8 = autoDraftRest(seeded);
    const noKeepers = autoDraftRest(createDraft(lg, DEFAULT_CPU, b12.players, null, []));

    const wrPerTeam = (e: typeof kept8) => e.state.teams.map((t) => t.counts.WR);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log('        receivers a team ends with: no keepers '
      + mean(wrPerTeam(noKeepers)).toFixed(2)
      + ', a kept receiver each ' + mean(wrPerTeam(kept8)).toFixed(2));

    check('a kept receiver is not drafted over',
      mean(wrPerTeam(kept8)) <= mean(wrPerTeam(noKeepers)) + 1.05,
      mean(wrPerTeam(kept8)).toFixed(2) + ' against ' + mean(wrPerTeam(noKeepers)).toFixed(2));
    check('nobody holds a keeper twice',
      kept8.state.teams.every((t) => new Set(t.playerIds).size === t.playerIds.length));
    check('a kept roster is the right size',
      kept8.state.teams.every((t) => t.playerIds.length === lg.rounds),
      kept8.state.teams.map((t) => t.playerIds.length).join(','));

    // Taking back a settled pick must not take the player off the roster.
    let stepped = seeded;
    for (let i = 0; i < 100; i += 1) stepped = runCpuPick(stepped);
    const backed = undoPick(stepped);
    check('undoing a settled pick leaves the player kept',
      backed.state.teams.every((t) => t.counts.WR >= 1));

    // The bug this reproduces: the draft reaches your own keeper, decides it is
    // your turn, and waits for a decision that was taken weeks ago.
    const mySlot = 4;
    const keptRound = 8;
    const myLg = league({ teams: 12, mySlot });
    const myOrder = roundOrder('snake', keptRound, 12);
    const myKeeperPick = (keptRound - 1) * 12 + myOrder.indexOf(mySlot - 1) + 1;
    const mine = createDraft(myLg, DEFAULT_CPU, b12.players, null,
      [{ overall: myKeeperPick, playerId: b12.players[20].id, source: 'keeper' }]);

    check('your settled pick is not offered as your next choice',
      nextUserChoice(mine, myKeeperPick) !== myKeeperPick,
      String(nextUserChoice(mine, myKeeperPick)));
    check('the choice after it is a real one',
      (nextUserChoice(mine, myKeeperPick) ?? 0) > myKeeperPick);

    // Play it the way the screen does: you pick when it is your turn, the room
    // picks otherwise, and a settled pick belongs to neither.
    let live = mine;
    let stalls = 0;
    let guard = 0;
    while (!live.state.done && guard < 5000) {
      const at = currentPick(live.state);
      const team = currentTeam(live.state)!;
      const settled = presetFor(live, at);
      const before = live.state.picks.length;

      if (team.isUser && !settled) {
        const best = availablePlayers(live)[0];
        live = draftPlayer(live, best.id);
      } else {
        live = runCpuPick(live);
      }

      if (live.state.picks.length === before) { stalls += 1; break; }
      guard += 1;
    }

    check('the draft never stalls on a settled pick', stalls === 0);
    check('a draft with your own keeper runs to the end',
      live.state.picks.length === myLg.teams * myLg.rounds,
      live.state.picks.length + ' of ' + myLg.teams * myLg.rounds);
    check('your keeper filled its own pick',
      live.state.picks.find((p) => p.overall === myKeeperPick)?.preset === 'keeper');
    check('you still made every other pick you own',
      live.state.teams[mySlot - 1].playerIds.length === myLg.rounds,
      String(live.state.teams[mySlot - 1].playerIds.length));

    // A keeper of yours must not stall the draft waiting for you to choose it.
    const mineKept = createDraft(lg, DEFAULT_CPU, b12.players, null,
      [{ overall: 3, playerId: b12.players[0].id, source: 'keeper' }]);
    const advanced = runToUserTurn(mineKept);
    check('your own keeper fills itself and play moves on',
      advanced.state.picks.length >= 3, String(advanced.state.picks.length));

    // A preset outside the draft, or naming nobody, is dropped not half applied.
    const junk = createDraft(lg, DEFAULT_CPU, b12.players, null, [
      { overall: 9999, playerId: b12.players[0].id, source: 'keeper' },
      { overall: 5, playerId: 'no-such-player', source: 'keeper' },
    ]);
    check('a preset the draft cannot hold is refused', junk.presets.size === 0,
      String(junk.presets.size));
  }

  console.log('\nFollowing a real draft');
  if (!fixtures) {
    console.log(NO_FIXTURES);
  } else {
    // A finished draft is a fixed target to replay: the same picks every time,
    // a known number of them, and a known number of keepers among them.
    const want = fixtures.finishedDraft;
    const lge = fixtures.keeperLeague;
    const boardQuery = 'scoring=' + lge.scoring + '&teams=' + lge.teams;
    const DRAFT = want.id;
    const stateRes = await fetch(API + '/api/sleeper/draft/' + DRAFT);
    const live = await stateRes.json();
    check('a finished draft reports itself finished', live.complete === true, live.status);
    check('the draft order is readable', live.orderIsSet === true);
    check('the order covers every seat',
      Object.keys(live.slotByUser).length === live.teams,
      Object.keys(live.slotByUser).length + ' of ' + live.teams);

    const picksRes = await fetch(API + '/api/sleeper/draft/' + DRAFT + '/picks?' + boardQuery);
    const got = await picksRes.json();
    check('every real pick comes back', got.picks.length === want.picks,
      String(got.picks.length));
    check('almost every pick finds its player on the board',
      got.matched >= want.minMatched, got.matched + ' of ' + got.picks.length);
    check('a pick of somebody off the board still owns its slot',
      got.picks.every((p: { playerId: string }) => !!p.playerId));
    check('the keepers are flagged',
      got.picks.filter((p: { isKeeper: boolean }) => p.isKeeper).length === want.keepers);
    check('picks arrive in order',
      got.picks.every((p: { overall: number }, i: number) => p.overall === i + 1));

    // Replay it through the engine the way the assistant does.
    const boardRes = await fetch(API + '/api/board?' + boardQuery + '&adpSource=sleeper');
    const b12: Board = await boardRes.json();
    // Every real pick, including those of players this board no longer ranks.
    // Those join the board as themselves so no slot is left empty.
    const extras = got.picks.filter((p: { offBoard: boolean }) => p.offBoard)
      .map((p: { playerId: string; name: string; position: string; team: string }) => ({
        id: p.playerId, key: p.playerId, name: p.name, position: p.position, team: p.team,
        bye: null, adp: 999, adpRank: 999, adpStdev: 20, stdevMeasured: false, points: null,
        ffcAdp: null, sleeperAdp: null, adpBorrowedFrom: null, injuryStatus: null,
        timesDrafted: 0, sources: [],
      }));
    const pool = [...b12.players, ...extras];
    const presets = got.picks.map((p: { overall: number; playerId: string }) => ({
      overall: p.overall, playerId: p.playerId, source: 'live' as const,
    }));

    const seat = { teams: lge.teams, rounds: lge.rounds, mySlot: lge.teams };
    const replay = runPresetsOnly(createDraft(
      league(seat), DEFAULT_CPU, pool, null, presets,
    ));
    console.log('        replayed ' + replay.state.picks.length + ' of ' + presets.length
      + ' real picks onto the board');
    check('the assistant replays the real draft', replay.state.picks.length === presets.length,
      replay.state.picks.length + ' of ' + presets.length);
    check('the assistant simulates nothing of its own',
      replay.state.picks.every((p) => p.preset === 'live'));

    // Half the picks in means the board stops there and waits.
    const halfway = Math.floor(presets.length / 2);
    const half = presets.slice(0, halfway);
    const partway = runPresetsOnly(createDraft(
      league(seat), DEFAULT_CPU, pool, null, half,
    ));
    check('a draft in progress stops at the last real pick',
      partway.state.picks.length === halfway, String(partway.state.picks.length));
    check('nothing is invented past it', partway.state.done === false);

    const members = await fetch(API + '/api/sleeper/league/' + lge.id + '/users')
      .then((r) => r.json());
    check('the league members are readable', Array.isArray(members) && members.length > 0,
      String(members.length));

    // `draft_order` is keyed by user and skips anyone without an outright
    // roster, so it can be short of a seat. Seats are mapped through
    // slot_to_roster_id for exactly that reason, and every one of them has to
    // come back named however short that map is.
    const setupRes = await fetch(
      API + '/api/sleeper/league/' + lge.id + '/setup?' + boardQuery,
    );
    const setupGot = await setupRes.json();
    const ordered = Object.keys(setupGot.draft?.slotByUser ?? {}).length;
    console.log('        ' + setupGot.slots.length + ' seats, ' + members.length
      + ' users, ' + ordered + ' entries in the draft order');
    check('there is a seat for every roster',
      setupGot.slots.length === setupGot.teams,
      setupGot.slots.length + ' of ' + setupGot.teams);
    check('every seat is named however short the draft order is',
      setupGot.slots.every((x: { name: string }) => !!x.name && x.name.trim().length > 0)
        && setupGot.slots.length >= ordered,
      setupGot.slots.length + ' seats against ' + ordered + ' ordered');
  }

  console.log('\nReading a real league');
  if (!fixtures) {
    console.log(NO_FIXTURES);
  } else {
    const lge = fixtures.keeperLeague;
    const boardQuery = 'scoring=' + lge.scoring + '&teams=' + lge.teams;
    const res2 = await fetch(API + '/api/sleeper/league/' + lge.id + '/setup?' + boardQuery);
    const got = await res2.json();

    check('every seat is accounted for', got.slots.length === got.teams,
      got.slots.length + ' of ' + got.teams);
    check('every seat has a name', got.slots.every((s2: { name: string }) => !!s2.name));
    check('seats run 1 to N in order',
      got.slots.every((s2: { slot: number }, i: number) => s2.slot === i + 1));
    check('a seat maps to a roster',
      got.slots.filter((s2: { rosterId: number | null }) => s2.rosterId != null).length
        === got.teams);
    console.log('        ' + got.namedTeams + ' of ' + got.teams
      + ' seats carry a real team name');

    // The seat mapping must not go through draft_order: this league has twelve
    // seats and eleven entries there, so one seat would come back nameless.
    check('a seat with no manager still gets a name',
      got.slots.every((s2: { name: string }) => s2.name.trim().length > 0));

    check('the league is read as a keeper league', got.isKeeper === true);

    /*
     * The traded picks of a real league.
     *
     * This one has them in bulk: two seats swapped nearly their whole draft
     * both ways, on top of ordinary trades between five others. It is the case
     * that broke every "one pick per team per round" assumption in the app.
     */
    {
      const trades: { round: number; fromSlot: number; toSlot: number }[] = got.tradedPicks;
      check('traded picks come back', Array.isArray(trades), typeof trades);
      console.log('        ' + trades.length + ' picks changed hands');

      check('a trade names two different seats',
        trades.every((t) => t.fromSlot !== t.toSlot));
      check('every traded seat is a real seat',
        trades.every((t) => t.fromSlot >= 1 && t.fromSlot <= got.teams
          && t.toSlot >= 1 && t.toSlot <= got.teams));
      check('no pick is sold twice',
        new Set(trades.map((t) => t.round + ':' + t.fromSlot)).size === trades.length);

      const rounds = lge.rounds;
      const plain = pickOrder('snake', got.teams, rounds);
      const traded = pickOrder('snake', got.teams, rounds, trades);

      check('the draft is the same length either way', traded.length === plain.length);
      check('every pick still belongs to somebody',
        traded.every((t) => t >= 0 && t < got.teams));
      check('the picks that moved are exactly the ones traded',
        traded.filter((t, i) => t !== plain[i]).length
          === trades.filter((t) => t.round <= rounds).length,
        traded.filter((t, i) => t !== plain[i]).length + ' moved');

      // Nobody gains or loses a pick overall: every pick sold is a pick bought.
      const before = new Map<number, number>();
      const after = new Map<number, number>();
      plain.forEach((t) => before.set(t, (before.get(t) || 0) + 1));
      traded.forEach((t) => after.set(t, (after.get(t) || 0) + 1));
      const net = [...after.entries()]
        .map(([t, n]) => [t + 1, n - (before.get(t) || 0)] as const)
        .filter(([, d]) => d !== 0);
      check('the picks gained equal the picks lost',
        net.reduce((sum, [, d]) => sum + d, 0) === 0);
      console.log('        net picks by seat: '
        + (net.map(([slot, d]) => 'seat ' + slot + ' ' + (d > 0 ? '+' : '') + d).join(', ')
          || 'level all round'));
    }
    check('the declared keepers come back', got.keepersDeclared >= 1,
      String(got.keepersDeclared));
    check('a declared keeper names its seat and its player',
      got.keepers.every((k: { slot: number | null }) => k.slot != null));
    check('a keeper drafted last season gets a suggested round',
      got.keepers.some((k: { suggestedRound: number | null }) => k.suggestedRound != null));
    check('a keeper never drafted here gets no round rather than a wrong one',
      got.keepers.every((k: { suggestedRound: number | null; suggestedFrom: string }) => (
        k.suggestedRound != null || k.suggestedFrom === 'never drafted here')));

    for (const k of got.keepers) {
      console.log('        seat ' + String(k.slot).padStart(2) + '  '
        + String(k.name || 'not on board').padEnd(20)
        + (k.suggestedRound ? 'round ' + k.suggestedRound : k.suggestedFrom));
    }

    // Those keepers have to survive being turned into real picks.
    const boardRes = await fetch(API + '/api/board?' + boardQuery + '&adpSource=sleeper');
    const b12: Board = await boardRes.json();
    const usable = got.keepers.filter(
      (k: { playerId: string | null; slot: number; suggestedRound: number | null }) => (
        k.playerId && k.slot && k.suggestedRound),
    );
    const picks = usable.map((k: { slot: number; suggestedRound: number; playerId: string }) => {
      const order = roundOrder('snake', k.suggestedRound, got.teams);
      return {
        overall: (k.suggestedRound - 1) * got.teams + order.indexOf(k.slot - 1) + 1,
        playerId: k.playerId,
        source: 'keeper' as const,
      };
    });
    check('every imported keeper lands on a distinct pick',
      new Set(picks.map((p: { overall: number }) => p.overall)).size === picks.length);

    /*
     * The import splits, and loses nobody.
     *
     * A keeper is settled when a round is known and that round's pick is still
     * free. The rest wait for a round from you. The import used to count those
     * in a sentence and drop them, which meant finding each player again by
     * hand in a list of six hundred.
     */
    {
      const onBoard = got.keepers.filter(
        (k: { playerId: string | null; slot: number | null }) => k.playerId && k.slot,
      );
      const settled: number[] = [];
      const waiting: string[] = [];
      const spent = new Set<number>();

      for (const k of onBoard) {
        if (!k.suggestedRound) { waiting.push(k.name); continue; }
        const order = roundOrder('snake', k.suggestedRound, got.teams);
        const index = order.indexOf(k.slot - 1);
        if (index < 0) { waiting.push(k.name); continue; }
        const overall = (k.suggestedRound - 1) * got.teams + index + 1;
        if (spent.has(overall)) { waiting.push(k.name); continue; }
        spent.add(overall);
        settled.push(overall);
      }

      check('the import keeps every keeper it can name',
        settled.length + waiting.length === onBoard.length,
        settled.length + ' settled, ' + waiting.length + ' waiting, '
          + onBoard.length + ' named');
      check('a keeper with no round waits rather than disappearing',
        waiting.length === onBoard.filter(
          (k: { suggestedRound: number | null }) => !k.suggestedRound,
        ).length,
        waiting.join(', ') || 'none');
      check('no two settled keepers share a pick',
        new Set(settled).size === settled.length);
    }

    const names = got.slots.map((s2: { name: string }) => s2.name);
    const withNames = autoDraftRest(createDraft(
      league({ teams: got.teams, rounds: lge.rounds, mySlot: 4, teamNames: names }),
      DEFAULT_CPU, b12.players, null, picks,
    ));
    check('a draft with real team names completes',
      withNames.state.picks.length === got.teams * lge.rounds);
    check('the board carries the real team names',
      withNames.state.teams[3].name === names[3], withNames.state.teams[3].name);
    check('every declared keeper reached the team that declared him',
      usable.every((k: { slot: number; playerId: string }) => (
        withNames.state.teams[k.slot - 1].playerIds.includes(k.playerId))));
  }

  console.log('\nYour own rankings');
  {
    // Take four players the market buries and rank them first. If the override
    // works they go in round one, and if it does not they go where they always
    // went, which is the whole point of the switch.
    const late = board.players
      .filter((p) => p.adp > 90 && p.adp < 160 && p.position !== 'K' && p.position !== 'DEF')
      .slice(0, 4);
    const csv = ['Player,Pos,Team,Rank']
      .concat(late.map((p, i) => [p.name, p.position, p.team, String(i + 1)].join(',')))
      .join('\n');

    const res2 = await fetch(API + '/api/rankings?scoring=half-ppr&teams=12&adpSource=sleeper', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv }),
    });
    const set = await res2.json();
    check('the service matched every name', set.entries.length === late.length,
      set.entries.length + ' of ' + late.length);
    check('a fused position label like RB1 still matches', set.columns.position === 'pos');

    const lg = league();
    const ids = new Set(set.entries.map((e: { id: string }) => e.id));

    const ignoring = createDraft(lg, DEFAULT_CPU, board.players, set.entries);
    const withMine = createDraft(
      lg, { ...DEFAULT_CPU, cpuUsesMyRankings: true }, board.players, set.entries,
    );
    const a = autoDraftRest(ignoring);
    const b = autoDraftRest(withMine);

    const firstRound = (e: typeof a) => e.state.picks.slice(0, lg.teams)
      .filter((p) => ids.has(p.playerId)).length;

    console.log('        of the four players ranked first, '
      + firstRound(a) + ' went in round one with the switch off, '
      + firstRound(b) + ' with it on');
    check('the room ignores your rankings by default', firstRound(a) === 0);
    check('the switch makes the room draft from them', firstRound(b) >= 3);
    check('a draft still completes with the switch on',
      b.state.picks.length === lg.teams * lg.rounds);
  }

  await yahooRoom();

  console.log('');
  if (failures) {
    console.log(failures + ' checks failed.');
    process.exit(1);
  }
  console.log('All checks passed.');
}

/**
 * Yahoo's draft room, decoded and joined onto the board.
 *
 * Yahoo is pushed rather than pulled — a userscript in the user's own tab posts
 * what the room sends, because every Yahoo endpoint wants a session cookie the
 * service must never hold. So this posts frames the way that bridge does and
 * checks what comes back out, which needs no draft, no cookie and no league.
 *
 * The frames below are synthetic: the grammar is real and observed, the player
 * IDs and seats are invented. That is on purpose. The real captures name real
 * leagues and real people, so git ignores them, and a check that only ran for
 * whoever made the capture would be green and worthless everywhere else. When
 * the captures are present they are replayed too, at the end.
 */
async function yahooRoom() {
  console.log('\nReading a Yahoo draft room');

  // A fresh room per run. The service holds what was posted for the life of the
  // process, so a fixed ID would arrive already holding a pool on the second run
  // against the same service and the first check below would be false.
  const LEAGUE = String(Date.now()).slice(-9);
  const boardQuery = 'scoring=half-ppr&teams=12';
  const frames = [
    'H|S|30|0|0|1',
    // Three seats and two rounds, deliberately not a snake. The order has to be
    // read rather than derived: a league with a traded pick or a keeper is
    // exactly the league a derived snake gets wrong.
    'R|1|2|3|3|1|2',
    // The replay form, sent on connect: `<overall>=<player>,<seat>,<cost>`,
    // with no roster slot in it.
    'P|1=9001,1,0|2=9002,2,0',
    // The live form: separate pipe fields, and a slot between the seat and the
    // cost. Reading either one with the other's layout silently swaps the seat
    // and the cost, which shows up only as a wrong board mid-draft.
    '0|3|9003|3|W/R/T|0',
    '0|4|9004|3|RB|0',
    // Nobody in the pool. A pick this board cannot place still owns its slot.
    '0|5|9999|1|TE|0',
    // Frames a board does not need. None may reach it, and none may break it.
    'C|24', 'D|6|2|30', 'J|2', 'L|3', 'Q', 'w|3600|20', 'G|[{"pickId":3}]', 'P',
  ];

  const board = await (await fetch(API + '/api/board?' + boardQuery)).json();
  // A pool built from the board, so a matched pick can be checked by name.
  const pool = ['9001', '9002', '9003', '9004'].map((id, i) => {
    const p = board.players[i];
    const [fname, ...rest] = p.name.split(' ');
    // Yahoo writes a player eligible at two positions as "WR,RB", which a real
    // pool carries eight of. A board row holds one position, so the pair has to
    // be reduced or the pick joins nothing.
    const display_pos = i === 3 ? p.position + ',RB' : p.position;
    // Yahoo publishes how its own drafters behave, and only here. The last one
    // carries no reading, which is the ordinary case: Yahoo reports an ADP for
    // a few hundred of about twelve hundred players, and writes the rest as 0.
    const adp = i === 3 ? 0 : 10 + i;
    return { id, fname, lname: rest.join(' '), display_pos, team_abbr: p.team, adp, rank: i + 1 };
  });
  const seats = [1, 2, 3].map((id) => ({
    id, teamname: 'Team ' + id, manager: 'manager' + id,
  }));

  const post = (body: unknown) => fetch(API + '/api/yahoo/room/' + LEAGUE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  /*
   * The one question a league nobody has posted can answer.
   *
   * The app asks it on a beat while a Yahoo mock waits for its draft room tab
   * to open, which takes minutes and is the ordinary course of joining one. A
   * refusal here would be an error every five seconds about nothing being
   * wrong, and the app would have to read a fault as a state.
   */
  const roomState = (id: string) => fetch(API + '/api/yahoo/room/' + id).then((r) => r.json());
  const before = await roomState(LEAGUE);
  check('a room nobody has posted says so rather than refusing',
    before.orderIsSet === false && before.mySeat === null, JSON.stringify(before));

  const first = await post({ team: 3, frames });
  check('a room with no pool yet asks for one', first.needPool === true);

  const reply = await post({ team: 3, pool, seats, frames });
  check('the pool and the seats are taken', reply.needPool === false && reply.pool === 4);
  check('the draft order arrived', reply.orderKnown === true);
  // Both posts carried the same six picks. A pick that arrives twice, once live
  // and again in a reconnecting tab's replay, is still one pick.
  check('a pick sent twice is still one pick', reply.picks === 5, String(reply.picks));

  // Both of the things the app waits for before it opens a board by itself: a
  // seat means the bridge is posting, and the order means the room has finished
  // introducing itself, so the seat and round counts are Yahoo's own.
  const after = await roomState(LEAGUE);
  check('a posted room reports the seat and the order the app waits on',
    after.orderIsSet === true && after.mySeat === 3, JSON.stringify(after));

  /*
   * Yahoo's own ADP is the one thing here no feed this service can reach will
   * tell it, so it has to survive the trip from the bridge intact and land
   * against the ids the board uses rather than Yahoo's.
   */
  // The same board the pool above was built from, or the ids will not line up.
  const withAdp = await (await fetch(API + '/api/yahoo/draft/' + LEAGUE
    + '/picks?scoring=half-ppr&teams=12&adpSource=sleeper')).json();
  const said = new Map((withAdp.roomAdp || []).map(
    (r: { id: string; adp: number }) => [r.id, r.adp],
  ));
  check('the room’s own ADP came back on board ids',
    said.get(board.players[0].id) === 10 && said.get(board.players[1].id) === 11,
    JSON.stringify(withAdp.roomAdp));
  check('a player Yahoo has no reading on is left out, not sent as nothing',
    !said.has(board.players[3].id) && said.size === 3, String(said.size));

  /*
   * THAT SAME ADP, ASKED TO PRICE THE BOARD.
   *
   * It is the only feed here measured over the people actually in the room, and
   * the only one no server can fetch: Yahoo answers a session cookie, so it
   * reaches the board through the bridge or not at all. The pool posted above
   * puts the top three players at 10, 11 and 12, which no market feed does, so
   * a board that moved them read the room rather than a feed.
   */
  const roomQuery = 'scoring=half-ppr&teams=12&room=yahoo:' + LEAGUE;
  const priced = await (await fetch(
    API + '/api/board?' + roomQuery + '&adpSource=avg:sleeper,room')).json() as Board;
  const feedOnly = await (await fetch(
    API + '/api/board?scoring=half-ppr&teams=12&adpSource=avg:sleeper')).json() as Board;

  check('a posted room is offered as a source', priced.meta.adpOffered.includes('room')
    && JSON.stringify(priced.meta.adpFeeds) === JSON.stringify(['sleeper', 'room']),
    JSON.stringify(priced.meta.adpFeeds) + ' of ' + JSON.stringify(priced.meta.adpOffered));
  check('and only the players it prices carry its reading',
    priced.meta.roomRanked === 3 && feedOnly.meta.roomRanked === 0,
    priced.meta.roomRanked + ' with a room ADP, ' + feedOnly.meta.roomRanked + ' without one');

  const was = new Map(feedOnly.players.map((p) => [p.key, p.adp]));
  const readings = new Map(priced.players.map((p) => [p.key, p]));
  const moved = priced.players.filter((p) => Math.abs((was.get(p.key) ?? 0) - p.adp) > 0.001);
  check('a player the room has no reading on is not moved by it',
    moved.every((p) => p.roomAdp != null), moved.length + ' moved');
  check('and one it does price is the mean of the two', [0, 1, 2].every((i) => {
    const p = readings.get(board.players[i].key);
    return !!p && Math.abs(p.adp - ((p.sleeperAdp! + (10 + i)) / 2)) < 0.01;
  }), [0, 1, 2].map((i) => {
    const p = readings.get(board.players[i].key);
    return p ? p.sleeperAdp + '+' + (10 + i) + '->' + p.adp : 'missing';
  }).join(' '));

  const state = await (await fetch(API + '/api/yahoo/draft/' + LEAGUE)).json();
  check('the seats are counted', state.teams === 3, String(state.teams));
  check('the rounds come from the order, not from a roster', state.rounds === 2,
    String(state.rounds));
  check('a part-drafted room is under way and not complete',
    state.started === true && state.complete === false);
  check('the seat is the identity, as Yahoo models it',
    state.slotByUser['2'] === 2 && state.orderIsSet === true);

  const live = await (await fetch(
    API + '/api/yahoo/draft/' + LEAGUE + '/picks?' + boardQuery)).json();
  check('every pick came back once', live.picks.length === 5, String(live.picks.length));
  check('the four in the pool found their player', live.matched === 4, String(live.matched));

  const at = (n: number) => live.picks.find((p: { overall: number }) => p.overall === n);
  check('a replayed pick keeps the seat it named, not the cost',
    at(1).slot === 1 && at(2).slot === 2, at(1).slot + ',' + at(2).slot);
  check('a live pick keeps the seat it named', at(3).slot === 3 && at(4).slot === 3);
  check('a replayed pick resolves to the player its frame named',
    at(1).name === board.players[0].name, at(1).name);
  check('a live pick resolves to the player its frame named',
    at(3).name === board.players[2].name, at(3).name);
  check('a pick whose position names two still finds its player',
    at(4).name === board.players[3].name && at(4).offBoard === false,
    at(4).name + ' offBoard=' + at(4).offBoard);
  check('the round is the pick over the seat count',
    at(1).round === 1 && at(3).round === 1 && at(4).round === 2);

  // A hole in the board is worse than a stranger on it: the board stops lining
  // up with the room it is meant to mirror.
  check('a player the board never heard of still owns his slot',
    at(5) != null && at(5).offBoard === true, JSON.stringify(at(5)));
  check('and is reported rather than dropped', live.unknown.length === 1,
    JSON.stringify(live.unknown));

  const setup = await (await fetch(
    API + '/api/yahoo/league/' + LEAGUE + '/setup?' + boardQuery)).json();
  check('every seat is named from the league', setup.namedTeams === 3, String(setup.namedTeams));
  check('no keeper and no trade is invented',
    setup.keepers.length === 0 && setup.tradedPicks.length === 0);

  const imported = await (await fetch(API + '/api/yahoo/league/' + LEAGUE)).json();
  check('the import refuses to invent a roster or a scoring rule',
    imported.roster === null && imported.scoring === null);
  check('and says so', imported.warnings.some((w: string) => /roster shape/.test(w)));

  // The bridge posted from seat 3, because that is the seat in the room address
  // it was loaded from. Nobody had to be asked which one was theirs.
  check('the seat the bridge runs in is reported, so nobody has to be asked',
    state.mySeat === 3, String(state.mySeat));

  // ---- What the board tells the room ---------------------------------------
  //
  // The panel over a Yahoo draft is fed from here: the app writes what it has
  // worked out, the bridge collects it. The service is a pigeonhole and is
  // checked as one, including that it will not become a way to invent rooms.
  const advise = (id: string, body: unknown) => fetch(
    API + '/api/yahoo/room/' + id + '/advice',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );

  const unknownRoom = await advise('999999999', { rows: [] });
  check('advice about a room nobody has posted is refused', unknownRoom.status === 400,
    String(unknownRoom.status));
  const invented = await (await fetch(API + '/api/yahoo/room/999999999/advice')).json();
  check('and refusing it did not quietly create the room', invented.advice === null);

  const told = await advise(LEAGUE, {
    onClock: true,
    pickLabel: '2.07 #19',
    lean: 'The room is leaning on backs.',
    pick: {
      name: 'A Back', position: 'RB', worth: 117.2, urgency: 18.4, fillsStarter: true,
    },
    source: { kind: 'room', sims: 400 },
    rows: [{
      position: 'RB', name: 'A Back', worth: 117.2, cost: 18.4, odds: 0.22, beforeCliff: 2,
    }],
    // Anything reachable can post here, so the store keeps what it recognises
    // and drops the rest rather than handing a page it does not own whatever
    // arrived.
    somethingElse: 'ignored',
  });
  check('the board can tell the room what it thinks', told.status === 200,
    String(told.status));

  const read = await (await fetch(API + '/api/yahoo/room/' + LEAGUE + '/advice')).json();
  check('and the bridge reads back exactly that',
    read.advice.onClock === true
      && read.advice.pickLabel === '2.07 #19'
      && read.advice.rows.length === 1
      && read.advice.rows[0].name === 'A Back',
    JSON.stringify(read.advice));
  check('with nothing it was not asked to keep',
    !('somethingElse' in read.advice), Object.keys(read.advice).join(','));

  /*
   * The panel draws the pick and its arithmetic, so every field it reads has to
   * survive the round trip. It drew an empty box the first time one did not.
   */
  check('the pick it recommends reaches the panel',
    read.advice.pick?.name === 'A Back'
      && read.advice.pick.position === 'RB'
      && Math.round(read.advice.pick.worth) === 117
      && Math.round(read.advice.pick.urgency) === 18
      && read.advice.pick.fillsStarter === true,
    JSON.stringify(read.advice.pick));
  check('and so does what a row is worth, and its cliff',
    Math.round(read.advice.rows[0].worth) === 117 && read.advice.rows[0].beforeCliff === 2,
    JSON.stringify(read.advice.rows[0]));
  check('and where the numbers were read off',
    read.advice.source?.kind === 'room' && read.advice.source.sims === 400,
    JSON.stringify(read.advice.source));

  /*
   * Saying nothing has to survive too. A pick the app withheld must arrive as
   * null rather than as an empty object the panel would draw a blank box for.
   */
  await advise(LEAGUE, { onClock: false, pickLabel: '3.02', rows: [] });
  const quiet = await (await fetch(API + '/api/yahoo/room/' + LEAGUE + '/advice')).json();
  check('a pick the board withheld arrives as no pick', quiet.advice.pick === null,
    JSON.stringify(quiet.advice.pick));
  check('and a reading with no room behind it says so',
    quiet.advice.source?.kind === 'adp', JSON.stringify(quiet.advice.source));

  const stray = await fetch(API + '/api/sleeper/room/1234567890123456789', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  check('a platform read from its own feed is not writable', stray.status === 404,
    String(stray.status));

  const strayAdvice = await fetch(API + '/api/sleeper/room/1234567890123456789/advice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  check('nor is it given a room to advise on', strayAdvice.status === 404,
    String(strayAdvice.status));

  const strayRoom = await fetch(API + '/api/sleeper/room/1234567890123456789');
  check('nor a room to be waited for', strayRoom.status === 404, String(strayRoom.status));

  // ---- The real captures, when whoever is running this has them ------------

  const captures = ['capture-mock1.log', 'capture-mock2.log',
    'capture-mock3-handshake.log', 'capture-mock3-reconnect.log']
    .map((f) => '../tools/yahoo/' + f)
    .filter((p) => existsSync(p));

  if (!captures.length) {
    console.log('  skipped  no captures in tools/yahoo/. The synthetic frames above still ran.');
    return;
  }

  for (const path of captures) {
    const real = readFileSync(path, 'utf8').split(/\r?\n/)
      .map((l) => /^\[ws-in\]\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m != null)
      .map((m) => m[1])
      // The capture prints a long frame short. A truncated one is not a frame.
      .filter((p) => !/…\(\d+ chars\)$/.test(p))
      .filter((p) => /^(?:0|H|R|P)(?:\||$)/.test(p));

    const picks = real.filter((f) => f.startsWith('0|'));
    // Its own room per capture, so one replay cannot colour another's count.
    const id = '91' + String(captures.indexOf(path) + 1).padStart(4, '0');
    const sent = await fetch(API + '/api/yahoo/room/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ team: 1, frames: real }),
    }).then((r) => r.json());

    check(path.replace('../tools/yahoo/', '') + ': every pick frame decoded',
      sent.picks === new Set(picks.map((f) => f.split('|')[1])).size,
      sent.picks + ' of ' + picks.length);
  }
}

/** The average distance between where a player went and their ADP. */
function reachSpread(e: ReturnType<typeof runDraft>): number {
  const gaps = e.state.picks.map((p) => {
    const player = e.byId.get(p.playerId);
    return player ? Math.abs(player.adp - p.overall) : 0;
  });
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

void POSITIONS;

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
