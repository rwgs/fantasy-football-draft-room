// The one vocabulary three readers join on.
//
//   npm --prefix server test
//
// This exists because of how the failure looks rather than how likely it is. A
// source module naming `passYds` where the scoring table says `passYd` scores
// every quarterback in the league at zero for passing, which is
// indistinguishable from a league that does not score passing -- and both feeds
// spell every component differently from each other anyway, so there is no
// natural spelling for the mistake to violate.
//
// So the mappings are checked when their modules load, and these are the checks
// on the checker.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMPONENTS, SCOREABLE_POSITIONS, checkComponents, isComponent,
} from './components.js';

test('a mapping naming an unknown component is refused, and says which file', () => {
  assert.throws(
    () => checkComponents(['passYd', 'passYds'], 'sources/somewhere.js'),
    (err) => {
      assert.match(err.message, /sources\/somewhere\.js/);
      assert.match(err.message, /passYds/);
      // The message has to say where to fix it. "Unknown component" alone
      // sends the reader looking in the wrong file.
      assert.match(err.message, /COMPONENTS in sources\/components\.js/);
      return true;
    },
  );
});

test('and it names every wrong one, not just the first', () => {
  assert.throws(
    () => checkComponents(['nope', 'passYd', 'alsoNope'], 'x'),
    /nope, alsoNope/,
  );
});

test('a mapping that is entirely known passes and returns its input', () => {
  assert.deepEqual(checkComponents(['passYd', 'rec'], 'x'), ['passYd', 'rec']);
  assert.deepEqual(checkComponents([], 'x'), []);
});

test('both source mappings are checked when they load, not when they are read', () => {
  // The point of loading them here: an import that throws is a service that
  // will not start, which is a far better failure than a position that scores
  // nothing and explains nothing. If either mapping drifts, this test file
  // cannot even be imported.
  assert.doesNotThrow(async () => {
    await import('./sleeperProjections.js');
    await import('./espnProjections.js');
  });
});

test('the vocabulary is frozen, so nothing can widen it at runtime', () => {
  // A component added by a caller would be a component nothing verified.
  assert.ok(Object.isFrozen(COMPONENTS));
  assert.throws(() => { COMPONENTS.push('inventedYd'); });
  assert.ok(!isComponent('inventedYd'));
});

test('the positions this vocabulary can add up are exactly the four with components', () => {
  // Tied to the list rather than asserted beside it: if a kicker's or a
  // defence's components are ever verified and added, this fails and points at
  // the position set that has to change with them.
  assert.deepEqual([...SCOREABLE_POSITIONS].sort(), ['QB', 'RB', 'TE', 'WR']);
  assert.ok(!SCOREABLE_POSITIONS.has('K'));
  assert.ok(!SCOREABLE_POSITIONS.has('DEF'));
  assert.ok(Object.isFrozen(SCOREABLE_POSITIONS));
});

test('every component is verified against a published total by some check', () => {
  // Not a tautology: it is the list of what Y9.0 reproduced against each feed's
  // own points, and this asserts the vocabulary has not quietly grown past it.
  // Adding a component means adding the reading that verifies it -- which for
  // kickers and team defences could not be done, and is why neither is here.
  assert.deepEqual([...COMPONENTS].sort(), [
    'fumLost',
    'kickReturnTd',
    'pass2pt',
    'passInt',
    'passTd',
    'passYd',
    'puntReturnTd',
    'rec',
    'rec2pt',
    'recTd',
    'recYd',
    'rush2pt',
    'rushTd',
    'rushYd',
  ]);
});
