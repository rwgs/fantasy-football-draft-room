/**
 * A Yahoo league in season, as the browser reads it.
 *
 * The draft room and this are different problems. `room.js` follows frames on a
 * socket during a draft; this reads ordinary REST resources afterwards, and the
 * two share nothing but the platform they belong to. What they do have in common
 * is why they exist at all: every Yahoo endpoint worth reading authenticates on
 * the browser's session cookie, so the service cannot ask and has to be told.
 * The league reader bookmarklet does the telling, exactly as the bridge does for
 * a draft. See `DECISIONS.md`, 2026-09-08, for why that is a bookmarklet.
 *
 * What arrives here is Yahoo's own JSON, unmodified, because the browser should
 * decide nothing. Every reading of it happens in this file.
 *
 * THE SHAPE, WHICH IS THE WHOLE DIFFICULTY
 *
 * Yahoo's JSON is a translation of its XML and carries the scars. Three habits
 * account for nearly all of the code below, and none is a mistake to be worked
 * around — they are simply what the format is:
 *
 *   1. A resource is a two-element array, not an object. `league[0]` holds the
 *      metadata and `league[1]` holds whichever sub-resource was asked for.
 *   2. A list is an object keyed by stringified index with a `count` beside it:
 *      `{ '0': {...}, '1': {...}, count: 2 }`, not an array.
 *   3. An object's fields arrive as an array of single-key objects, sometimes
 *      with empty ones padding it: `[{a: 1}, {}, {b: 2}]`.
 *
 * A reader that indexes `[0]` and `[1]` by position is doing the ordinary thing
 * here, not the fragile thing. What would be fragile is guessing, so `pick`
 * throws when the shape is not what it expects rather than returning undefined
 * and letting an empty snapshot look like a league with no players in it.
 */

/** A resource arrives as `[metadata, { <name>: … }]`. Take the named half. */
function subResource(node, name) {
  if (!Array.isArray(node) || node.length < 2) {
    throw new Error(`Expected a two-part ${name} resource, got ${describe(node)}.`);
  }
  const found = node[1]?.[name];
  if (found === undefined) throw new Error(`No ${name} in the second half of the resource.`);
  return found;
}

/** `{ '0': …, '1': …, count }` is Yahoo's array. Make it one. */
function listOf(node) {
  if (Array.isArray(node)) return node;
  if (!node || typeof node !== 'object') return [];
  const out = [];
  for (let i = 0; ; i += 1) {
    const at = node[String(i)];
    if (at === undefined) break;
    out.push(at);
  }
  return out;
}

/**
 * `[{a: 1}, {}, {b: 2}]` is Yahoo's object. Make it one.
 *
 * The empty entries are real: a player's metadata came back with three of them
 * among twenty-four fields. They carry nothing and are skipped rather than
 * treated as a fault.
 */
function flatten(parts) {
  // Not every metadata block is split up. A team's arrives as twenty-four
  // single-key objects; a user's arrives as one ordinary object holding the
  // guid. Both are "the metadata", so both are accepted, and the difference is
  // that a split one is a Yahoo list and therefore has a '0'.
  if (parts && typeof parts === 'object' && !Array.isArray(parts) && parts['0'] === undefined) {
    return { ...parts };
  }
  const out = {};
  for (const part of listOf(parts)) {
    if (!part || typeof part !== 'object') continue;
    Object.assign(out, part);
  }
  return out;
}

/** Read a field that has to be there, and say which one was missing when it is not. */
function pick(obj, key, where) {
  const value = obj?.[key];
  if (value === undefined || value === null) {
    throw new Error(`No ${key} in ${where}.`);
  }
  return value;
}

function describe(node) {
  if (node === null) return 'null';
  if (Array.isArray(node)) return `an array of ${node.length}`;
  return typeof node;
}

/** Yahoo writes team abbreviations as `Phi`; everything else here joins on `PHI`. */
function teamAbbr(value) {
  return typeof value === 'string' ? value.toUpperCase() : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
 * `/game/nfl/roster_positions` — see `docs/yahoo-in-season-data.md` — so a flex
 * slot's eligible set can be looked up when lineup advice needs it. What starts
 * still comes from the league.
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
 * Turn what the browser read into one snapshot.
 *
 * Each part is optional except the settings, because the reader posts what it
 * managed to get and a league whose roster failed is still worth showing. What
 * is not optional is honesty about which parts arrived, so anything missing is
 * `null` rather than an empty object that reads like an answer.
 */
export function readSnapshot({ settings, teams, roster, profile } = {}) {
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

  let rosterOut = null;
  if (roster) {
    const teamNode = pick(roster.fantasy_content ?? {}, 'team', 'the roster response');
    const body = subResource(teamNode, 'roster');
    rosterOut = {
      teamKey: flatten(teamNode[0]).team_key ?? null,
      week: toNumber(body.week),
      editable: body.is_editable === 1 || body.is_editable === '1',
      players: listOf(body['0']?.players).map((entry) => entry.player).filter(Boolean).map(readPlayer),
    };
  }

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
    roster: rosterOut,
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

/** Drop everything held. For tests, which must not inherit each other's state. */
export function forgetSnapshots() {
  snapshots.clear();
}
