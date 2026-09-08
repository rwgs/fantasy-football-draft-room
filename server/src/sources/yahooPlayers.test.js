// Reading Yahoo's public game scope, and finding the end of one of its lists.
//
//   npm run server:test
//
// Nothing here touches the network. The fixtures copy the shape of a real
// response and none of its people: the two-part `game` resource, the
// index-keyed list, the metadata split into single-key objects with empty ones
// padding it, and — the one that only walking to the end of the pool finds —
// the bare `[]` that comes back past the last page.
//
// The pager is the reason this file exists. Its end condition counts the
// records it read, and reverting it to read the list's own `count` has to fail
// a check here rather than pass quietly: two of the fixtures below carry no
// usable `count`, which is exactly what the live feed does.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectPlayers,
  readGameWeeks,
  readPlayers,
  readRosterPositions,
  readStatCategories,
} from './yahooPlayers.js';

/**
 * One player, shaped as the pool shapes one.
 *
 * The empty entries are not padding invented for the test: a live record came
 * back with four of them among twenty-four fields.
 */
function player({
  id = 1, name = 'A Player', team = 'Det', position = 'RB', positions,
  status, statusFull, injuryNote, bye = '6', owned = { value: 100, delta: '0', week: 1 },
  key = `470.p.${id}`,
} = {}) {
  const meta = [
    ...(key === null ? [] : [{ player_key: key }]),
    { player_id: String(id) },
    { name: { full: name, first: 'A', last: 'Player' } },
    { editorial_team_abbr: team },
    {},
    { bye_weeks: { week: bye } },
    { display_position: position },
    {},
    { position_type: 'O' },
    { eligible_positions: (positions ?? [position]).map((p) => ({ position: p })) },
    {},
  ];
  // A status does not imply a note: the live pool carries a status on 1654
  // players and an `injury_note` on 549, so the two arrive independently.
  if (status !== undefined) meta.push({ status }, { status_full: statusFull ?? status });
  if (injuryNote !== undefined) meta.push({ injury_note: injuryNote });
  const sub = owned
    ? { percent_owned: [{ coverage_type: 'week', week: owned.week }, { value: owned.value }, { delta: owned.delta }] }
    : {};
  return { player: [meta, sub] };
}

/** A page of `players`: an index-keyed list with a `count` beside it. */
function poolPage(players) {
  const list = { count: players.length };
  players.forEach((entry, i) => { list[String(i)] = entry; });
  return { fantasy_content: { game: [{ game_key: '470' }, { players: list }] } };
}

/** Past the end of a list, Yahoo answers a bare array and no `count`. */
function pastTheEnd() {
  return { fantasy_content: { game: [{ game_key: '470' }, { players: [] }] } };
}

/** A reference list. These carry no `count` at all, which is what the feed does. */
function referencePage(name, entries) {
  const list = {};
  entries.forEach((entry, i) => { list[String(i)] = entry; });
  return { fantasy_content: { game: [{ game_key: '470' }, { [name]: list }] } };
}

function pool(size) {
  return Array.from({ length: size }, (_, i) => player({ id: i + 1, name: `Player ${i + 1}` }));
}

test('a short final page ends the walk', async () => {
  const all = pool(13);
  const asked = [];
  const out = await collectPlayers((start, count) => {
    asked.push([start, count]);
    return Promise.resolve(poolPage(all.slice(start, start + count)));
  }, { pageSize: 5 });

  assert.equal(out.length, 13);
  assert.deepEqual(asked, [[0, 5], [5, 5], [10, 5]]);
});

test('a pool ending on a full page stops at the empty array past it', async () => {
  const all = pool(10);
  const asked = [];
  const out = await collectPlayers((start, count) => {
    asked.push(start);
    const slice = all.slice(start, start + count);
    return Promise.resolve(slice.length ? poolPage(slice) : pastTheEnd());
  }, { pageSize: 5 });

  // The third ask is the one that answers `[]`. A pager reading the list's own
  // `count` would read `undefined` there, never stop, and run to the page bound.
  assert.equal(out.length, 10);
  assert.deepEqual(asked, [0, 5, 10]);
});

test('past the end, a bare array reads as no players rather than as a fault', () => {
  assert.deepEqual(readPlayers(pastTheEnd()), []);
});

test('a single full page that is the whole pool still asks once more', async () => {
  const asked = [];
  const out = await collectPlayers((start, count) => {
    asked.push(start);
    return Promise.resolve(start === 0 ? poolPage(pool(5)) : pastTheEnd());
  }, { pageSize: 5 });

  assert.equal(out.length, 5);
  assert.deepEqual(asked, [0, 5]);
});

test('a list that never ends is refused rather than walked forever', async () => {
  await assert.rejects(
    () => collectPlayers(
      (start, count) => Promise.resolve(poolPage(
        Array.from({ length: count }, (_, i) => player({ id: start + i })),
      )),
      { pageSize: 5 },
    ),
    /did not end after 40 pages/,
  );
});

test('a player with nothing reported reads as null, not as a missing field', () => {
  const [p] = readPlayers(poolPage([player({})]));

  assert.equal(p.status, null);
  assert.equal(p.statusFull, null);
  assert.equal(p.injuryNote, null);
});

test('and a status is carried through as the code Yahoo sent, not interpreted', () => {
  const [p] = readPlayers(poolPage([
    player({ status: 'Q', statusFull: 'Questionable', injuryNote: 'ankle' }),
  ]));

  assert.equal(p.status, 'Q');
  assert.equal(p.statusFull, 'Questionable');
  assert.equal(p.injuryNote, 'ankle');
});

test('an empty status is nothing reported too, not a code with no name', () => {
  const [p] = readPlayers(poolPage([player({ status: '' })]));

  assert.equal(p.status, null);
});

test('NA is carried through like any other code, since it is not an injury', () => {
  // 1280 of the 2888 in the live pool. It means unrostered, not hurt, so a
  // reader that folded the codes into one flag would be wrong for 44% of them.
  const [p] = readPlayers(poolPage([
    player({ status: 'NA', statusFull: "Inactive: Coach's Decision or Not on Roster" }),
  ]));

  assert.equal(p.status, 'NA');
  assert.equal(p.injuryNote, null);
});

test('the empty entries padding a player are skipped, not read as fields', () => {
  const [p] = readPlayers(poolPage([player({ name: 'Jahmyr Gibbs', bye: '6' })]));

  assert.equal(p.name, 'Jahmyr Gibbs');
  assert.equal(p.byeWeek, 6);
  assert.equal(p.displayPosition, 'RB');
  assert.equal(p.positionType, 'O');
});

test('a team abbreviation is upper-cased, since that is what a defence joins on', () => {
  const [p] = readPlayers(poolPage([player({ team: 'Det' })]));

  assert.equal(p.team, 'DET');
});

test('every eligible position is kept, not just the one he is filed at', () => {
  const [p] = readPlayers(poolPage([player({ position: 'WR', positions: ['WR', 'RB'] })]));

  assert.deepEqual(p.positions, ['WR', 'RB']);
  assert.equal(p.displayPosition, 'WR');
});

test('ownership arrives with the weekly delta that makes it a signal', () => {
  const [p] = readPlayers(poolPage([
    player({ owned: { value: 47, delta: '-3', week: 4 } }),
  ]));

  assert.equal(p.percentOwned, 47);
  assert.equal(p.percentOwnedDelta, -3);
  assert.equal(p.percentOwnedWeek, 4);
});

test('a player the feed gave no ownership for is unowned-unknown, not zero', () => {
  const [p] = readPlayers(poolPage([player({ owned: null })]));

  assert.equal(p.percentOwned, null);
  assert.equal(p.percentOwnedDelta, null);
});

test('a player with no key is refused rather than read as anonymous', () => {
  assert.throws(() => readPlayers(poolPage([player({ key: null })])), /No player_key in a player/);
});

test('a body with no game resource is refused', () => {
  assert.throws(() => readPlayers({}), /No game in the players response/);
});

test('a game that is not a two-part resource is refused, not read as empty', () => {
  assert.throws(
    () => readPlayers({ fantasy_content: { game: { players: {} } } }),
    /Expected a two-part players resource/,
  );
});

test('a game resource missing the half that was asked for is refused', () => {
  assert.throws(
    () => readPlayers({ fantasy_content: { game: [{ game_key: '470' }, { teams: {} }] } }),
    /No players in the second half/,
  );
});

test('the slot vocabulary reads whole, though its list carries no count at all', () => {
  const out = readRosterPositions(referencePage('roster_positions', [
    { roster_position: { position: 'QB', abbreviation: 'QB', display_name: 'Quarterback', position_type: 'O' } },
    { roster_position: { position: 'W/R/T', abbreviation: 'W/R/T', display_name: 'WR/RB/TE', position_type: 'O' } },
    { roster_position: { position: 'BN', display_name: 'Bench' } },
  ]));

  assert.equal(out.length, 3);
  assert.deepEqual(out.map((slot) => slot.position), ['QB', 'W/R/T', 'BN']);
  // The composite is what a league's flex slot has to be resolved against.
  assert.equal(out[1].displayName, 'WR/RB/TE');
  assert.equal(out[2].abbreviation, null);
});

test('the stat vocabulary reads through the extra level its response adds', () => {
  const list = {};
  [
    { stat_id: 0, name: 'Games Played', display_name: 'GP', position_types: [{ position_type: 'O' }, { position_type: 'K' }] },
    { stat_id: 4, name: 'Passing Yards', display_name: 'Pass Yds' },
  ].forEach((stat, i) => { list[String(i)] = { stat }; });
  const body = { fantasy_content: { game: [{ game_key: '470' }, { stat_categories: { stats: list } }] } };

  const out = readStatCategories(body);

  assert.deepEqual(out.map((stat) => stat.statId), ['0', '4']);
  assert.deepEqual(out[0].positionTypes, ['O', 'K']);
  assert.deepEqual(out[1].positionTypes, []);
});

test('a stat id of zero survives, since it is a real id and not a missing one', () => {
  const list = { 0: { stat: { stat_id: 0, name: 'Games Played' } } };
  const body = { fantasy_content: { game: [{ game_key: '470' }, { stat_categories: { stats: list } }] } };

  assert.deepEqual(readStatCategories(body).map((stat) => stat.statId), ['0']);
});

test('week boundaries read as numbers with their dates', () => {
  const out = readGameWeeks(referencePage('game_weeks', [
    { game_week: { week: '1', display_name: '1', start: '2026-09-09', end: '2026-09-14', current: '2026-09-09' } },
    { game_week: { week: '18', display_name: '18', start: '2027-01-05', end: '2027-01-10' } },
  ]));

  assert.deepEqual(out.map((week) => week.week), [1, 18]);
  assert.equal(out[0].start, '2026-09-09');
  assert.equal(out[1].current, null);
});
