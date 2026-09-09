/**
 * A Yahoo league in season, as the browser reads it.
 *
 * The draft room and this are different problems. `room.js` follows frames on a
 * socket during a draft; this reads ordinary REST resources afterwards, and the
 * two share nothing but the platform they belong to. What they do have in common
 * is why they exist at all: every Yahoo *league* endpoint authenticates on the
 * browser's session cookie, so the service cannot ask and has to be told. That
 * is a property of the league scope and not of Yahoo — the game scope needs no
 * cookie and the service fetches it directly, in `sources/yahooPlayers.js`.
 * The league reader bookmarklet does the telling, exactly as the bridge does for
 * a draft. See `DECISIONS.md`, 2026-09-08, for why that is a bookmarklet.
 *
 * What arrives here is Yahoo's own JSON, unmodified, because the browser should
 * decide nothing. Every reading of a *league* happens in this file. The
 * dialect it is written in is read by `server/src/yahooJson.js`, which the
 * public game scope shares — see the note there on the shape.
 */

import { flatten, listOf, pick, subResource, teamAbbr, toNumber } from '../../yahooJson.js';

/**
 * The scoring rules, as points per unit.
 *
 * Two lists that have to be joined: `stat_categories` names what is counted and
 * `stat_modifiers` says what each one is worth. Neither is the scoring on its
 * own, which is the reason `scoring_type` — "head", "point" and so on — was
 * never enough to configure a board from. A category with no modifier scores
 * nothing and is kept anyway, because a league that counts a stat at zero is
 * saying something different from a league that does not count it.
 */
function readScoring(settings) {
  const categories = listOf(settings.stat_categories?.stats).map((entry) => entry.stat);
  const modifiers = new Map();
  for (const entry of listOf(settings.stat_modifiers?.stats)) {
    const stat = entry.stat;
    if (stat && stat.stat_id !== undefined) modifiers.set(String(stat.stat_id), toNumber(stat.value));
  }
  return categories
    .filter((stat) => stat && stat.stat_id !== undefined)
    .map((stat) => ({
      statId: String(stat.stat_id),
      name: stat.name ?? null,
      abbr: stat.abbr ?? null,
      group: stat.group ?? null,
      enabled: stat.enabled === '1' || stat.enabled === 1,
      points: modifiers.has(String(stat.stat_id)) ? modifiers.get(String(stat.stat_id)) : null,
    }));
}

/**
 * The roster shape.
 *
 * `is_starting_position` is what separates a slot you fill from bench and IR,
 * and it is carried through rather than inferred from the position's name: a
 * flex arrives as a composite like `W/R/T`, and a league says which of its own
 * slots start. Reading that off the strings instead would mean deciding what
 * `W/R/T` and `Q/W/R/T` are for, which is a different question from whether
 * this league starts them. Those names are enumerable, all 21 of them, from
 * `/game/nfl/roster_positions` — see `docs/yahoo-in-season-data.md` — and
 * `inSeason.js` turns a composite into the positions it accepts by looking each
 * part of its display name up in that same list. The list carries no
 * eligible-set field of its own; it explains itself. What starts still comes
 * from the league.
 */
function readSlots(settings) {
  return listOf(settings.roster_positions)
    .map((entry) => entry.roster_position ?? entry)
    .filter((slot) => slot && slot.position)
    .map((slot) => ({
      position: slot.position,
      count: toNumber(slot.count) ?? 0,
      starting: slot.is_starting_position === 1 || slot.is_starting_position === '1',
    }));
}

function readTeam(node) {
  const meta = flatten(node[0]);
  const managers = listOf(meta.managers)
    .map((entry) => entry.manager)
    .filter(Boolean)
    .map((manager) => ({ guid: manager.guid ?? null, nickname: manager.nickname ?? null }));
  return {
    teamKey: pick(meta, 'team_key', 'a team'),
    teamId: String(meta.team_id ?? ''),
    name: meta.name ?? null,
    waiverPriority: toNumber(meta.waiver_priority),
    moves: toNumber(meta.number_of_moves),
    trades: toNumber(meta.number_of_trades),
    managers,
  };
}

function readPlayer(node) {
  const meta = flatten(node[0]);
  const selected = flatten(node[1]?.selected_position);
  return {
    playerKey: pick(meta, 'player_key', 'a player'),
    playerId: String(meta.player_id ?? ''),
    name: meta.name?.full ?? null,
    team: teamAbbr(meta.editorial_team_abbr),
    displayPosition: meta.display_position ?? null,
    primaryPosition: meta.primary_position ?? null,
    positions: listOf(meta.eligible_positions).map((entry) => entry.position).filter(Boolean),
    // What the player is started in right now, against what they may fill. The
    // pair is the whole of a legal-lineup check.
    selectedPosition: selected.position ?? null,
    isFlex: selected.is_flex === 1 || selected.is_flex === '1',
    byeWeek: toNumber(meta.bye_weeks?.week),
    isKeeper: meta.is_keeper?.kept === true,
  };
}

/**
 * One team's roster, as `/team/<key>/roster` answers it.
 *
 * `week` matters as much as the players do: a roster is a lineup for a week,
 * and one read for last week is a different answer from one read for this week
 * rather than a staler version of the same answer.
 */
function readRoster(response) {
  const teamNode = pick(response.fantasy_content ?? {}, 'team', 'the roster response');
  const body = subResource(teamNode, 'roster');
  return {
    teamKey: flatten(teamNode[0]).team_key ?? null,
    week: toNumber(body.week),
    editable: body.is_editable === 1 || body.is_editable === '1',
    players: listOf(body['0']?.players).map((entry) => entry.player).filter(Boolean).map(readPlayer),
  };
}

/**
 * Turn what the browser read into one snapshot.
 *
 * Each part is optional except the settings, because the reader posts what it
 * managed to get and a league whose rosters failed is still worth showing. What
 * is not optional is honesty about which parts arrived, so anything missing is
 * `null` rather than an empty object that reads like an answer.
 */
export function readSnapshot({ settings, teams, rosters, roster, profile } = {}) {
  if (!settings) throw new Error('A snapshot needs at least the league settings.');

  const leagueNode = pick(settings.fantasy_content ?? {}, 'league', 'the settings response');
  const meta = Array.isArray(leagueNode) ? leagueNode[0] : leagueNode;
  const settingsBody = listOf(subResource(leagueNode, 'settings'))[0]
    ?? subResource(leagueNode, 'settings');

  const ownGuid = profile
    ? flatten(profile.fantasy_content?.users?.['0']?.user?.[0])?.guid ?? null
    : null;

  const teamList = teams
    ? listOf(subResource(pick(teams.fantasy_content ?? {}, 'league', 'the teams response'), 'teams'))
      .map((entry) => entry.team)
      .filter(Boolean)
      .map(readTeam)
    : [];

  // Which team is yours, answered rather than inferred. A draft room has no
  // identifier for a person separate from their seat, which is why the draft
  // adapter has to take the number out of the room URL; outside the room the
  // profile's guid appears against exactly one team's manager.
  const ownTeamKey = ownGuid
    ? teamList.find((team) => team.managers.some((m) => m.guid === ownGuid))?.teamKey ?? null
    : null;

  /*
   * A READER TOO OLD TO SEND EVERY ROSTER SENDS ONE, UNDER THE OLDER NAME.
   *
   * That case is read rather than refused, and it is not hypothetical. A
   * bookmarklet carries its whole source in its own address, so the copy on
   * somebody's bookmarks bar is a photograph taken when it was dragged and
   * cannot ever update itself — a stale reader is likelier here than a stale
   * userscript, not less. Left unhandled, an old copy would post `roster` and
   * this would report a league with no rosters in it at all, which looks like
   * Yahoo having failed rather than like a bookmark to re-drag.
   *
   * The shape it posted is the staleness signal, and it is a better one than a
   * build hash would be: it is the capability itself rather than a proxy for
   * it. The bridge needs a hash because a userscript can go stale without its
   * behaviour changing shape; if that ever becomes true here, this needs one too.
   */
  const posted = Array.isArray(rosters) ? rosters : (roster ? [roster] : []);
  const rostersOut = posted.filter(Boolean).map(readRoster);

  return {
    leagueKey: pick(meta, 'league_key', 'the league'),
    leagueId: String(meta.league_id ?? ''),
    name: meta.name ?? null,
    // Read, never assumed: the game code changes every season, so a snapshot
    // that hard-coded it would quietly read last year's league.
    gameCode: meta.game_code ?? null,
    season: String(meta.season ?? ''),
    numTeams: toNumber(meta.num_teams),
    scoringType: meta.scoring_type ?? null,
    week: {
      current: toNumber(meta.current_week),
      start: toNumber(meta.start_week),
      end: toNumber(meta.end_week),
      matchup: toNumber(meta.matchup_week),
      deadline: meta.weekly_deadline ?? null,
    },
    slots: readSlots(settingsBody),
    scoring: readScoring(settingsBody),
    waivers: {
      type: settingsBody.waiver_type ?? null,
      rule: settingsBody.waiver_rule ?? null,
      days: settingsBody.waiver_days ?? null,
      usesFaab: settingsBody.uses_faab === '1' || settingsBody.uses_faab === 1,
    },
    trades: {
      endDate: settingsBody.trade_end_date ?? null,
      ratifyType: settingsBody.trade_ratify_type ?? null,
    },
    ownGuid,
    ownTeamKey,
    teams: teamList,
    rosters: rostersOut,
    // Whether the copy of the reader that posted this can read every roster.
    // A screen showing one roster out of eight should say why rather than let
    // it read as a league with seven empty teams.
    readerBehind: !Array.isArray(rosters) && !!roster,
  };
}

/**
 * Snapshots kept at once.
 *
 * The same bound and the same reasoning as rooms: a person has a few leagues,
 * and any stranger who can reach this service can name a league ID, so the
 * number of them is fixed rather than left to grow.
 */
const MAX_SNAPSHOTS = 8;
const snapshots = new Map();

/**
 * Keep what a browser read for a league.
 *
 * Held in memory only, as rooms are. A snapshot is cheap to replace — one click
 * on the league page — so the cost of losing one to a restart is a click, where
 * losing a draft room mid-draft is the draft. That asymmetry is why this does
 * not reach for the disk cache the feeds use.
 */
export function putSnapshot(leagueId, posted) {
  const id = String(leagueId);
  const snapshot = readSnapshot(posted);

  // The reader takes the league out of the page it is run on and the route
  // takes it out of the address, so a mismatch means one of them is looking at
  // something the other is not. Refused rather than filed under the wrong key.
  const readId = String(snapshot.leagueId || '');
  if (readId && readId !== id) {
    throw new Error(`That snapshot is for league ${readId}, not ${id}.`);
  }

  const stored = { ...snapshot, readAt: Date.now() };
  snapshots.delete(id);
  snapshots.set(id, stored);
  while (snapshots.size > MAX_SNAPSHOTS) {
    snapshots.delete(snapshots.keys().next().value);
  }
  return stored;
}

/**
 * What was read for a league, or an answer saying nothing has been.
 *
 * "Not yet" rather than a refusal, for the same reason `roomState` gives one:
 * the app asks this before the user has clicked anything, which is the ordinary
 * course of events rather than a fault.
 */
export function getSnapshot(leagueId) {
  const stored = snapshots.get(String(leagueId));
  if (!stored) {
    return { read: false, snapshot: null, hint: 'Nothing has been read for this league yet.' };
  }
  return { read: true, snapshot: stored, heardAt: stored.readAt };
}

/**
 * Which leagues have been read, newest first.
 *
 * The way in to an in-season league, and the reason it exists is a mistake
 * worth recording. The screen first borrowed the app's *active* league, which
 * is a draft setting: a Yahoo league becomes active only when its draft
 * settings import, and importing them needs a room the bridge has posted. In
 * season there is no room, so the one case the screen was built for was the one
 * case it could not reach.
 *
 * So the reader is what says which league. Run the bookmarklet and the service
 * is holding a league; this is how the app finds out, without being told a
 * number and without anything borrowed from the draft.
 *
 * Enough to name a league on a button and no more. The rosters and the rules
 * are what `getSnapshot` is for, and a list that carried them would be every
 * held league's full contents answered to anyone who asked for a menu.
 */
export function listSnapshots() {
  return [...snapshots.values()]
    .map((held) => ({
      leagueId: held.leagueId,
      name: held.name,
      season: held.season,
      numTeams: held.numTeams,
      readAt: held.readAt,
    }))
    // Newest first. Insertion order is oldest first, because that is the end
    // the bound evicts from.
    .reverse();
}

/** Drop everything held. For tests, which must not inherit each other's state. */
export function forgetSnapshots() {
  snapshots.clear();
}
