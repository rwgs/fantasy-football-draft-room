// The best legal lineup, and the swaps that reach it.
//
//   npm --prefix server test
//
// No endpoint can show this yet -- Y9.3 owns the endpoint and the screen -- and
// a screen would be the wrong place to check it anyway. What is being checked
// is that a number is the maximum, and a lineup that is not the maximum looks
// exactly like one that is: it is legal, it is full, every player in it is a
// plausible start, and the points it left on the bench are nowhere on the
// screen.
//
// THE CHECK THAT CATCHES THAT IS THE ENUMERATION. `everyLineup` below is a
// brute force written from the rules rather than from the implementation --
// every assignment of players to seats that respects eligibility, scored, and
// the largest total taken. It shares no code with `bestLineup`, so the two
// agreeing is evidence and not a tautology. It is only tractable for small
// rosters, which is why it is here and not in the app.
//
// The second check is the trap: `bestFirst` is the wrong algorithm, written out
// in full, and the point is to prove it loses. A test that only asserted the
// right answer would pass just as well against an implementation that had
// never been at risk.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MATERIAL_SPREAD, bestLineup, lineupAdvice, lineupMoves, startingSeats,
} from './lineup.js';

/** A resolved starting slot, shaped the way `resolveSlots` hands one over. */
const slot = (position, count, accepts, extra = {}) => ({
  position, count, starting: true, accepts, unresolved: false, ...extra,
});

const bench = (position, count) => ({
  position, count, starting: false, accepts: null, unresolved: false,
});

/** A roster player, shaped the way `league.js` reads one. */
const player = (playerKey, positions, selectedPosition, extra = {}) => ({
  playerKey,
  playerId: playerKey,
  name: playerKey,
  team: 'NYJ',
  displayPosition: positions.join(','),
  primaryPosition: positions[0],
  positions,
  selectedPosition,
  isFlex: false,
  byeWeek: null,
  isKeeper: false,
  ...extra,
});

const pointsOf = (pairs) => new Map(Object.entries(pairs));

const FLEX = ['WR', 'RB', 'TE'];

/**
 * Every legal lineup, by brute force, and the best total among them.
 *
 * Written from the rules and not from `bestLineup`: walk the seats in order,
 * and for each one try every player still unused who is eligible for it, plus
 * the option of leaving it empty. That last option matters -- a seat nothing
 * can fill is legal, and an enumeration that required every seat filled would
 * report no lineup at all for a thin roster.
 *
 * Exponential, and deliberately so. Nothing here is clever enough to be wrong
 * in the same way the implementation could be.
 */
function everyLineup(seats, players, points) {
  let best = 0;
  let count = 0;

  const walk = (index, used, total) => {
    if (index === seats.length) {
      count += 1;
      if (total > best) best = total;
      return;
    }
    const seat = seats[index];
    walk(index + 1, used, total);
    for (const p of players) {
      if (used.has(p.playerKey)) continue;
      if (!p.positions.some((position) => seat.accepts.includes(position))) continue;
      const value = points.get(p.playerKey);
      if (value === undefined) continue;
      used.add(p.playerKey);
      walk(index + 1, used, total + value);
      used.delete(p.playerKey);
    }
  };

  walk(0, new Set(), 0);
  return { best, count };
}

/**
 * The wrong algorithm, in full.
 *
 * Best player first, into the first seat in the league's own order that fits
 * him. This is what anyone writes before noticing the problem, and it is what
 * the tests below prove loses points. It is here rather than described because
 * a described mistake cannot be run.
 */
function bestFirst(seats, players, points) {
  const taken = new Set();
  let total = 0;
  const ranked = [...players]
    .filter((p) => points.has(p.playerKey))
    .sort((a, b) => points.get(b.playerKey) - points.get(a.playerKey));

  for (const p of ranked) {
    const index = seats.findIndex((seat, i) => !taken.has(i)
      && p.positions.some((position) => seat.accepts.includes(position)));
    if (index === -1) continue;
    taken.add(index);
    total += points.get(p.playerKey);
  }
  return total;
}

test('a starting slot is expanded into one seat per count, and the bench is not', () => {
  const { seats, unresolved, unscoreable } = startingSeats([
    slot('QB', 1, ['QB']), slot('RB', 2, ['RB']), slot('WR', 2, ['WR']),
    bench('BN', 8), bench('IR', 2),
  ]);

  assert.equal(seats.length, 5);
  assert.deepEqual(seats.map((s) => s.slot), ['QB', 'RB', 'RB', 'WR', 'WR']);
  // Two seats of the same slot are distinguishable, or a Map keyed on them
  // would hold one.
  assert.deepEqual(seats.filter((s) => s.slot === 'RB').map((s) => s.index), [0, 1]);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(unscoreable, []);
});

test('a slot that could not be resolved is reported, never guessed at', () => {
  // `resolveSlots` gives `accepts: null` both for a composite it could not read
  // and for a vocabulary that never arrived. Either way there is no eligible
  // set, so seating anybody in it would be inventing the rule.
  const { seats, unresolved } = startingSeats([
    slot('QB', 1, ['QB']), slot('Q/W/R/T', 1, null, { unresolved: true }),
  ]);

  assert.deepEqual(seats.map((s) => s.slot), ['QB']);
  assert.deepEqual(unresolved, ['Q/W/R/T']);
});

test('a kicker or defence slot is unscoreable, which is not the same as unresolved', () => {
  // Y9.1 could not reproduce either position against a feed's published points,
  // so no desk projects them and no advice can cover the seat. The slot was
  // read correctly; the projection does not exist.
  const { seats, unresolved, unscoreable } = startingSeats([
    slot('QB', 1, ['QB']), slot('K', 1, ['K']), slot('DEF', 1, ['DEF']),
  ]);

  assert.deepEqual(seats.map((s) => s.slot), ['QB']);
  assert.deepEqual(unscoreable, ['K', 'DEF']);
  assert.deepEqual(unresolved, [], 'a slot that was read is not a slot that failed to read');
});

test('the best-first greedy loses to the optimum on the flex trap', () => {
  // The case from the file note. One receiver slot and one flex; a 20-point
  // receiver, an 18-point back and a 10-point receiver. Best-first spends the
  // flex on the 20 and strands the 18.
  const slots = [slot('W/R/T', 1, FLEX), slot('WR', 1, ['WR'])];
  const players = [
    player('wrA', ['WR'], 'W/R/T'),
    player('rbB', ['RB'], 'BN'),
    player('wrC', ['WR'], 'WR'),
  ];
  const points = pointsOf({ wrA: 20, rbB: 18, wrC: 10 });
  const { seats } = startingSeats(slots);

  const greedy = bestFirst(seats, players, points);
  const optimal = everyLineup(seats, players, points).best;
  const best = bestLineup({ slots, players, points });

  assert.equal(greedy, 30, 'the wrong algorithm must actually be wrong, or the trap is not one');
  assert.equal(optimal, 38);
  assert.equal(best.points, 38);
  assert.ok(best.points > greedy, 'the whole point of the file');

  // And the lineup is the one that gets there: the receiver in the receiver
  // slot, the back in the flex.
  const bySlot = new Map(best.lineup.map((entry) => [entry.seat.slot, entry.player.playerKey]));
  assert.equal(bySlot.get('WR'), 'wrA');
  assert.equal(bySlot.get('W/R/T'), 'rbB');
});

/**
 * The other wrong algorithm, and the one actually in this repository.
 *
 * `client/src/engine/roster.ts` fills the dedicated slots with the best players
 * at each position and then fills the flex out of what is left, and its comment
 * says that is exact. IT IS EXACT THERE, and the reason is worth writing down
 * because it is the reason it cannot be reused here: in the draft engine a
 * player has exactly one position, so each dedicated slot's candidates are a
 * subset of the flex's, the family of slots is laminar, and filling the most
 * restrictive slot first is optimal.
 *
 * In-season data breaks that in one specific way. Yahoo publishes
 * `eligible_positions`, and it really does list players as `WR,TE` -- so a
 * player can be a candidate for two different dedicated slots, the family stops
 * being laminar, and dedicated-first can spend a slot on a player the other
 * slot needed more. That is not a hypothetical: `league.js` keeps every eligible
 * position precisely because the pair is what a legal-lineup check runs on.
 */
function dedicatedFirst(seats, players, points) {
  const taken = new Set();
  let total = 0;
  // Most restrictive first, which is what makes it the laminar greedy rather
  // than the best-first one above.
  const order = [...seats.keys()].sort((a, b) => seats[a].accepts.length - seats[b].accepts.length);

  for (const index of order) {
    const seat = seats[index];
    const best = [...players]
      .filter((p) => !taken.has(p.playerKey) && points.has(p.playerKey))
      .filter((p) => p.positions.some((position) => seat.accepts.includes(position)))
      .sort((a, b) => points.get(b.playerKey) - points.get(a.playerKey))[0];
    if (!best) continue;
    taken.add(best.playerKey);
    total += points.get(best.playerKey);
  }
  return total;
}

test('the dedicated-first greedy loses where a player is eligible at two positions', () => {
  // The draft engine's algorithm, on data the draft engine never sees. The
  // receiver-tight end is the best player available for the receiver slot, and
  // giving him it strands a better lineup: the tight end slot then has only a
  // 5-point tight end to fall back on.
  const slots = [slot('WR', 1, ['WR']), slot('TE', 1, ['TE']), slot('W/R/T', 1, FLEX)];
  const players = [
    player('wrte', ['WR', 'TE'], 'WR'),
    player('wr1', ['WR'], 'W/R/T'),
    player('te1', ['TE'], 'TE'),
    player('rb1', ['RB'], 'BN'),
  ];
  const points = pointsOf({ wrte: 20, wr1: 19, te1: 5, rb1: 18 });
  const { seats } = startingSeats(slots);

  const laminar = dedicatedFirst(seats, players, points);
  const optimal = everyLineup(seats, players, points).best;
  const best = bestLineup({ slots, players, points });

  assert.equal(laminar, 44, 'the simpler algorithm must actually lose, or it would do');
  assert.equal(optimal, 57);
  assert.equal(best.points, 57);

  // And the lineup that gets there puts the dual-eligible player in the slot
  // only he can fill well, which is the move the simpler algorithm cannot make.
  const bySlot = new Map(best.lineup.map((entry) => [entry.seat.slot, entry.player.playerKey]));
  assert.equal(bySlot.get('TE'), 'wrte');
  assert.equal(bySlot.get('WR'), 'wr1');
  assert.equal(bySlot.get('W/R/T'), 'rb1');
});

test('the optimum matches exhaustive enumeration across every small roster shape', () => {
  // Six shapes, each with a flex or a dual-eligible player, which is where the
  // orderings diverge. Eight seats at most, so the enumeration finishes.
  const shapes = [
    {
      what: 'one flex, three receivers and two backs',
      slots: [slot('RB', 2, ['RB']), slot('WR', 2, ['WR']), slot('W/R/T', 1, FLEX)],
      players: [
        player('rb1', ['RB'], 'RB'), player('rb2', ['RB'], 'RB'), player('rb3', ['RB'], 'BN'),
        player('wr1', ['WR'], 'WR'), player('wr2', ['WR'], 'WR'), player('wr3', ['WR'], 'W/R/T'),
        player('te1', ['TE'], 'BN'),
      ],
      points: pointsOf({
        rb1: 14.2, rb2: 9.8, rb3: 11.1, wr1: 16.4, wr2: 8.2, wr3: 12.9, te1: 10.4,
      }),
    },
    {
      what: 'a dual-eligible receiver and tight end, which Yahoo really lists',
      slots: [slot('WR', 2, ['WR']), slot('TE', 1, ['TE']), slot('W/R/T', 1, FLEX)],
      players: [
        player('wrte1', ['WR', 'TE'], 'TE'), player('wr1', ['WR'], 'WR'),
        player('wr2', ['WR'], 'WR'), player('te1', ['TE'], 'BN'),
        player('rb1', ['RB'], 'W/R/T'),
      ],
      points: pointsOf({ wrte1: 13.5, wr1: 15.0, wr2: 6.75, te1: 5.5, rb1: 12.25 }),
    },
    {
      what: 'a superflex, which puts a quarterback in competition with everyone',
      slots: [
        slot('QB', 1, ['QB']), slot('RB', 1, ['RB']), slot('WR', 1, ['WR']),
        slot('Q/W/R/T', 1, ['QB', 'WR', 'RB', 'TE']),
      ],
      players: [
        player('qb1', ['QB'], 'QB'), player('qb2', ['QB'], 'BN'),
        player('rb1', ['RB'], 'RB'), player('wr1', ['WR'], 'WR'),
        player('wr2', ['WR'], 'Q/W/R/T'), player('te1', ['TE'], 'BN'),
      ],
      points: pointsOf({ qb1: 21.4, qb2: 18.9, rb1: 12.1, wr1: 14.6, wr2: 13.2, te1: 7.8 }),
    },
    {
      what: 'two flexes, where the shuffle has to run twice',
      slots: [slot('RB', 1, ['RB']), slot('W/R/T', 2, FLEX), slot('WR', 1, ['WR'])],
      players: [
        player('rb1', ['RB'], 'W/R/T'), player('rb2', ['RB'], 'W/R/T'),
        player('wr1', ['WR'], 'WR'), player('wr2', ['WR'], 'BN'),
        player('te1', ['TE'], 'BN'), player('rb3', ['RB'], 'RB'),
      ],
      points: pointsOf({ rb1: 19.5, rb2: 17.25, wr1: 4.1, wr2: 16.8, te1: 15.9, rb3: 3.3 }),
    },
    {
      what: 'more seats than players who can fill them',
      slots: [slot('RB', 2, ['RB']), slot('WR', 3, ['WR']), slot('W/R/T', 1, FLEX)],
      players: [
        player('rb1', ['RB'], 'RB'), player('wr1', ['WR'], 'WR'), player('te1', ['TE'], 'W/R/T'),
      ],
      points: pointsOf({ rb1: 10.5, wr1: 11.5, te1: 9.25 }),
    },
    {
      what: 'ties, which must not change the total whichever way they fall',
      slots: [slot('WR', 2, ['WR']), slot('W/R/T', 1, FLEX)],
      players: [
        player('wr1', ['WR'], 'WR'), player('wr2', ['WR'], 'WR'),
        player('wr3', ['WR'], 'BN'), player('rb1', ['RB'], 'W/R/T'),
      ],
      points: pointsOf({ wr1: 12, wr2: 12, wr3: 12, rb1: 12 }),
    },
  ];

  for (const shape of shapes) {
    const { slots, players, points } = shape;
    const { seats } = startingSeats(slots);
    const { best: optimal, count } = everyLineup(seats, players, points);
    const got = bestLineup({ slots, players, points });

    assert.ok(count > 1, `${shape.what}: the enumeration must have enumerated something`);
    assert.equal(
      Number(got.points.toFixed(6)),
      Number(optimal.toFixed(6)),
      `${shape.what}: ${got.points} against a true maximum of ${optimal}`,
    );
    // Every seated player is eligible for the seat he is in, which the total
    // alone would not catch.
    for (const { seat, player: seated } of got.lineup) {
      assert.ok(
        seated.positions.some((position) => seat.accepts.includes(position)),
        `${shape.what}: ${seated.playerKey} cannot fill ${seat.slot}`,
      );
    }
    // Nobody is in two seats at once.
    const keys = got.lineup.map((entry) => entry.player.playerKey);
    assert.equal(new Set(keys).size, keys.length, `${shape.what}: a player seated twice`);
  }
});

test('a locked player never moves, whether he is starting or benched', () => {
  // The starting one is the case that matters: he is projected worst of the
  // three receivers and the optimum without the lock would bench him.
  const slots = [slot('WR', 1, ['WR']), slot('W/R/T', 1, FLEX)];
  const players = [
    player('wrLocked', ['WR'], 'WR'),
    player('wrBetter', ['WR'], 'BN'),
    player('rbLocked', ['RB'], 'BN'),
    player('rbFree', ['RB'], 'W/R/T'),
  ];
  const points = pointsOf({ wrLocked: 4, wrBetter: 22, rbLocked: 25, rbFree: 11 });

  const free = bestLineup({ slots, players, points });
  assert.equal(free.points, 47, 'without locks the two best are startable');

  const locked = bestLineup({
    slots, players, points, locked: new Set(['wrLocked', 'rbLocked']),
  });

  const bySlot = new Map(locked.lineup.map((e) => [e.seat.slot, e.player.playerKey]));
  assert.equal(bySlot.get('WR'), 'wrLocked', 'a locked starter stays in his slot');
  assert.notEqual(bySlot.get('W/R/T'), 'rbLocked', 'a locked bench player cannot be started');
  assert.equal(bySlot.get('W/R/T'), 'wrBetter', 'the flex still improves around the lock');
  assert.equal(locked.points, 26);

  // And no move is ever suggested that involves either of them.
  const { moves } = lineupMoves(locked, players);
  const named = moves.flatMap((move) => [move.out?.playerKey, move.in?.playerKey]);
  assert.ok(!named.includes('rbLocked'), 'a locked player is never advised in');
  assert.ok(!named.includes('wrLocked'), 'a locked player is never advised out');
});

test('a player with no projection is never recommended in', () => {
  const slots = [slot('WR', 1, ['WR']), slot('W/R/T', 1, FLEX)];
  const players = [
    player('wr1', ['WR'], 'WR'),
    player('rbUnknown', ['RB'], 'BN'),
    player('rbKnown', ['RB'], 'BN'),
  ];
  // No key for `rbUnknown` at all: nobody projected him. Not a zero.
  const points = pointsOf({ wr1: 10, rbKnown: 6 });

  const best = bestLineup({ slots, players, points });
  const seated = best.lineup.map((e) => e.player.playerKey);

  assert.ok(!seated.includes('rbUnknown'));
  assert.deepEqual(seated.sort(), ['rbKnown', 'wr1']);
});

test('an unprojected starter makes the gain unknown rather than wrong', () => {
  // A number here would be a confident understatement or overstatement of the
  // gain with no way to tell which, so there is no number.
  const slots = [slot('WR', 1, ['WR']), slot('W/R/T', 1, FLEX)];
  const players = [
    player('wrUnknown', ['WR'], 'WR'),
    player('rb1', ['RB'], 'W/R/T'),
    player('wr2', ['WR'], 'BN'),
  ];
  const points = pointsOf({ rb1: 9, wr2: 14 });

  const advice = lineupAdvice({ slots, players, sources: { sleeper: points } });

  assert.equal(advice.desks.sleeper.gain, null);
  assert.deepEqual(
    advice.desks.sleeper.unscoredStarters,
    [{ player: 'wrUnknown', slot: 'WR', reason: 'not projected' }],
  );
});

test('a player on bye is data, not a zero', () => {
  const slots = [slot('RB', 1, ['RB'])];
  const players = [player('rbBye', ['RB'], 'RB', { byeWeek: 7 }), player('rbFit', ['RB'], 'BN')];
  // The bye player is projected higher, and a stale desk really does leave a
  // number against a bye week. Scoring him as zero would be the right answer by
  // luck; refusing to start him is the right answer for the right reason.
  const points = pointsOf({ rbBye: 18, rbFit: 7 });

  const week7 = bestLineup({ slots, players, points, week: 7 });
  assert.deepEqual(week7.lineup.map((e) => e.player.playerKey), ['rbFit']);
  assert.deepEqual(week7.benched, [{ player: 'rbBye', slot: 'RB', reason: 'on bye' }]);

  // A different week is a different answer, from the same roster.
  const week8 = bestLineup({ slots, players, points, week: 8 });
  assert.deepEqual(week8.lineup.map((e) => e.player.playerKey), ['rbBye']);

  // And with no week in hand nothing is claimed about byes either way.
  const noWeek = bestLineup({ slots, players, points });
  assert.deepEqual(noWeek.lineup.map((e) => e.player.playerKey), ['rbBye']);
});

test('a player on injured reserve is never started', () => {
  const slots = [slot('WR', 1, ['WR'])];
  const players = [player('wrIR', ['WR'], 'IR'), player('wrFit', ['WR'], 'WR')];
  const points = pointsOf({ wrIR: 20, wrFit: 8 });

  const best = bestLineup({ slots, players, points });

  assert.deepEqual(best.lineup.map((e) => e.player.playerKey), ['wrFit']);
  // Not reported as benched: IR is not a starting slot, so he is not in the
  // lineup being advised on and naming him would be noise.
  assert.deepEqual(best.benched, []);
});

test('a lineup already optimal produces no advice, not a zero-point swap', () => {
  const slots = [slot('RB', 2, ['RB']), slot('WR', 1, ['WR']), slot('W/R/T', 1, FLEX)];
  const players = [
    player('rb1', ['RB'], 'RB'), player('rb2', ['RB'], 'RB'),
    player('wr1', ['WR'], 'WR'), player('wr2', ['WR'], 'W/R/T'),
    player('rb3', ['RB'], 'BN'), player('te1', ['TE'], 'BN'),
  ];
  const points = pointsOf({
    rb1: 15, rb2: 13, wr1: 17, wr2: 12, rb3: 4, te1: 3,
  });

  const advice = lineupAdvice({ slots, players, sources: { sleeper: points } });

  assert.deepEqual(advice.desks.sleeper.moves, [], 'the best lineup is the current one');
  assert.equal(advice.desks.sleeper.gain, 0);
  assert.equal(advice.desks.sleeper.currentPoints, 57);
});

test('two equally good players do not generate a swap between them', () => {
  // The tie-break exists for this. Both receivers are projected 12, so either
  // lineup scores the same, and advising the change would be advice to do
  // nothing dressed as advice to do something.
  const slots = [slot('WR', 1, ['WR'])];
  const players = [player('wrIn', ['WR'], 'WR'), player('wrOut', ['WR'], 'BN')];
  const points = pointsOf({ wrIn: 12, wrOut: 12 });

  const advice = lineupAdvice({ slots, players, sources: { sleeper: points } });

  assert.deepEqual(advice.desks.sleeper.moves, []);
  assert.equal(advice.desks.sleeper.gain, 0);
});

test('an interchangeable seat does not move a player who is already seated', () => {
  // Two flex seats and two players who each fill both. Any assignment scores
  // the same, and only one of them is the lineup the user already has.
  const slots = [slot('W/R/T', 2, FLEX)];
  const players = [player('rb1', ['RB'], 'W/R/T'), player('wr1', ['WR'], 'W/R/T')];
  const points = pointsOf({ rb1: 11, wr1: 9 });

  const advice = lineupAdvice({ slots, players, sources: { sleeper: points } });

  assert.deepEqual(advice.desks.sleeper.moves, []);
});

test('a beneficial move is reported as the seat the user actually edits', () => {
  const slots = [slot('RB', 1, ['RB']), slot('W/R/T', 1, FLEX)];
  const players = [
    player('rb1', ['RB'], 'RB'), player('teWeak', ['TE'], 'W/R/T'),
    player('wrStrong', ['WR'], 'BN'),
  ];
  const points = pointsOf({ rb1: 14, teWeak: 5, wrStrong: 16 });

  const advice = lineupAdvice({ slots, players, sources: { sleeper: points } });
  const { moves, gain, currentPoints, points: best } = advice.desks.sleeper;

  assert.equal(moves.length, 1);
  assert.equal(moves[0].slot, 'W/R/T');
  assert.equal(moves[0].out.name, 'teWeak');
  assert.equal(moves[0].in.name, 'wrStrong');
  assert.equal(currentPoints, 19);
  assert.equal(best, 30);
  assert.equal(gain, 11);
});

test('a seat nothing can fill is reported empty rather than left unmentioned', () => {
  const slots = [slot('QB', 1, ['QB']), slot('TE', 1, ['TE'])];
  const players = [player('qb1', ['QB'], 'QB')];
  const points = pointsOf({ qb1: 20 });

  const best = bestLineup({ slots, players, points });

  assert.deepEqual(best.empty, ['TE']);
  assert.equal(best.lineup.length, 1);
});

test('two desks disagreeing about a seat report the disagreement, not a winner', () => {
  const slots = [slot('W/R/T', 1, FLEX)];
  const players = [player('wr1', ['WR'], 'W/R/T'), player('rb1', ['RB'], 'BN')];
  // The Tua case in miniature: each desk prefers a different player, and the
  // mean would name a third answer neither holds.
  const sleeper = pointsOf({ wr1: 15.29, rb1: 10.75 });
  const espn = pointsOf({ wr1: 10.75, rb1: 15.29 });

  const advice = lineupAdvice({ slots, players, sources: { sleeper, espn } });

  assert.deepEqual(advice.answered, ['sleeper', 'espn']);
  assert.equal(advice.disputed.length, 1);
  assert.deepEqual(advice.agreed, []);

  const [dispute] = advice.disputed;
  assert.equal(dispute.slot, 'W/R/T');
  assert.deepEqual(dispute.picks.map((pick) => pick.player), ['wr1', 'rb1']);
  // Each desk's view of both players, so the screen can show both rather than
  // the difference between them.
  assert.deepEqual(dispute.picks[0].points, { sleeper: 15.29, espn: 10.75 });
  assert.deepEqual(dispute.picks[1].points, { sleeper: 10.75, espn: 15.29 });
  assert.equal(Number(dispute.spread.toFixed(2)), 4.54);
  assert.equal(dispute.material, true, '4.54 is past the three points Y9.0 measured');

  // Each desk still gives its own advice. Neither is suppressed for disagreeing.
  assert.equal(advice.desks.sleeper.moves.length, 0);
  assert.equal(advice.desks.espn.moves.length, 1);
});

test('a disagreement inside the measured spread is reported as the close call it is', () => {
  const slots = [slot('W/R/T', 1, FLEX)];
  const players = [player('wr1', ['WR'], 'W/R/T'), player('rb1', ['RB'], 'BN')];
  const sleeper = pointsOf({ wr1: 12.1, rb1: 11.9 });
  const espn = pointsOf({ wr1: 11.8, rb1: 12.2 });

  const advice = lineupAdvice({ slots, players, sources: { sleeper, espn } });

  assert.equal(advice.disputed.length, 1);
  assert.ok(advice.disputed[0].spread < MATERIAL_SPREAD);
  assert.equal(advice.disputed[0].material, false);
});

test('two desks agreeing report agreement, which is a stronger claim than one desk', () => {
  const slots = [slot('WR', 1, ['WR']), slot('W/R/T', 1, FLEX)];
  const players = [
    player('wr1', ['WR'], 'WR'), player('rb1', ['RB'], 'W/R/T'),
    player('te1', ['TE'], 'BN'),
  ];
  const sleeper = pointsOf({ wr1: 18, rb1: 12, te1: 4 });
  const espn = pointsOf({ wr1: 16, rb1: 14, te1: 5 });

  const advice = lineupAdvice({ slots, players, sources: { sleeper, espn } });

  assert.deepEqual(advice.disputed, []);
  assert.deepEqual(advice.agreed, [
    { slot: 'WR', player: 'wr1' }, { slot: 'W/R/T', player: 'rb1' },
  ]);
});

test('a desk that did not answer is absent, and one that answered with nothing is not', () => {
  const slots = [slot('WR', 1, ['WR'])];
  const players = [player('wr1', ['WR'], 'WR')];

  // Null is a fetch that failed: the desk has said nothing about anybody.
  const failed = lineupAdvice({
    slots, players, sources: { sleeper: pointsOf({ wr1: 10 }), espn: null },
  });
  assert.deepEqual(failed.answered, ['sleeper']);
  assert.deepEqual(failed.disputed, [], 'one desk cannot disagree with anybody');

  // An empty Map is a desk that answered and projected nobody, which is a real
  // if unlikely state and reports as a lineup it could not fill.
  const empty = lineupAdvice({
    slots, players, sources: { sleeper: pointsOf({ wr1: 10 }), espn: new Map() },
  });
  assert.deepEqual(empty.answered, ['sleeper', 'espn']);
  assert.deepEqual(empty.desks.espn.empty, ['WR']);
  assert.deepEqual(empty.desks.espn.lineup, []);
});

test('nothing known about locks is carried as unknown, never as nothing locked', () => {
  const slots = [slot('WR', 1, ['WR'])];
  const players = [player('wr1', ['WR'], 'WR')];
  const points = pointsOf({ wr1: 10 });

  // Yahoo publishes no kickoff time at any scope, so this is the ordinary case
  // rather than an edge one. Advice given as though nothing had locked would be
  // advice to make moves the user may no longer be able to make.
  const unknown = lineupAdvice({ slots, players, sources: { sleeper: points } });
  assert.equal(unknown.locksKnown, false);
  assert.equal(unknown.desks.sleeper.locked, null);

  const known = lineupAdvice({
    slots, players, sources: { sleeper: points }, locked: new Set(),
  });
  assert.equal(known.locksKnown, true);
  assert.deepEqual(known.desks.sleeper.locked, [], 'answered, and nothing is locked');
});

test('the limits travel with the advice rather than being left for a caller to notice', () => {
  const slots = [
    slot('QB', 1, ['QB']), slot('K', 1, ['K']), slot('Q/W/R/T', 1, null, { unresolved: true }),
  ];
  const players = [player('qb1', ['QB'], 'QB'), player('k1', ['K'], 'K')];
  const points = pointsOf({ qb1: 22 });

  const advice = lineupAdvice({ slots, players, sources: { sleeper: points } });

  assert.deepEqual(advice.desks.sleeper.unscoreable, ['K']);
  assert.deepEqual(advice.desks.sleeper.unresolved, ['Q/W/R/T']);
  assert.equal(advice.desks.sleeper.points, 22, 'only the seat that can be advised on is counted');
});
