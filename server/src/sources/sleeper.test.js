// Which position a Sleeper projection is filed at, and which one it is drafted at.
//
//   npm --prefix server test
//
// The board endpoint does show the result -- Travis Hunter's WR row either
// carries projected points or it does not -- but only while today's feed still
// calls him a DB. The rule is what needs checking, not this season's example,
// so the records here are written by hand and nothing reaches the network.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectionMap } from './sleeper.js';

/** One projection record, with only the fields the map reads. */
function record({ id = '1', first, last, position, fantasy, team = 'JAX', points = 100 }) {
  return {
    player_id: id,
    team,
    player: {
      first_name: first, last_name: last, position, fantasy_positions: fantasy,
    },
    stats: { pts_half_ppr: points, pts_ppr: points, gp: 17, adp_half_ppr: 50 },
  };
}

test('a player filed off the roster is drafted at his fantasy position', () => {
  const out = projectionMap([record({
    first: 'Travis', last: 'Hunter', position: 'DB', fantasy: ['DB', 'WR'], points: 83.1,
  })], 'half-ppr');

  assert.deepEqual([...out.keys()], ['travis hunter|WR']);
  assert.equal(out.get('travis hunter|WR').position, 'WR');
  assert.equal(out.get('travis hunter|WR').points, 83.1);
});

test('and a player with no fantasy position a roster can hold is still dropped', () => {
  const out = projectionMap([record({
    first: 'A', last: 'Linebacker', position: 'LB', fantasy: ['LB', 'DL'],
  })], 'half-ppr');

  assert.equal(out.size, 0);
});

test('the position he is filed at wins whenever a roster can hold it', () => {
  const out = projectionMap([record({
    first: 'A', last: 'Receiver', position: 'WR', fantasy: ['TE', 'WR'],
  })], 'half-ppr');

  assert.deepEqual([...out.keys()], ['a receiver|WR']);
});

test('a record naming no position at all is dropped rather than keyed empty', () => {
  const out = projectionMap([record({
    first: 'A', last: 'Nobody', position: undefined, fantasy: undefined,
  })], 'half-ppr');

  assert.equal(out.size, 0);
});
