// Joining a Yahoo league snapshot to the pool and to the board.
//
//   npm --prefix server test
//
// Two joins with two different failure modes, so two sets of checks. The join
// to Yahoo's own pool is exact and its only interesting case is a miss; the join
// to the cross-source board goes through `names.js` and every disagreement
// between the sources shows up in it.
//
// The fixtures are synthetic. The shapes are copied from what was actually read
// — the 21-slot vocabulary with its four composites, a `470.p.<id>` player key
// on both Yahoo scopes, a league slot list with a composite flex in it — and the
// people are invented, except where a real disagreement is the thing under test:
// "Chris Godwin Jr." against "Chris Godwin" is the one name mismatch class
// discovery observed between Yahoo and Sleeper, so it is checked by name.
//
// Nothing here reaches the network or the filesystem.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { joinLeague, resolveSlots, slotAcceptance } from './inSeason.js';

/**
 * Yahoo's published slot vocabulary, as `readRosterPositions` returns it.
 *
 * Trimmed from 21 to the ones the checks need, with the shape kept exactly:
 * every position carries a `positionType` and `BN` and `IR` carry none, which
 * is what separates a slot that holds a position from one that holds anybody.
 */
const vocabulary = () => [
  { position: 'QB', abbreviation: 'QB', displayName: 'Quarterback', positionType: 'O' },
  { position: 'WR', abbreviation: 'WR', displayName: 'Wide Receiver', positionType: 'O' },
  { position: 'RB', abbreviation: 'RB', displayName: 'Running Back', positionType: 'O' },
  { position: 'TE', abbreviation: 'TE', displayName: 'Tight End', positionType: 'O' },
  { position: 'W/T', abbreviation: 'W/T', displayName: 'Wide Receiver/Tight End', positionType: 'O' },
  { position: 'W/R', abbreviation: 'W/R', displayName: 'Wide Receiver/Running Back', positionType: 'O' },
  {
    position: 'W/R/T',
    abbreviation: 'W/R/T',
    displayName: 'Wide Receiver/Running Back/Tight End',
    positionType: 'O',
  },
  {
    position: 'Q/W/R/T',
    abbreviation: 'Q/W/R/T',
    displayName: 'Quarterback/Wide Receiver/Running Back/Tight End',
    positionType: 'O',
  },
  { position: 'K', abbreviation: 'K', displayName: 'Kicker', positionType: 'K' },
  { position: 'DEF', abbreviation: 'DEF', displayName: 'Defense/Special Teams', positionType: 'DT' },
  { position: 'BN', abbreviation: 'BN', displayName: 'Bench', positionType: null },
  { position: 'IR', abbreviation: 'IR', displayName: 'Injured Reserve', positionType: null },
];

/** A league's own slots, as `readSlots` returns them. */
const slots = () => [
  { position: 'QB', count: 1, starting: true },
  { position: 'WR', count: 2, starting: true },
  { position: 'RB', count: 2, starting: true },
  { position: 'TE', count: 1, starting: true },
  { position: 'W/R/T', count: 1, starting: true },
  { position: 'DEF', count: 1, starting: true },
  { position: 'BN', count: 8, starting: false },
  { position: 'IR', count: 2, starting: false },
];

/** A rostered player, as `readSnapshot` returns one. */
const rostered = (over) => ({
  playerKey: '470.p.1',
  playerId: '1',
  name: 'Ada Halfback',
  team: 'DET',
  displayPosition: 'RB',
  primaryPosition: 'RB',
  positions: ['RB'],
  selectedPosition: 'RB',
  isFlex: false,
  byeWeek: 6,
  isKeeper: false,
  ...over,
});

/** A pool record, as `sources/yahooPlayers.js` returns one. */
const pooled = (over) => ({
  playerKey: '470.p.1',
  playerId: '1',
  name: 'Ada Halfback',
  team: 'DET',
  displayPosition: 'RB',
  positionType: 'O',
  positions: ['RB'],
  byeWeek: 6,
  status: null,
  statusFull: null,
  injuryNote: null,
  percentOwned: 100,
  percentOwnedDelta: 0,
  percentOwnedWeek: 1,
  ...over,
});

/** A board row, as `buildBoard` returns one. */
const boardRow = (over) => ({
  id: 'sl-1', key: 'ada halfback|RB', name: 'Ada Halfback', position: 'RB', team: 'DET',
  bye: 6, points: 210, ...over,
});

const snapshot = (over) => ({
  leagueKey: '470.l.111',
  leagueId: '111',
  slots: slots(),
  ownTeamKey: '470.l.111.t.3',
  rosters: [{ teamKey: '470.l.111.t.3', week: 3, editable: true, players: [rostered()] }],
  ...over,
});

// --- The slot vocabulary -----------------------------------------------------

test('a composite slot resolves to the positions its display name names', () => {
  const accepted = slotAcceptance(vocabulary());
  assert.deepEqual(accepted.get('W/R/T'), ['WR', 'RB', 'TE']);
  assert.deepEqual(accepted.get('Q/W/R/T'), ['QB', 'WR', 'RB', 'TE']);
  assert.deepEqual(accepted.get('W/T'), ['WR', 'TE']);
  assert.deepEqual(accepted.get('W/R'), ['WR', 'RB']);
});

test('a single position slot accepts itself', () => {
  const accepted = slotAcceptance(vocabulary());
  assert.deepEqual(accepted.get('QB'), ['QB']);
  assert.deepEqual(accepted.get('DEF'), ['DEF']);
});

/*
 * The check that says the vocabulary is being read rather than the slot's own
 * name being parsed. A letter table would answer `['X', 'Y']` here, or nothing.
 */
test('a composite is resolved from the vocabulary, not from its letters', () => {
  const list = [
    ...vocabulary(),
    { position: 'X/Y', abbreviation: 'X/Y', displayName: 'Wide Receiver/Tight End', positionType: 'O' },
  ];
  assert.deepEqual(slotAcceptance(list).get('X/Y'), ['WR', 'TE']);
});

test('a composite with no display name is left out rather than guessed at', () => {
  const list = vocabulary().map((slot) => (
    slot.position === 'W/R/T' ? { ...slot, displayName: null } : slot
  ));
  assert.equal(slotAcceptance(list).has('W/R/T'), false);
});

test('a composite naming a position the vocabulary does not hold is left out', () => {
  const list = [
    ...vocabulary(),
    { position: 'W/P', abbreviation: 'W/P', displayName: 'Wide Receiver/Punter', positionType: 'O' },
  ];
  assert.equal(slotAcceptance(list).has('W/P'), false);
});

test('bench and IR are not positions, so they accept no position', () => {
  const accepted = slotAcceptance(vocabulary());
  assert.equal(accepted.has('BN'), false);
  assert.equal(accepted.has('IR'), false);
});

test('a starting slot the vocabulary cannot explain is unresolved; a bench slot is not', () => {
  const resolved = resolveSlots(
    [...slots(), { position: 'OFF', count: 1, starting: true }],
    vocabulary(),
  );
  const by = (position) => resolved.find((slot) => slot.position === position);

  assert.equal(by('OFF').unresolved, true);
  assert.equal(by('OFF').accepts, null);
  // Bench takes anybody. Its absent eligible set is not a gap in what this app
  // knows, and calling it one would put every league in the state reserved for
  // a league it cannot read.
  assert.equal(by('BN').unresolved, false);
  assert.equal(by('BN').accepts, null);
  assert.equal(by('W/R/T').unresolved, false);

  assert.deepEqual(joinLeague({ snapshot: snapshot(), vocabulary: vocabulary() }).unresolvedSlots, []);
});

test('the league decides what starts, not the vocabulary', () => {
  const resolved = resolveSlots([{ position: 'TE', count: 1, starting: false }], vocabulary());
  assert.equal(resolved[0].starting, false);
  assert.deepEqual(resolved[0].accepts, ['TE']);
});

// --- The join to Yahoo's own pool --------------------------------------------

test("a rostered player joins Yahoo's pool on the whole player key", () => {
  const joined = joinLeague({
    snapshot: snapshot(), pool: [pooled({ status: 'Q', statusFull: 'Questionable' })], vocabulary: vocabulary(),
  });
  const player = joined.rosters[0].players[0];

  assert.equal(player.pool.status, 'Q');
  assert.equal(player.pool.percentOwned, 100);
  assert.deepEqual(joined.rosters[0].matched, { pool: 1, board: 0, of: 1 });
});

/*
 * The season guard. A Yahoo player id is stable across seasons and the game code
 * in front of it is not, so joining on the bare id would match last season's
 * record — a right-looking answer with the wrong team and the wrong bye on it.
 */
test('the same player id under another season does not join', () => {
  const joined = joinLeague({
    snapshot: snapshot(),
    pool: [pooled({ playerKey: '461.p.1', byeWeek: 11 })],
    vocabulary: vocabulary(),
  });

  assert.equal(joined.rosters[0].players[0].pool, null);
  assert.deepEqual(joined.rosters[0].unmatched.pool, ['Ada Halfback']);
});

test('a player the pool does not list keeps his place and is named', () => {
  const joined = joinLeague({ snapshot: snapshot(), pool: [], vocabulary: vocabulary() });

  assert.equal(joined.rosters[0].players.length, 1);
  assert.equal(joined.rosters[0].players[0].name, 'Ada Halfback');
  // Null, not an empty record. "Healthy" and "never found" are different
  // answers and a spread record cannot tell them apart.
  assert.equal(joined.rosters[0].players[0].pool, null);
  assert.deepEqual(joined.rosters[0].unmatched.pool, ['Ada Halfback']);
  assert.equal(joined.rosters[0].matched.pool, 0);
});

// --- The join to the cross-source board --------------------------------------

test('a generational suffix does not stop a board join', () => {
  const joined = joinLeague({
    snapshot: snapshot({
      rosters: [{
        players: [rostered({ name: 'Chris Godwin Jr.', positions: ['WR'], displayPosition: 'WR' })],
      }],
    }),
    board: [boardRow({ id: 'sl-9', key: 'chris godwin|WR', name: 'Chris Godwin', position: 'WR', team: 'TB' })],
    vocabulary: vocabulary(),
  });

  assert.equal(joined.rosters[0].players[0].board.name, 'Chris Godwin');
  assert.deepEqual(joined.rosters[0].unmatched.board, []);
});

test('a defence joins on its team, whatever either source calls it', () => {
  const joined = joinLeague({
    snapshot: snapshot({
      rosters: [{
        players: [rostered({
          playerKey: '470.p.100034', name: 'Texans', team: 'HOU',
          displayPosition: 'DEF', positions: ['DEF'], selectedPosition: 'DEF',
        })],
      }],
    }),
    board: [boardRow({ id: 'ffc-1', key: 'DEF|HOU', name: 'Houston Defense', position: 'DEF', team: 'HOU' })],
    vocabulary: vocabulary(),
  });

  assert.equal(joined.rosters[0].players[0].board.name, 'Houston Defense');
});

/*
 * Two positions in one record, which is the case the whole eligibility list is
 * kept for. Yahoo lists eight players this way; the board holds one position per
 * row and picks the other one. Trying only the first eligibility misses him.
 */
test('a player eligible at two positions keeps both and joins on either', () => {
  const joined = joinLeague({
    snapshot: snapshot({
      rosters: [{
        players: [rostered({
          name: 'Bo Twoways', displayPosition: 'WR,TE', primaryPosition: 'WR', positions: ['WR', 'TE'],
        })],
      }],
    }),
    board: [boardRow({ id: 'sl-2', key: 'bo twoways|TE', name: 'Bo Twoways', position: 'TE', team: 'DET' })],
    vocabulary: vocabulary(),
  });
  const player = joined.rosters[0].players[0];

  assert.deepEqual(player.positions, ['WR', 'TE']);
  assert.equal(player.board.position, 'TE');
  // And the eligibility reaches the slots, which is the point of keeping it:
  // both of his own positions' slots and the flex that takes either.
  assert.deepEqual(player.fills, ['WR', 'TE', 'W/R/T']);
});

test('a player no source can place stays visible on both joins', () => {
  const joined = joinLeague({
    snapshot: snapshot({ rosters: [{ players: [rostered({ name: 'Unheard Of' })] }] }),
    pool: [pooled({ playerKey: '470.p.999' })],
    board: [boardRow()],
    vocabulary: vocabulary(),
  });

  assert.equal(joined.rosters[0].players.length, 1);
  assert.equal(joined.rosters[0].players[0].pool, null);
  assert.equal(joined.rosters[0].players[0].board, null);
  assert.deepEqual(joined.rosters[0].unmatched, { pool: ['Unheard Of'], board: ['Unheard Of'] });
});

test('a nameless player who is not a defence is not joined to a nameless row', () => {
  const joined = joinLeague({
    snapshot: snapshot({
      rosters: [{ players: [rostered({ name: null, positions: ['WR'] })] }],
    }),
    board: [boardRow({ key: '|WR', name: '', position: 'WR' })],
    vocabulary: vocabulary(),
  });

  assert.equal(joined.rosters[0].players[0].board, null);
  assert.deepEqual(joined.rosters[0].unmatched.board, ['470.p.1']);
});

// --- What a snapshot with nothing fetched beside it reads as ------------------

test('a quarterback fills his own slot and no flex that will not take him', () => {
  const joined = joinLeague({
    snapshot: snapshot({
      rosters: [{
        players: [rostered({ name: 'Cal Passer', displayPosition: 'QB', positions: ['QB'] })],
      }],
    }),
    vocabulary: vocabulary(),
  });
  assert.deepEqual(joined.rosters[0].players[0].fills, ['QB']);
});

test('a snapshot joined against nothing reports every player unmatched', () => {
  const joined = joinLeague({ snapshot: snapshot() });

  assert.deepEqual(joined.rosters[0].matched, { pool: 0, board: 0, of: 1 });
  // And with no vocabulary, nothing about a slot is claimed either way: every
  // starting slot is unresolved because none of them has been explained.
  assert.deepEqual(joined.unresolvedSlots, ['QB', 'WR', 'RB', 'TE', 'W/R/T', 'DEF']);
  assert.deepEqual(joined.rosters[0].players[0].fills, []);
});

test('a snapshot whose rosters did not arrive has none, not one that is empty', () => {
  const joined = joinLeague({ snapshot: snapshot({ rosters: [] }), vocabulary: vocabulary() });
  assert.deepEqual(joined.rosters, []);
  assert.deepEqual(joined.matched, { pool: 0, board: 0, of: 0, rosters: 0 });
  assert.equal(joined.slots.length, 8);
});

// --- Every roster in the league ----------------------------------------------

test('every roster is joined, and the league totals are the sum of them', () => {
  const joined = joinLeague({
    snapshot: snapshot({
      rosters: [
        { teamKey: '470.l.111.t.3', players: [rostered()] },
        {
          teamKey: '470.l.111.t.4',
          players: [rostered({ playerKey: '470.p.2', playerId: '2', name: 'Bea Wideout', positions: ['WR'] })],
        },
      ],
    }),
    pool: [pooled()],
    board: [boardRow()],
    vocabulary: vocabulary(),
  });

  assert.equal(joined.rosters.length, 2);
  // One player joined both feeds and one joined neither, so the totals say two
  // of two rosters and one of two players rather than averaging anything.
  assert.deepEqual(joined.matched, { pool: 1, board: 1, of: 2, rosters: 2 });
  assert.deepEqual(joined.rosters[1].unmatched.pool, ['Bea Wideout']);
});

/*
 * The acceptance criterion this exists for: the own team is the one the guid
 * matched, not a position in a list. `readSnapshot` does the matching and this
 * carries it, so a league where the user is the fourth team reads correctly.
 */
test('the own roster is the one the guid matched, not the first in the list', () => {
  const joined = joinLeague({
    snapshot: snapshot({
      ownTeamKey: '470.l.111.t.4',
      rosters: [
        { teamKey: '470.l.111.t.3', players: [] },
        { teamKey: '470.l.111.t.4', players: [] },
      ],
    }),
    vocabulary: vocabulary(),
  });

  assert.deepEqual(joined.rosters.map((r) => r.own), [false, true]);
});

test('a league whose own team never resolved claims no roster as yours', () => {
  const joined = joinLeague({
    snapshot: snapshot({
      ownTeamKey: null,
      rosters: [{ teamKey: '470.l.111.t.3', players: [] }],
    }),
    vocabulary: vocabulary(),
  });

  assert.equal(joined.rosters[0].own, false);
});

test('there is no joining without a snapshot', () => {
  assert.throws(() => joinLeague({}), /no snapshot/);
});
