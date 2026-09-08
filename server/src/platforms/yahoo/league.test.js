// Reading Yahoo's own JSON into a league snapshot.
//
//   npm --prefix server test
//
// No endpoint can show this, because what is being tested is the reading of a
// shape rather than the answer to a request. Yahoo's JSON is a translation of
// its XML and puts a resource in a two-element array, a list in an object keyed
// by stringified index, and an object's fields in an array of single-key
// objects padded with empty ones. Every check below is one of those habits.
//
// The fixture is synthetic and deliberately so: the real thing was read from a
// real league and names real people, so it stays out of the repository. What is
// copied faithfully from it is the shape, including the awkward parts — the
// composite flex slot, a scoring category with no modifier against it, and a
// metadata block that is one plain object where the others are split up.
//
// Nothing here reaches the network or the filesystem.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readSnapshot } from './league.js';

/** Yahoo's list: keyed by stringified index, with a count beside it. */
const list = (items) => {
  const out = { count: items.length };
  items.forEach((item, i) => { out[String(i)] = item; });
  return out;
};

const settingsResponse = () => ({
  fantasy_content: {
    league: [
      {
        league_key: '470.l.111', league_id: '111', name: 'A League', game_code: 'nfl',
        season: '2026', num_teams: 8, scoring_type: 'head', current_week: 3,
        start_week: '1', end_week: '18', matchup_week: 3, weekly_deadline: '',
      },
      {
        settings: [{
          roster_positions: [
            { roster_position: { position: 'QB', count: 1, is_starting_position: 1 } },
            { roster_position: { position: 'W/R/T', count: 1, is_starting_position: 1 } },
            { roster_position: { position: 'BN', count: 5, is_starting_position: 0 } },
          ],
          stat_categories: {
            stats: [
              { stat: { stat_id: 4, name: 'Passing Yards', abbr: 'Yds', group: 'passing', enabled: '1' } },
              { stat: { stat_id: 5, name: 'Passing TD', abbr: 'TD', group: 'passing', enabled: '1' } },
              { stat: { stat_id: 9, name: 'Counted But Unscored', abbr: 'X', group: 'misc', enabled: '1' } },
            ],
          },
          stat_modifiers: {
            stats: [
              { stat: { stat_id: 4, value: '0.04' } },
              { stat: { stat_id: 5, value: '4' } },
            ],
          },
          waiver_type: 'WR', waiver_rule: 'continuous', uses_faab: '0',
          trade_end_date: '2026-11-28', trade_ratify_type: 'none',
        }],
      },
    ],
  },
});

const teamsResponse = () => ({
  fantasy_content: {
    league: [
      { league_key: '470.l.111' },
      {
        teams: list([
          {
            team: [
              [
                { team_key: '470.l.111.t.1' }, { team_id: '1' }, {},
                { name: 'First' }, { waiver_priority: 4 },
                { managers: [{ manager: { manager_id: '1', nickname: 'Someone', guid: 'GUID-OTHER' } }] },
              ],
            ],
          },
          {
            team: [
              [
                { team_key: '470.l.111.t.7' }, { team_id: '7' },
                { name: 'Mine' }, { waiver_priority: 2 },
                { managers: [{ manager: { manager_id: '7', nickname: 'Me', guid: 'GUID-MINE' } }] },
              ],
            ],
          },
        ]),
      },
    ],
  },
});

const rosterResponse = (teamKey = '470.l.111.t.7') => ({
  fantasy_content: {
    team: [
      [{ team_key: teamKey }],
      {
        roster: {
          coverage_type: 'week', week: 3, is_editable: 1,
          0: {
            players: list([
              {
                player: [
                  [
                    { player_key: '470.p.1' }, { player_id: '1' },
                    { name: { full: 'A Quarterback' } }, {},
                    { editorial_team_abbr: 'Phi' }, { bye_weeks: { week: '10' } },
                    { is_keeper: { status: false, cost: false, kept: false } },
                    { display_position: 'QB' }, { primary_position: 'QB' },
                    { eligible_positions: [{ position: 'QB' }] },
                  ],
                  { selected_position: [{ coverage_type: 'week', week: '3' }, { position: 'QB' }, { is_flex: 0 }] },
                  { is_editable: 1 },
                ],
              },
              {
                player: [
                  [
                    { player_key: '470.p.2' }, { player_id: '2' },
                    { name: { full: 'A Flex Body' } },
                    { editorial_team_abbr: 'kc' }, { bye_weeks: { week: '6' } },
                    { is_keeper: { status: true, cost: false, kept: true } },
                    { display_position: 'RB' }, { primary_position: 'RB' },
                    { eligible_positions: [{ position: 'RB' }, { position: 'W/R/T' }] },
                  ],
                  { selected_position: [{ coverage_type: 'week', week: '3' }, { position: 'W/R/T' }, { is_flex: 1 }] },
                ],
              },
              {
                player: [
                  [
                    { player_key: '470.p.3' }, { player_id: '3' },
                    { name: { full: 'A Benched Body' } },
                    { editorial_team_abbr: 'NYG' },
                    { display_position: 'WR' }, { primary_position: 'WR' },
                    { eligible_positions: [{ position: 'WR' }] },
                  ],
                  { selected_position: [{ position: 'BN' }] },
                ],
              },
            ]),
          },
        },
      },
    ],
  },
});

/** The one metadata block that is a plain object rather than a split-up one. */
const profileResponse = () => ({
  fantasy_content: {
    users: { count: 1, 0: { user: [{ guid: 'GUID-MINE' }, { profile: { display_name: 'Me' } }] } },
  },
});

const full = () => readSnapshot({
  settings: settingsResponse(),
  teams: teamsResponse(),
  rosters: [rosterResponse()],
  profile: profileResponse(),
});

test('the league is read out of the first half of a two-part resource', () => {
  const snap = full();
  assert.equal(snap.leagueKey, '470.l.111');
  assert.equal(snap.season, '2026');
  assert.equal(snap.numTeams, 8);
  assert.equal(snap.week.current, 3);
  assert.equal(snap.week.end, 18);
});

test('the game code is read rather than assumed, because it changes every season', () => {
  assert.equal(full().gameCode, 'nfl');
});

test('a composite flex slot survives as one position', () => {
  const flex = full().slots.find((slot) => slot.position === 'W/R/T');
  assert.ok(flex, 'the flex slot should be there');
  assert.equal(flex.count, 1);
  assert.equal(flex.starting, true);
});

test('bench is a slot like any other, and is not a starting one', () => {
  const bench = full().slots.find((slot) => slot.position === 'BN');
  assert.equal(bench.count, 5);
  assert.equal(bench.starting, false);
});

test('scoring is the categories joined to the modifiers, not either alone', () => {
  const scoring = full().scoring;
  assert.equal(scoring.length, 3);
  assert.equal(scoring.find((s) => s.statId === '4').points, 0.04);
  assert.equal(scoring.find((s) => s.statId === '5').points, 4);
});

test('a category with no modifier is kept, and says so, rather than being dropped', () => {
  // A league that counts a stat at nothing is saying something different from a
  // league that does not count it, so the distinction is worth keeping.
  const unscored = full().scoring.find((s) => s.statId === '9');
  assert.ok(unscored, 'the unscored category should still be listed');
  assert.equal(unscored.points, null);
});

test('the roster carries what a player may fill and what they fill now', () => {
  const players = full().rosters[0].players;
  assert.equal(players.length, 3);
  const flexed = players.find((p) => p.playerKey === '470.p.2');
  assert.deepEqual(flexed.positions, ['RB', 'W/R/T']);
  assert.equal(flexed.selectedPosition, 'W/R/T');
  assert.equal(flexed.isFlex, true);
});

test('a benched player reads as benched rather than as unplaced', () => {
  const benched = full().rosters[0].players.find((p) => p.playerKey === '470.p.3');
  assert.equal(benched.selectedPosition, 'BN');
  assert.equal(benched.isFlex, false);
});

test('team abbreviations come back the way the rest of the project joins on them', () => {
  // Yahoo writes `Phi` and `kc`; `names.js` joins defences on `PHI` and `KC`.
  const teams = full().rosters[0].players.map((p) => p.team);
  assert.deepEqual(teams, ['PHI', 'KC', 'NYG']);
});

test('bye weeks and keeper status come through', () => {
  const players = full().rosters[0].players;
  assert.equal(players.find((p) => p.playerKey === '470.p.1').byeWeek, 10);
  assert.equal(players.find((p) => p.playerKey === '470.p.1').isKeeper, false);
  assert.equal(players.find((p) => p.playerKey === '470.p.2').isKeeper, true);
});

test('empty entries padding a metadata block are skipped, not read as fields', () => {
  // The real thing had three of them among twenty-four.
  assert.equal(full().rosters[0].players[0].name, 'A Quarterback');
});

test('the own team is found by guid, not by a seat number', () => {
  const snap = full();
  assert.equal(snap.ownGuid, 'GUID-MINE');
  assert.equal(snap.ownTeamKey, '470.l.111.t.7');
});

test('without a profile there is no own team, rather than a guessed one', () => {
  const snap = readSnapshot({ settings: settingsResponse(), teams: teamsResponse() });
  assert.equal(snap.ownGuid, null);
  assert.equal(snap.ownTeamKey, null);
});

test('a guid that matches nobody leaves the own team unresolved', () => {
  const profile = profileResponse();
  profile.fantasy_content.users['0'].user[0] = { guid: 'GUID-STRANGER' };
  const snap = readSnapshot({ settings: settingsResponse(), teams: teamsResponse(), profile });
  assert.equal(snap.ownTeamKey, null);
});

test('the parts that did not arrive are absent rather than empty', () => {
  const snap = readSnapshot({ settings: settingsResponse() });
  assert.deepEqual(snap.rosters, []);
  assert.deepEqual(snap.teams, []);
  // No rosters is not the same claim as a reader too old to send them.
  assert.equal(snap.readerBehind, false);
  // The settings still read, so a league whose rosters failed is still worth something.
  assert.equal(snap.slots.length, 3);
});

test('every roster the reader sent is read, each keeping its own team', () => {
  const snap = readSnapshot({
    settings: settingsResponse(),
    teams: teamsResponse(),
    rosters: [rosterResponse('470.l.111.t.7'), rosterResponse('470.l.111.t.2')],
    profile: profileResponse(),
  });
  assert.deepEqual(snap.rosters.map((r) => r.teamKey), ['470.l.111.t.7', '470.l.111.t.2']);
  assert.equal(snap.rosters[1].players.length, 3);
  assert.equal(snap.readerBehind, false);
});

/*
 * A bookmarklet cannot update itself -- its whole source sits in the address it
 * was dragged from -- so an old copy posting one roster under the older name is
 * the likeliest failure this reader has. It is read, and it is named, because a
 * league showing one roster out of eight otherwise looks like Yahoo failing.
 */
test('a reader too old to send every roster is read and named as behind', () => {
  const snap = readSnapshot({
    settings: settingsResponse(),
    teams: teamsResponse(),
    roster: rosterResponse(),
    profile: profileResponse(),
  });
  assert.equal(snap.rosters.length, 1);
  assert.equal(snap.rosters[0].players.length, 3);
  assert.equal(snap.readerBehind, true);
});

test('a snapshot with no settings at all is refused', () => {
  assert.throws(() => readSnapshot({}), /needs at least the league settings/);
});

test('a resource that is not a two-part array is refused, not read as empty', () => {
  // The failure this guards against: Yahoo changes the envelope, every lookup
  // returns undefined, and the snapshot arrives looking like a league with no
  // players and no rules in it, which is indistinguishable from a real answer.
  const settings = settingsResponse();
  settings.fantasy_content.league = { league_key: '470.l.111' };
  assert.throws(() => readSnapshot({ settings }), /two-part settings resource/);
});

test('a resource missing the half that was asked for is refused', () => {
  const settings = settingsResponse();
  settings.fantasy_content.league[1] = { something_else: {} };
  assert.throws(() => readSnapshot({ settings }), /No settings in the second half/);
});
