// Turning a desk's raw components into one league's points.
//
//   npm --prefix server test
//
// No endpoint can show this and no screen should be trusted to. What is being
// checked is arithmetic against a vocabulary, and the way it goes wrong is
// silent: a mis-mapped stat id produces a total of the right shape, in the
// right range, that sorts sensibly against the others and is simply not this
// league's points.
//
// THE CHECK THAT CATCHES THAT IS THE PRESET REPRODUCTION. Set a synthetic
// league's rules to a source's own scoring, feed it that source's own
// components for a real player, and the answer must be the number that source
// publishes for him. It has to agree to 0.05 across a quarterback, a back, a
// receiver and a tight end, on both desks, and it cannot be satisfied by a
// mapping that is wrong anywhere the player is non-zero.
//
// The components below are real, copied from a live week 1 read on 2026-09-09
// with the points each feed published beside them, so the check has something
// to fail against. Nothing here reaches the network.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMPONENTS_SUPPLIED as SLEEPER_SUPPLIES } from '../../sources/sleeperProjections.js';
import { COMPONENTS_SUPPLIED as ESPN_SUPPLIES } from '../../sources/espnProjections.js';
import {
  scoreComponents, scoreProjection, scoreRoster, unsupportedRules,
} from './scoring.js';
import { joinKey } from '../../names.js';

/**
 * A league rule, shaped the way `league.js` reads one.
 *
 * `statId` is a string there, because Yahoo writes it as one, so it is a string
 * here too. A test that quietly used numbers would pass while the real reader
 * missed every rule.
 */
const rule = (statId, points, name = `stat ${statId}`, extra = {}) => ({
  statId: String(statId), name, abbr: null, group: null, enabled: true, points, ...extra,
});

/**
 * Sleeper's PPR preset, expressed as a Yahoo league's rules.
 *
 * The interception is the interesting line: Sleeper scores it at -1 and ESPN at
 * -2, which Y9.0 found by watching a shared-preset check fail. A single
 * "standard PPR" ruleset applied to both desks reads as a broken mapping when
 * nothing is broken.
 */
const SLEEPER_PPR = [
  rule(4, 0.04, 'Passing Yards'),
  rule(5, 4, 'Passing Touchdowns'),
  rule(6, -1, 'Interceptions'),
  rule(9, 0.1, 'Rushing Yards'),
  rule(10, 6, 'Rushing Touchdowns'),
  rule(11, 1, 'Receptions'),
  rule(12, 0.1, 'Receiving Yards'),
  rule(13, 6, 'Receiving Touchdowns'),
  rule(16, 2, '2-Point Conversions'),
  rule(18, -2, 'Fumbles Lost'),
];

/** ESPN's, read off its own `scoringItems` for `leaguedefaults/3`. */
const ESPN_PPR = [
  ...SLEEPER_PPR.filter((r) => r.statId !== '6'),
  rule(6, -2, 'Interceptions'),
  rule(15, 6, 'Return Touchdowns'),
];

/* Real Sleeper components, week 1, with the points Sleeper published. */
const SLEEPER_PLAYERS = [
  ['Josh Allen', 21.11, {
    passYd: 235.21, passTd: 1.64, passInt: 0.72, pass2pt: 0.1,
    rushYd: 26.3, rushTd: 0.55, rush2pt: 0.03, fumLost: 0.18,
  }],
  ['Jahmyr Gibbs', 23.68, {
    rushYd: 90.73, rushTd: 0.94, rush2pt: 0.06,
    rec: 4.6, recYd: 30.67, recTd: 0.22, rec2pt: 0.01, fumLost: 0.09,
  }],
  ['Puka Nacua', 20.48, {
    rushYd: 2.89, rushTd: 0.02, rush2pt: 0,
    rec: 7.28, recYd: 96.15, recTd: 0.53, rec2pt: 0.03, fumLost: 0.03,
  }],
  ['Brock Bowers', 16.03, {
    rushYd: 0.9, rushTd: 0.01, rush2pt: 0,
    rec: 6.59, recYd: 67.1, recTd: 0.43, rec2pt: 0.02, fumLost: 0.03,
  }],
];

/* Real ESPN components, week 1, with the `appliedTotal` ESPN published. */
const ESPN_PLAYERS = [
  ['Jalen Hurts', 21.06560241, {
    passYd: 229.1051475, passTd: 1.661199686, passInt: 0.518148259, pass2pt: 0.073907927,
    rushYd: 27.46148027, rushTd: 0.636209253, rush2pt: 0.018935249, fumLost: 0.234607805,
  }],
  ['Jahmyr Gibbs', 22.50256092, {
    rushYd: 90.42701908, rushTd: 0.88659924, rush2pt: 0.016722062,
    rec: 3.896853037, recYd: 31.56087642, recTd: 0.200487615, rec2pt: 0.004433793,
    fumLost: 0.081204255,
  }],
  ['Puka Nacua', 21.05111861, {
    rushYd: 5.263290323, rushTd: 0.06022031, rush2pt: 0.000903,
    rec: 7.350170685, recYd: 94.24409542, recTd: 0.580182315, rec2pt: 0.007903493,
    fumLost: 0.056259695,
  }],
  ['Brock Bowers', 15.59866694, {
    rushYd: 1.102119397, rushTd: 0.017653203, rush2pt: 0.000980183,
    rec: 6.003974578, recYd: 62.55493045, recTd: 0.516376104, rec2pt: 0.032251658,
    fumLost: 0.021333071,
  }],
];

test("Sleeper's own preset reproduces the points Sleeper publishes", () => {
  for (const [name, published, components] of SLEEPER_PLAYERS) {
    const { points } = scoreComponents(components, SLEEPER_PPR);
    assert.ok(
      Math.abs(points - published) <= 0.05,
      `${name}: computed ${points.toFixed(4)} against a published ${published}`,
    );
  }
});

test("ESPN's own preset reproduces the points ESPN publishes", () => {
  for (const [name, published, components] of ESPN_PLAYERS) {
    const { points } = scoreComponents(components, ESPN_PPR);
    assert.ok(
      Math.abs(points - published) <= 0.05,
      `${name}: computed ${points.toFixed(4)} against a published ${published}`,
    );
  }
});

test('and the two presets disagree, so one ruleset could not have stood in for both', () => {
  // The reproductions above would both pass on a mapping that ignored the
  // interception, which is exactly the mistake Y9.0 made first. This is the
  // check that the rule is read from the league rather than assumed: the same
  // components under the two presets must differ by the interception's price.
  const [, , hurts] = ESPN_PLAYERS[0];
  const asSleeper = scoreComponents(hurts, SLEEPER_PPR).points;
  const asEspn = scoreComponents(hurts, ESPN_PPR).points;
  assert.ok(asSleeper > asEspn, 'Sleeper prices an interception more kindly');
  assert.ok(Math.abs((asSleeper - asEspn) - hurts.passInt) < 1e-9);
});

test("Yahoo's single 2-point category sums all three of the feeds'", () => {
  // Yahoo scores one "2-Point Conversions" where the desks project passing,
  // rushing and receiving separately. A mapping that took one of the three
  // would score a conversion at a third of its value and look plausible.
  const components = { pass2pt: 1, rush2pt: 1, rec2pt: 1 };
  const { points, terms } = scoreComponents(components, [rule(16, 2)]);
  assert.equal(points, 6);
  assert.equal(terms[0].units, 3);
});

test("and Yahoo's single return-touchdown category sums both of ESPN's", () => {
  const { points } = scoreComponents(
    { kickReturnTd: 0.5, puntReturnTd: 0.25 }, [rule(15, 6)],
  );
  assert.equal(points, 4.5);
});

test('a rule no desk projects is reported, not scored as zero', () => {
  // A league scoring defensive touchdowns has nothing behind the rule. The
  // wrong answer is a total that silently omits it: right shape, right range,
  // sorts sensibly, and not this league's points.
  const scoring = [rule(4, 0.04, 'Passing Yards'), rule(35, 6, 'Touchdown')];
  const unsupported = unsupportedRules(scoring, SLEEPER_SUPPLIES);

  assert.equal(unsupported.length, 1);
  assert.equal(unsupported[0].statId, '35');
  assert.equal(unsupported[0].name, 'Touchdown');
  assert.match(unsupported[0].reason, /no projection source/);

  // And the total still carries the rules that could be scored, so an
  // unsupported rule limits the advice rather than voiding it.
  assert.equal(scoreComponents({ passYd: 100 }, scoring).points, 4);
});

test('a rule only one desk projects is unsupported for the other one', () => {
  const scoring = [rule(15, 6, 'Return Touchdowns')];
  assert.deepEqual(unsupportedRules(scoring, ESPN_SUPPLIES), []);

  const forSleeper = unsupportedRules(scoring, SLEEPER_SUPPLIES);
  assert.equal(forSleeper.length, 1);
  assert.match(forSleeper[0].reason, /does not project it/);
});

test('a rule the league counts but prices at nothing is not a gap', () => {
  // `league.js` keeps a category with no modifier against it, because counting
  // a stat at zero says something different from not counting it. Neither can
  // make a total wrong by going missing, so neither is worth reporting -- and
  // reporting them would put every ordinary league in the state reserved for a
  // league this app cannot score, which would make the state meaningless.
  const scoring = [
    rule(35, null, 'Counted, no modifier'),
    rule(36, 0, 'Counted, priced at zero'),
    rule(37, 6, 'Not counted at all', { enabled: false }),
  ];
  assert.deepEqual(unsupportedRules(scoring, SLEEPER_SUPPLIES), []);
  assert.equal(scoreComponents({ passYd: 100 }, scoring).points, 0);
});

test('a player one desk did not project scores null, not zero', () => {
  // 463 of 3304 weekly records carried points. Scoring the rest at zero would
  // rank three thousand players equal with a player on a bye, so the absence
  // has to survive the scoring rather than becoming a number in it.
  assert.equal(scoreComponents(null, SLEEPER_PPR), null);
  assert.equal(scoreComponents(undefined, SLEEPER_PPR), null);
});

test('the terms add up to the total, so a disagreement with Yahoo can be located', () => {
  const [, published, gibbs] = SLEEPER_PLAYERS[1];
  const { points, terms } = scoreComponents(gibbs, SLEEPER_PPR);
  const summed = terms.reduce((total, term) => total + term.points, 0);
  assert.ok(Math.abs(summed - points) < 1e-9);
  assert.ok(Math.abs(points - published) <= 0.05);
  // Every rule that moved the total is named, so the manual comparison Phase 9
  // requires is a line-by-line one rather than two totals and a shrug.
  assert.deepEqual(
    terms.map((term) => term.name).sort(),
    ['2-Point Conversions', 'Fumbles Lost', 'Receiving Touchdowns', 'Receiving Yards',
      'Receptions', 'Rushing Touchdowns', 'Rushing Yards'],
  );
});

test('a rule with no components present at all contributes no term', () => {
  // Distinct from scoring zero: a quarterback with no receptions in his record
  // is projected to catch nothing, and a term of zero would suggest the desk
  // had said so explicitly.
  const { terms } = scoreComponents({ passYd: 100 }, SLEEPER_PPR);
  assert.deepEqual(terms.map((term) => term.statId), ['4']);
});

/** A roster player, shaped the way `league.js` reads one. */
const rostered = (name, positions, team = 'BUF') => ({
  playerKey: `470.p.${name.length}${positions[0]}`,
  name,
  team,
  displayPosition: positions.join(','),
  positions,
  selectedPosition: positions[0],
});

/** A desk's week, keyed the way both projection readers key theirs. */
const deskWeek = (rows) => new Map(
  rows.map((row) => [joinKey(row.name, row.position, row.team), row]),
);

test('a desk row scores through the wrapper exactly as its components do', () => {
  // The wrapper Y9.1 deferred. It must add nothing: a row and its own
  // components are the same points, or the wrapper is doing arithmetic.
  const [name, published, components] = SLEEPER_PLAYERS[0];
  const row = { name, position: 'QB', team: 'BUF', components, modifiedAt: 1 };

  const viaRow = scoreProjection(row, SLEEPER_PPR);
  const viaComponents = scoreComponents(components, SLEEPER_PPR);

  assert.deepEqual(viaRow, viaComponents);
  assert.ok(Math.abs(viaRow.points - published) < 0.05);
});

test('a row carrying no components is null, not a player projected nothing', () => {
  assert.equal(scoreProjection(null, SLEEPER_PPR), null);
  assert.equal(scoreProjection({ name: 'A Ghost', position: 'WR' }, SLEEPER_PPR), null);
});

test('a roster scores against a desk, and the join tries every eligible position', () => {
  const [qbName, qbPublished, qbComponents] = SLEEPER_PLAYERS[0];
  // Filed by the desk as a tight end, listed by Yahoo as `WR,TE`. Joining on
  // the first eligible position alone would miss him, which is `boardMatch`'s
  // rule and the reason it is applied here too.
  const dual = { name: 'Dual Eligible', position: 'TE', team: 'KC', components: { rec: 5, recYd: 60 } };
  const byKey = deskWeek([
    { name: qbName, position: 'QB', team: 'BUF', components: qbComponents },
    dual,
  ]);

  const { points, unmatched } = scoreRoster({
    players: [rostered(qbName, ['QB']), rostered('Dual Eligible', ['WR', 'TE'], 'KC')],
    scoring: SLEEPER_PPR,
    byKey,
  });

  assert.equal(points.size, 2);
  assert.ok(Math.abs(points.get(rostered(qbName, ['QB']).playerKey) - qbPublished) < 0.05);
  assert.equal(points.get(rostered('Dual Eligible', ['WR', 'TE'], 'KC').playerKey), 11);
  assert.deepEqual(unmatched, []);
});

test('a rostered player no desk projected is absent from the map, never zero', () => {
  // Load-bearing: `lineup.js` reads a missing key as unprojected and refuses to
  // seat him. A zero here would turn a failed name match into a recommendation.
  const { points, unmatched } = scoreRoster({
    players: [rostered('Nobody Knows Him', ['WR'])],
    scoring: SLEEPER_PPR,
    byKey: deskWeek([]),
  });

  assert.equal(points.size, 0);
  assert.equal(points.has('470.p.16WR'), false);
  assert.deepEqual(unmatched, ['Nobody Knows Him']);
});

test('a desk that did not answer says nothing about anybody, rather than nothing', () => {
  // Null travels outward on the pattern Y8.4 set. An empty Map would report
  // every rostered player as one no desk has heard of, which reads as a finding
  // about the roster instead of as a fetch that failed.
  const nothing = scoreRoster({ players: [rostered('Josh Allen', ['QB'])], scoring: SLEEPER_PPR });

  assert.equal(nothing.points, null);
  assert.equal(nothing.unmatched, null);
});

test('the terms survive the roster join, so a total can be argued with', () => {
  const [name, , components] = SLEEPER_PLAYERS[0];
  const player = rostered(name, ['QB']);
  const { points, terms } = scoreRoster({
    players: [player],
    scoring: SLEEPER_PPR,
    byKey: deskWeek([{ name, position: 'QB', team: 'BUF', components }]),
  });

  const lines = terms.get(player.playerKey);
  const summed = lines.reduce((n, term) => n + term.points, 0);
  assert.ok(Math.abs(summed - points.get(player.playerKey)) < 1e-9);
  assert.ok(lines.some((term) => term.name === 'Passing Yards'));
});
