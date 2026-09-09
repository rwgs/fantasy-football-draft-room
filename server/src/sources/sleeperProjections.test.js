// Reading one week out of Sleeper's weekly projection feed.
//
//   npm --prefix server test
//
// Two rules that no endpoint would show going wrong, and one field that must
// never appear in the output at all.
//
// Sleeper answers a week with its whole pool -- 3304 records, of which 461 were
// really projected -- so which records count as projections is the difference
// between a lineup screen and three thousand players tied on nothing. And the
// column that looks like the answer, `pts_ppr`, is not one: it is Sleeper's own
// preset rather than the league's, and in a future week it contradicts the
// components in the very record it sits in.
//
// Nothing here reaches the network.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMPONENTS_SUPPLIED, readComponents, readWeek } from './sleeperProjections.js';

/** One projection record, with only the fields the reader looks at. */
const record = ({
  first, last, position, fantasy, team = 'BUF', stats, modified = 1788924026259,
}) => ({
  player_id: '1',
  team,
  last_modified: modified,
  company: 'rotowire',
  player: {
    first_name: first, last_name: last, position, fantasy_positions: fantasy,
  },
  stats,
});

/* Josh Allen's real week 1 components, and the points Sleeper published. */
const ALLEN_STATS = {
  pass_yd: 235.21, pass_td: 1.64, pass_int: 0.72, pass_2pt: 0.1,
  rush_yd: 26.3, rush_td: 0.55, rush_2pt: 0.03, fum_lost: 0.18,
  pts_ppr: 21.11, pts_half_ppr: 21.11, pts_std: 21.11,
  pass_att: 31.5, pass_fd: 23.52, rec_tgt: 0,
};

test('a record carrying components is read into this project\'s vocabulary', () => {
  const { rows } = readWeek([record({ first: 'Josh', last: 'Allen', position: 'QB', stats: ALLEN_STATS })]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].components, {
    passYd: 235.21, passTd: 1.64, passInt: 0.72, pass2pt: 0.1,
    rushYd: 26.3, rushTd: 0.55, rush2pt: 0.03, fumLost: 0.18,
  });
});

test('and the published points column is nowhere in the output', () => {
  // The field this module exists to avoid. It is one desk's preset, not the
  // league's rules, and in a future week it disagrees with its own record's
  // components by about 2.2 points for a quarterback.
  const { rows } = readWeek([record({ first: 'Josh', last: 'Allen', position: 'QB', stats: ALLEN_STATS })]);
  const serialised = JSON.stringify(rows[0]);

  assert.ok(!('pts_ppr' in rows[0].components));
  assert.ok(!serialised.includes('21.11'), 'the published total must not survive the read');
  assert.ok(!serialised.includes('pts_'));
});

test('a component this project has not verified is left behind', () => {
  // `pass_att`, `pass_fd` and `rec_tgt` are all in the record above and all
  // absent from the components. Their key names look self-explanatory, which is
  // the trap: nothing checks them against points anybody publishes, so a league
  // scoring them is told so rather than given a number.
  const { rows } = readWeek([record({ first: 'Josh', last: 'Allen', position: 'QB', stats: ALLEN_STATS })]);

  assert.ok(!('passAtt' in rows[0].components));
  assert.ok(!COMPONENTS_SUPPLIED.has('recTgt'));
});

test('a player nobody projected is dropped rather than scored zero', () => {
  // Sleeper returns a record for everyone. 2843 of 3304 carried nothing.
  const { rows } = readWeek([
    record({ first: 'A', last: 'Practice Squadder', position: 'WR', stats: { gp: 0 } }),
    record({ first: 'Another', last: 'One', position: 'WR', stats: {} }),
    record({ first: 'A', last: 'Third', position: 'WR', stats: null }),
  ]);

  assert.deepEqual(rows, []);
  assert.equal(readComponents({ gp: 0, adp_dd_ppr: 999 }), null);
  assert.equal(readComponents(null), null);
});

test('a component projected at zero is a projection, not an absence', () => {
  // Distinct from the case above. A desk saying "no rushing yards" is an
  // opinion; a desk saying nothing is not. Dropping a genuine zero would make
  // a player with one component look unprojected.
  const components = readComponents({ rush_yd: 0 });
  assert.deepEqual(components, { rushYd: 0 });
});

test('a player filed off the roster is keyed at the position a roster holds', () => {
  // The same rule `sleeper.js` settles for the draft board, imported rather
  // than repeated: two modules keying one feed differently would be two
  // answers to whether a record is the same player.
  const { rows, byKey } = readWeek([record({
    first: 'Travis', last: 'Hunter', position: 'DB', fantasy: ['DB', 'WR'],
    stats: { rec: 3.5, rec_yd: 45.2 },
  })]);

  assert.equal(rows[0].position, 'WR');
  assert.deepEqual([...byKey.keys()], ['travis hunter|WR']);
});

test('a kicker and a defence are not projected at all, not projected at nothing', () => {
  // Sleeper does publish components for both -- field goals by distance, points
  // allowed, sacks -- and not one of them is in this project's vocabulary,
  // because none could be verified against points anybody publishes. So a
  // kicker has no projection here rather than a small one, and the 461 records
  // Sleeper really projects for a week come through as 397.
  const { rows } = readWeek([
    record({
      first: 'Andy', last: 'Borregales', position: 'K', team: 'NE',
      stats: { fgm: 1.64, fgm_30_39: 0.45, xpm: 2.4, pts_ppr: 6.1 },
    }),
    record({
      first: 'Seattle', last: 'Seahawks', position: 'DEF', team: 'SEA',
      stats: { sack: 2.45, int: 0.83, pts_allow: 20.75, pts_ppr: 8.81 },
    }),
  ]);

  assert.deepEqual(rows, []);
});

test('and a player no roster slot can hold is left out', () => {
  const { rows } = readWeek([record({
    first: 'A', last: 'Linebacker', position: 'LB', fantasy: ['LB', 'DL'],
    stats: { rush_yd: 1 },
  })]);
  assert.deepEqual(rows, []);
});

test('each record carries its own update time, not the response\'s', () => {
  // Sleeper refreshes the current week and leaves later weeks on an older
  // vintage, so the age that matters is per record. Week 1 read as modified
  // 2026-09-09 while weeks 4, 8 and 14 all read as 2026-08-29, inside the same
  // fetch.
  const { rows } = readWeek([
    record({ first: 'Fresh', last: 'Player', position: 'QB', stats: { pass_yd: 200 }, modified: 1788924026259 }),
    record({ first: 'Stale', last: 'Player', position: 'QB', stats: { pass_yd: 200 }, modified: 1788000000000 }),
  ]);

  assert.equal(rows[0].modifiedAt, 1788924026259);
  assert.equal(rows[1].modifiedAt, 1788000000000);
});

test('a record with no name is dropped rather than keyed blank', () => {
  // A blank name would key every nameless record to the same row, which is the
  // same trap `inSeason.js` names for the board join.
  const { rows } = readWeek([record({
    first: undefined, last: undefined, position: 'QB', stats: { pass_yd: 200 },
  })]);
  assert.deepEqual(rows, []);
});

test('the first record for a player wins, so a duplicate cannot displace him', () => {
  const { byKey } = readWeek([
    record({ first: 'Josh', last: 'Allen', position: 'QB', stats: { pass_yd: 235.21 } }),
    record({ first: 'Josh', last: 'Allen', position: 'QB', stats: { pass_yd: 1 } }),
  ]);

  assert.equal(byKey.size, 1);
  assert.equal(byKey.get('josh allen|QB').components.passYd, 235.21);
});

test('nothing at all reads as an empty week rather than a crash', () => {
  assert.deepEqual(readWeek(null).rows, []);
  assert.deepEqual(readWeek([]).rows, []);
  assert.deepEqual(readWeek([null, undefined, {}]).rows, []);
});
