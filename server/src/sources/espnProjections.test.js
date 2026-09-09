// Reading one week out of ESPN's weekly projection feed.
//
//   npm --prefix server test
//
// The reason this is checked here rather than through an endpoint is that the
// failure is invisible downstream. ESPN files last season's weekly projection
// beside this one's under the same `scoringPeriodId`, distinguished only by
// `seasonId`, so a reader that takes the first match returns a real projection
// for a real player from the wrong year -- right shape, right range, right
// name, wrong season. Nothing further along can tell.
//
// The rows below are Jahmyr Gibbs's actual pair from a week 1 read on
// 2026-09-09: 18.42 for 2025 and 22.50 for 2026, under one week number. It was
// 896 of 1036 players, so this is the ordinary case rather than an edge.
//
// Nothing here reaches the network.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readComponents, readWeek, readOwnScoring, weekRow } from './espnProjections.js';

const YEAR = 2026;
const WEEK = 1;

/** One reading of a player, shaped the way ESPN files them. */
const row = ({ seasonId, week = WEEK, source = 1, split = 1, total, stats }) => ({
  seasonId, scoringPeriodId: week, statSourceId: source, statSplitTypeId: split,
  appliedTotal: total, stats,
});

/** Gibbs, with both seasons under week 1, as ESPN actually answered. */
const gibbs = (extra = []) => ({
  players: [{
    player: {
      fullName: 'Jahmyr Gibbs',
      defaultPositionId: 2,
      proTeamId: 8,
      stats: [
        row({
          seasonId: 2025,
          total: 18.41926089,
          stats: { 24: 65.83510873, 42: 33.77520352, 25: 0.7, 53: 3.5 },
        }),
        row({
          seasonId: 2026,
          total: 22.50256092,
          stats: { 24: 90.42701908, 42: 31.56087642, 25: 0.88659924, 53: 3.896853037 },
        }),
        ...extra,
      ],
    },
  }],
});

test("last season's row under this week's number is not read as this season's", () => {
  const { rows } = readWeek(gibbs(), { year: YEAR, week: WEEK });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Jahmyr Gibbs');
  assert.equal(rows[0].publishedTotal, 22.50256092);
  assert.equal(rows[0].components.rushYd, 90.42701908);
});

test('and asking for last season gets last season, rather than nothing', () => {
  // The filter is a filter and not a preference for the newest row. A reader
  // that just took the highest `seasonId` would answer this wrongly and pass
  // the check above, which is why both directions are asked.
  const { rows } = readWeek(gibbs(), { year: 2025, week: WEEK });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].publishedTotal, 18.41926089);
  assert.equal(rows[0].components.rushYd, 65.83510873);
});

test('an actual is not read as a projection, nor a season total as a week', () => {
  // `statSourceId: 0` is what happened and `statSplitTypeId: 0` is the season.
  // All three conditions carry weight; none is decoration.
  const withNoise = gibbs([
    row({ seasonId: YEAR, source: 0, total: 99, stats: { 24: 999 } }),
    row({ seasonId: YEAR, split: 0, total: 88, stats: { 24: 888 } }),
  ]);
  const { rows } = readWeek(withNoise, { year: YEAR, week: WEEK });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].publishedTotal, 22.50256092);
});

test('a row for another week is not read as this one', () => {
  const other = readWeek(gibbs(), { year: YEAR, week: 4 });
  assert.deepEqual(other.rows, []);
});

test('a row carrying no stats at all is passed over for one that does', () => {
  // Observed past week 18: a response that parses is not an answer. An empty
  // `stats` is not a projection of nothing.
  const empty = {
    players: [{
      player: {
        fullName: 'Jahmyr Gibbs',
        defaultPositionId: 2,
        proTeamId: 8,
        stats: [
          row({ seasonId: YEAR, total: 0, stats: {} }),
          row({ seasonId: YEAR, total: 22.5, stats: { 24: 90.4 } }),
        ],
      },
    }],
  };
  assert.equal(weekRow(empty.players[0].player, { year: YEAR, week: WEEK }).appliedTotal, 22.5);
});

test('a player nobody projected is dropped rather than scored zero', () => {
  const nobody = {
    players: [{
      player: {
        fullName: 'A Practice Squad Receiver',
        defaultPositionId: 3,
        proTeamId: 8,
        stats: [row({ seasonId: YEAR, total: 0, stats: {} })],
      },
    }],
  };
  assert.deepEqual(readWeek(nobody, { year: YEAR, week: WEEK }).rows, []);
  assert.equal(readComponents({}), null);
  assert.equal(readComponents(null), null);
});

test('a team defence is not projected off an incidental return touchdown', () => {
  // Found by looking at the live feed rather than by reasoning: ESPN files a
  // return-touchdown projection against all 32 defences, so a reader keeping
  // any row with any component put the Texans on the board at kickReturnTd
  // 0.0104 and puntReturnTd 0.0125. Under a league scoring return touchdowns
  // that is a defence projecting 0.14 points, ranked against the other 31,
  // looking exactly like advice -- when the truth is that nothing here can
  // score a defence at all.
  const defence = {
    players: [{
      player: {
        fullName: 'Texans D/ST',
        defaultPositionId: 16,
        proTeamId: 34,
        stats: [row({
          seasonId: YEAR, total: 7.2, stats: { 101: 0.010413847, 102: 0.012459774 },
        })],
      },
    }],
  };
  assert.deepEqual(readWeek(defence, { year: YEAR, week: WEEK }).rows, []);
});

test('and a kicker is not projected either, for the same reason', () => {
  const kicker = {
    players: [{
      player: {
        fullName: 'Andy Borregales',
        defaultPositionId: 5,
        proTeamId: 17,
        stats: [row({ seasonId: YEAR, total: 8.1, stats: { 83: 1.64, 86: 2.4 } })],
      },
    }],
  };
  assert.deepEqual(readWeek(kicker, { year: YEAR, week: WEEK }).rows, []);
});

test('a position no roster slot holds is left out of the week', () => {
  // ESPN tracks positions this app has no slot for. A row keyed at one would
  // join to nothing and sit on the board as a player nobody has heard of.
  const linebacker = {
    players: [{
      player: {
        fullName: 'A Linebacker',
        defaultPositionId: 9,
        proTeamId: 8,
        stats: [row({ seasonId: YEAR, total: 12, stats: { 24: 5 } })],
      },
    }],
  };
  assert.deepEqual(readWeek(linebacker, { year: YEAR, week: WEEK }).rows, []);
});

test("ESPN's own preset is read off its own settings, ids and all", () => {
  // What makes the id mapping a reading rather than an assertion: this is the
  // ruleset the published `appliedTotal` is on, so components times these must
  // reproduce it. Ids ESPN scores that this project has no component for are
  // dropped here rather than carried as a rule nothing can apply.
  const scoring = readOwnScoring({
    settings: {
      scoringSettings: {
        scoringItems: [
          { statId: 3, points: 0.04 },
          { statId: 53, points: 1 },
          { statId: 20, points: -2 },
          { statId: 999, points: 6 },
          { statId: 42, pointsOverrides: { 16: 0.1 } },
        ],
      },
    },
  });

  assert.deepEqual(scoring, [
    { component: 'passYd', points: 0.04 },
    { component: 'rec', points: 1 },
    { component: 'passInt', points: -2 },
  ]);
});

test('and no settings at all reads as no scoring, not as a crash', () => {
  assert.deepEqual(readOwnScoring({}), []);
  assert.deepEqual(readOwnScoring(null), []);
  assert.deepEqual(readWeek(null, { year: YEAR, week: WEEK }).rows, []);
});
