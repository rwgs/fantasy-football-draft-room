# Yahoo's league pages, as observed

Reference for what an ordinary Yahoo league page reads, outside a draft room,
written down because the draft protocol document covers only the room and
in-season advice needs everything the room never sends. Companion to
`yahoo-draft-protocol.md`, and the evidence behind Phase 7 in `ROADMAP.md`.

Everything here was watched happening on 2026-09-08, using `tools/yahoo/`
against the repository owner's own league: 8 teams, one season in progress.
The league ID, the manager names and the guids are all real, so none of them
appear below. Field names and shapes do; values do not.

Each entry is marked **observed** where a response carried it, or **open**
where it has not been read yet. The distinction matters, because a field
assumed present is a feature that fails in week one.

**None of this is promised by Yahoo.** These are the endpoints their own web
pages call, not a published interface, and they can change in any deploy.

## The route

**Observed.** The league pages call `pub-api.fantasysports.yahoo.com` and two
siblings, `pub-api-ro` and `pub-api-rw`. The responses come back under a
`fantasy_content` envelope — the same envelope the official Fantasy Sports API
documents. So the browser route reaches the documented data model without
OAuth, because the browser attaches the session cookie itself.

That is the same arrangement the draft bridge already runs under, and it fits
the no-server-credentials rule for the same reason: the transport stays in the
browser, and only the parsed result would ever reach the service. Nothing here
requires the service to hold a cookie, a token or a crumb.

Two identifier shapes carry everything:

| Key | Shape | Where it came from |
| --- | --- | --- |
| League | `<game>.l.<league id>` | `league_key`, and the request path itself |
| Team | `<game>.l.<league id>.t.<team id>` | `team_key` on every team |
| User | an opaque `guid` | `users;use_login=1/profile` |

`<game>` was `470` for this season. It is the game code, not a constant, so it
changes every year and must be read rather than hard-coded — `game_code` and
`season` are both on the league object, which is what makes that possible.

## What one page read

**Observed.** Loading the league home page fired these, among a great deal of
advertising and image traffic that is not worth keeping:

| Endpoint | Carries |
| --- | --- |
| `/fantasy/v2/users;use_login=1/profile` | the signed-in user's `guid` |
| `/fantasy/v2/league/<league key>/teams;out=standings` | the league, and all teams |
| `/fantasy/v2/league/<league key>/teams;out=recommended_trade_partners` | Yahoo's own trade suggestions |
| `/fantasy/v3/getCrumb` | a CSRF crumb, which only writes would need |

The `;out=` suffix is the API's own sub-resource syntax, and the same path does
extend to sub-resources the pages never call. That is what closes the gap; see
below.

## Who you are

**Observed, and this is the important one.** `users;use_login=1/profile`
returns `user.guid`, and every team in the league carries
`managers[].manager.guid`. Matching one to the other establishes which team is
yours.

That matters because the draft adapter has no way to do this. Yahoo has no user
identifier separate from the seat in a draft room, so `server/src/platforms/yahoo/`
takes the team number out of the room URL and treats it as both who you are and
where you sit. Outside the room there is a real answer, and Y7.2's requirement
that own-team selection be established rather than inferred is met by this pair
of fields.

`manager` also carries `nickname`, `is_commissioner` and `felo_score`.
`is_current_login` was present and `false` on the team examined, so it is not a
reliable shortcut on its own.

## The league object

**Observed.** 38 fields. The ones in-season advice needs:

| Field | Why it matters |
| --- | --- |
| `season`, `game_code` | the game key, which changes yearly |
| `current_week`, `start_week`, `end_week` | which week advice is for |
| `matchup_week` | the week actually being played |
| `weekly_deadline` | when lineups lock |
| `num_teams`, `max_teams` | league shape |
| `scoring_type`, `scoring_label` | head-to-head, points, and so on |
| `roster_type` | how the roster is structured |
| `draft_status` | whether the draft has happened |
| `league_update_timestamp` | freshness, for a staleness policy |
| `is_pro_league`, `is_cash_league`, `is_plus_league` | league class |

Absent from this response, and needed: the scoring rules themselves and the
roster slots. `scoring_type` names the *kind* of scoring, not the points per
reception or per passing yard. Both come from the settings sub-resource
instead, below.

## Each team

**Observed.** Every team in the league, in one response:

`team_key`, `team_id`, `name`, `url`, `team_logos`,
`previous_season_team_rank`, `waiver_priority`, `number_of_moves`,
`number_of_trades`, `roster_adds`, `league_scoring_type`, `draft_position`,
`has_draft_grade`, `draft_grade`, `draft_recap_url`, `managers`,
`team_standings`.

`team_standings` holds `rank`, `outcome_totals`, `points_for` and
`points_against`.

So standings, waiver priority and transaction counts are all available for
every team without a second request. `waiver_priority` and `roster_adds` are
part of what waiver advice needs; the waiver *method* is not in this response
but is in the settings one, and the FAAB balance is in neither.

## The pages are not the limit

**Observed.** The pages that display settings, rosters and the player pool
fetch no JSON at all. Navigating to the league settings page and the players
page produced no new `pub-api` calls — both arrived as server-rendered HTML,
939 KB and 1.09 MB. The team page behaved the same way.

That looked like the end of the clean route, and it is not. The same API the
league page already calls answers its own sub-resources, which the pages simply
do not use. All three were asked for once, read-only, and all three returned
`200`:

| Sub-resource | Path |
| --- | --- |
| Settings | `/fantasy/v2/league/<league key>/settings` |
| Roster | `/fantasy/v2/team/<team key>/roster` |
| Players | `/fantasy/v2/league/<league key>/players;count=<n>` |

They return XML by default. **`?format=json` switches them to JSON**, under the
same `fantasy_content` envelope as everything else. So HTML parsing is not
needed anywhere, and it should not be built.

One shape quirk to know before writing a reader: a resource comes back as a
two-element array, not an object. `league[0]` is the metadata and
`league[1].settings` is the settings; `team[0]` is a 24-entry metadata list and
`team[1].roster` is the roster. It is the Fantasy API's long-standing JSON
translation of its XML, and a reader that indexes `[0]` and `[1]` by position
is doing the normal thing rather than the fragile thing.

## Settings

**Observed**, from `league[1].settings`. This is the response that ends the
scoring and roster-shape unknown that `importLeague` has carried since the
platform seam went in.

Roster slots came back as `roster_positions`, and for this league read:

    QB:1  RB:2  WR:2  TE:1  W/R/T:1  K:1  DEF:1  BN:8  IR:2

So the flex slot is named as a composite position, `W/R/T`, and bench and IR
are slots like any other. Scoring came back as `stat_categories` with 38
entries and `stat_modifiers` with 35 — the categories name what is counted and
the modifiers carry the points per unit, which together are the exact scoring
rules, not just `scoring_type`'s label for them.

The same response also carries what waiver and trade advice needs:
`waiver_type`, `waiver_rule`, `waiver_days`, `uses_faab`, `waiver_time`,
`trade_end_date`, `trade_ratify_type`, `trade_reject_time`, `player_pool`,
`cant_cut_list` and `post_draft_players`, plus `uses_fractional_points` and
`uses_negative_points`, and the playoff fields `playoff_start_week`,
`num_playoff_teams` and `has_multiweek_championship`.

## A roster

**Observed**, from `team[1].roster`. 17 players for the team read, each
carrying:

`player_key`, `player_id`, `name`, `editorial_team_key`,
`editorial_team_abbr`, `bye_weeks`, `is_keeper`, `uniform_number`,
`display_position`, `primary_position`, `position_type`, `eligible_positions`,
`eligible_positions_to_add`, `is_undroppable`, `headshot`, `has_player_notes`
and `player_notes_last_timestamp`.

Alongside those, `selected_position` — the slot the player is currently
started in. That pair, `eligible_positions` and `selected_position`, is exactly
what a legal-lineup check needs: what a player may fill, and what they fill
now. `bye_weeks` and `is_keeper` come free with it.

`editorial_team_abbr` is worth noting for identity: it is the same team
abbreviation `server/src/names.js` already joins defences on.

## Still open

Nothing below has been read, and none of it should be assumed:

- Player availability: free agent against waiver, and claim deadlines. The
  `players` sub-resource answered, but was asked only for a count of three and
  was not inspected for ownership or waiver state.
- The FAAB balance itself, as opposed to `uses_faab` saying a league has one.
- Whether `stat_modifiers` covers every case, including negative points and
  fractional scoring, when read against what Yahoo displays.
- Pagination, on any list endpoint. `players` takes a `count`; the page-through
  parameter has not been exercised.
- Weekly lock rules and kickoff times, and how `weekly_deadline` expresses them.
- Refresh behaviour and how stale a cached read may be. `refresh_rate` appears
  on every response as `30` and has not been tested against reality.
- Whether any of this differs in a keeper league, or one mid-playoffs.
- What happens to all of it when the season ends.

## What runs in the browser, and why it has to

**Decided and built.** Every read above worked because the browser attached its
own cookie. The service cannot make these calls and must not hold what would let
it, so something has to run on a Yahoo page. That something is
`userscript/league-reader.js`, a bookmarklet installed from `/league-reader`,
and `DECISIONS.md` for 2026-09-08 records why it is not a second userscript: the
draft bridge has to be one because it wraps `WebSocket` at `document-start`, and
this needs none of that.

It fetches the four resources, sends Yahoo's own JSON unread to the service, and
`server/src/platforms/yahoo/league.js` does all of the interpreting — so there
is one place to fix when Yahoo changes a shape rather than two.

One simplification worth recording, because it removes the only piece of
discovery the reader would otherwise need. The API wants `470.l.<league>` and
that leading number is the season's game code, which appears nowhere in a league
page's address. It does not have to be found: **`nfl.l.<league>` addresses the
same league in the current season's game**, checked against a real league rather
than assumed, and the numeric key comes back on the response. The limit is the
other side of the same coin — `nfl` means this season, so it cannot address a
past season's league.

The endpoint that would have discovered it properly,
`/users;use_login=1/games;game_keys=nfl/leagues`, hung rather than answering
every time it was tried. Worth knowing before reaching for it.

## Reproducing this

`.\capture.ps1` records it, the same tool the draft protocol was read with. It
attaches over the DevTools protocol and writes both websocket frames and HTTP
response bodies to `tools/yahoo/dump`, as they arrive.

That last part was a fix made during this study, and it is worth knowing about:
response bodies used to be held in memory and written only in an exit handler,
which on Windows a killed process never runs. Frames were already appended
live; responses were not. Every capture before 2026-09-08 therefore has frames
and no responses at all, which cost nothing while the question was the draft
socket and would have cost this entire study. If a capture produces a
`frames-*.jsonl` and no `responses-*.jsonl`, that is the old behaviour and the
tool is out of date.
