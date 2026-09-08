# Yahoo's league pages, as observed

Reference for what an ordinary Yahoo league page reads, outside a draft room,
written down because the draft protocol document covers only the room and
in-season advice needs everything the room never sends. Companion to
`yahoo-draft-protocol.md`, and the evidence behind Phase 7 in `ROADMAP.md`.

Everything here was read on 2026-09-08. The league-scope half was watched
happening with `tools/yahoo/`, in the repository owner's own signed-in browser,
against their league: 8 teams, one season in progress. The game-scope half
needed no browser and no account, and was read straight from a shell. The
league ID, the manager names and the guids are all real, so none of them appear
below. Field names, shapes and counts do; values do not.

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

## Two scopes, and only one needs you signed in

**Observed, 2026-09-08, and it is the most useful thing in this document.** The
API has two scopes and they do not authenticate alike:

| Scope | Path begins | Signed in? |
| --- | --- | --- |
| League | `/fantasy/v2/league/<league key>/…` | **required** |
| Game | `/fantasy/v2/game/nfl/…` | **not required** |

Asked with no cookie at all, from a shell rather than a browser, every league
path answered `401` with `"You must be logged in to view this league."` Every
game path answered `200`. Both were checked against the same real league and
the same season in the same minute, so the difference is the scope and not the
weather.

That splits the in-season problem in two, and the halves have different costs:

- **Anything about *your* league** — its settings, its teams, its rosters, who
  owns whom — is behind the cookie. Only the browser can ask, which is what
  `userscript/league-reader.js` exists for.
- **Anything about *players in general*** — the pool, ownership percentages,
  injuries, byes, ADP, the stat vocabulary, week dates — is public. The service
  can fetch it directly, cache it, and never involve the browser at all, the
  same way it already fetches Fantasy Football Calculator and Sleeper.

**No decision is taken here.** Whether the service should fetch the game scope
itself is Y7.4's to settle, and it touches the architecture boundary, so it is
recorded as available rather than acted on. What it removes is the assumption
this study began with: that in-season advice needs a browser read for
everything. It needs one for the league, and for nothing else.

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

## The player pool, and the reference lists behind it

**Observed, 2026-09-08, all without a cookie.** `/game/nfl/players` answers the
pool, and four reference resources answer the vocabularies it is written in.

`players` carries 21 fields per player, arriving as 24 metadata entries — the
three spare ones are the empty padding `league.js` documents. Scanned across
300 players rather than the two a sample would have shown:

| Field | On how many | Note |
| --- | --- | --- |
| `player_key`, `player_id`, `name`, `url` | 300/300 | identity |
| `editorial_team_abbr`, `editorial_team_key`, `editorial_team_full_name` | 300/300 | the abbreviation `names.js` joins defences on |
| `display_position`, `position_type`, `eligible_positions` | 300/300 | what they may fill |
| `eligible_positions_to_add`, `is_undroppable`, `is_keeper` | 300/300 | transaction legality |
| `bye_weeks` | 300/300 | byes, for every player, free |
| `status`, `status_full` | **60/300** | only when something is wrong |
| `injury_note` | **58/300** in this sample, 549/2888 in the pool | only when there is a note to give |
| `has_player_notes` | 298/300 | |
| `player_notes_last_timestamp` | 204/300 | |
| `has_recent_player_notes` | 31/300 | |
| `linked_player` | 1/300 | rare enough to be a surprise later |

**The status fields are the trap.** They are absent when there is nothing to
report, not present-and-empty, so a reader that indexes `status` and expects a
value sees `undefined` and cannot tell that from a shape change. Absence has to
be written down as meaning nothing is reported.

**Corrected 2026-09-08, while building Y8.1, by reading all 2888 rather than
the first 300.** The sample figures above are a top-300 artifact and the whole
pool is a different picture — and, more importantly, `status` is **not** an
injury field. Nine codes appear, and three are nothing to do with fitness:

| Code | `status_full` | In the pool |
| --- | --- | --- |
| — | nothing reported | 1234 |
| `NA` | Inactive: Coach's Decision or Not on Roster | **1280** |
| `Q` | Questionable | 157 |
| `IR` | Injured Reserve | 133 |
| `IR-R` | Injured Reserve - Designated for Return | 39 |
| `PUP-R` | Physically Unable to Perform (Regular Season) | 26 |
| `SUSP` | Suspended | 7 |
| `NFI-R` | Non-Football Injury (Reserve) | 5 |
| `O` | Out | 4 |
| `CEL` | Reserve: Commissioner Exempt List | 3 |

`NA` alone is 44% of the pool and means unrostered, not hurt, so a reader that
folds `status` into one "injured" flag is wrong for nearly half of it. `NFI-R`
and `SUSP` were not in the top-300 sample at all. Among the 721 players owned
in 1% of leagues or more the shape is the one the sample suggested — 544 carry
nothing, 85 are `Q` — which is why sampling the top of the pool was misleading
rather than merely incomplete. `injury_note` is on 549 of 2888, and a status
does not imply a note: 1654 carry a status and only 549 a note.

`percent_owned` is the other correction. It came back on 300 of 300 in the
sample and on **721 of 2888** across the pool, so ownership is reported for
roughly the rostered quarter and absent below it. Absent is not zero, and a
reader has to keep the two apart.

Three sub-resources hang off the same path via `;out=`, comma-separated for
more than one:

| `;out=` | Answers | Public? |
| --- | --- | --- |
| `percent_owned` | `{coverage_type: week, week: N}`, `value`, `delta` | yes, **721/2888** — see the correction above |
| `draft_analysis` | `average_pick`, `average_round`, `average_cost`, `percent_drafted`, and a `preseason_` variant of each | yes |
| `ownership` | who holds the player **in a league** | no — `[]` at game scope |

`percent_owned` is worth naming twice: it is scoped to a week and it carries a
`delta`. An ownership percentage that is moving is the signal waiver advice
actually wants, and it costs no cookie. It came back for every player in the
top-300 sample and for 721 of the full 2888, so it covers the part of the pool
anybody owns and goes quiet below that.
`draft_analysis` is a second ADP source alongside Fantasy Football Calculator,
mentioned because it exists and not because anything should switch to it.

`ownership` returning an empty array at game scope is the same boundary from
the other side: who owns a player is a fact about a league, so it needs one.

### Pagination, and what the end looks like

**Observed.** `;start=<n>;count=<m>` pages the list, and `start` shifts the
window as expected. `count` is not capped at the 25 the official API documents:
`count=500` returned 500 players in one response.

The pool was **2888 players** on the day. Walking to the end showed three
distinct behaviours, and the third is a shape change:

| Ask | Answer |
| --- | --- |
| `start=2850;count=25` | `count: 25` — a full page |
| `start=2875;count=25` | `count: 13` — a short page, so this is the last one |
| `start=2900;count=25` | `players: []` — **an empty array, not an object** |

Everywhere else in this API a list is an object keyed by index with a `count`
beside it. Past the end it is a bare `[]`. A pager that reads `.count` off it
gets `undefined` rather than zero, so the loop's end condition has to accept
both shapes. That is the kind of thing only walking to the end finds.

### The vocabularies

**Observed**, and they change what the settings response has to be read
against:

| Resource | Holds |
| --- | --- |
| `/game/nfl/stat_categories` | 108 stats, ids 0-107, each with `name`, `display_name` and the `position_types` it applies to |
| `/game/nfl/roster_positions` | 21 slots, with `display_name` and `position_type` |
| `/game/nfl/position_types` | 5: `O`, `K`, `OT`, `DT`, `DP` |
| `/game/nfl/game_weeks` | 18 weeks, each with `start`, `end` and `current` dates |

`roster_positions` settles something this project had written down as unknowable:
**the flex vocabulary is published.** All 21 slots are enumerated, and the four
composites among them are `W/T`, `W/R`, `W/R/T` and `Q/W/R/T`. So a flex slot's
eligible set can be read from a list rather than parsed out of a slash-separated
string, which is what weekly lineup advice needs and what
`server/src/platforms/yahoo/league.js` said was guesswork.

**How, since no entry carries an eligible-set field.** Every slot holds
`position`, `abbreviation`, `display_name` and `position_type` and nothing else.
A composite's display name is the single positions' display names joined by a
slash — `W/R/T` is "Wide Receiver/Running Back/Tight End" — so each part is
looked up in the same list, and the vocabulary explains itself without a letter
table deciding that `W` means a receiver. `position_type` is the other
load-bearing field: it is present on every position and absent on `BN` and `IR`,
which is what stops a bench slot resolving to a position called `BN`.
`server/src/platforms/yahoo/inSeason.js` does this reading.

`league.js`'s own decision is unaffected and still right: it separates starters
from bench on `is_starting_position` rather than on the position's name, which
stays the sturdier reading whether or not the names are enumerable.

`game_weeks` gives week 1 as 2026-09-09 to 2026-09-14, and week 18 as
2027-01-05 to 2027-01-10. That is week *boundaries*, which is not the same as
lineup locks: it says which dates belong to which week, not when an individual
game kicks off, and the owner's league carried `weekly_deadline: null`. Locks
remain open below.

### Stats come back raw, not as points

**Observed.** `/player/<player key>/stats` answers, with `;type=week;week=<n>`
for one week and nothing for the season. It returns `player_stats.stats` as a
list of `{stat_id, value}` pairs, and a season read also carries
`player_advanced_stats` with its own ids from 1001 up.

`stat_id` is the join key, and it is the same one the league's own
`stat_modifiers` use. So fantasy points are not a thing Yahoo hands over at
this scope — they are the product of a raw stat here and a modifier from the
league's settings, which is exactly why `scoring_type` was never enough and why
the settings sub-resource matters as much as it does. Anything computing points
needs both scopes: the public stat and the private modifier.

One honest limit on this reading: it was taken on 2026-09-08, before week 1
kicked off, so **every value was zero.** The shape is observed; the values are
not. Whether the numbers are right, and how quickly they land during a game,
cannot be known until a game has been played. Y7.3 owns that.

## Coverage, by what needs it

The audit, in one place. Every row marked observed traces to a response read on
2026-09-08 — either a capture under `tools/yahoo/dump` or a request made
directly while writing this. Rows are grouped by the feature that fails without
them, because a field's importance is not a property of the field.

`L` marks a league-scope read, which needs the signed-in browser. `G` marks
game scope, which needs nothing.

### Reading a league at all

| Needs | Source | Scope | State |
| --- | --- | --- | --- |
| Which league | league page address, `league_key` | L | observed |
| Which season's game | `nfl.l.<id>` addresses it; `game_code` and `season` come back | L | observed |
| Which team is yours | `users;use_login=1/profile` `guid` against `managers[].manager.guid` | L | **observed, and established rather than inferred** |
| Every team | `league/<key>/teams` | L | observed, 8 of 8 |
| League shape | `num_teams`, `max_teams`, `roster_type`, `draft_status` | L | observed |
| Which week | `current_week`, `matchup_week`, `start_week`, `end_week` | L | observed |
| Week dates | `game/nfl/game_weeks` | G | observed, 18 weeks |

### Scoring a lineup

| Needs | Source | Scope | State |
| --- | --- | --- | --- |
| Roster slots | `settings.roster_positions` | L | observed |
| Which slots start | `is_starting_position` per slot | L | observed |
| Flex eligibility | `game/nfl/roster_positions`, 4 composites | G | observed |
| Scoring rules | `stat_categories` joined to `stat_modifiers` on `stat_id` | L | observed, 38 against 35 |
| Stat names | `game/nfl/stat_categories`, 108 stats | G | observed |
| Player eligibility | `eligible_positions` per player | L and G | observed |
| Current lineup | `selected_position` on a roster | L | observed |
| Raw stat values | `player/<key>/stats`, `;type=week` | G | shape observed, **all values zero — nothing played yet** |
| Points per player | not served; must be computed from the two above | — | **not available, by design** |
| Negative and fractional points | `uses_negative_points`, `uses_fractional_points` | L | flags observed, effect unchecked |
| When a lineup locks | `weekly_deadline` | L | **open — `null` in the league read** |
| Per-game kickoff | not found at either scope | — | **open** |

### Waivers and adds

| Needs | Source | Scope | State |
| --- | --- | --- | --- |
| Waiver method | `waiver_type`, `waiver_rule`, `uses_faab`, `waiver_days`, `waiver_time` | L | observed |
| Waiver priority | `waiver_priority` per team | L | observed |
| Weekly adds used | `roster_adds` per team | L | observed |
| Transaction counts | `number_of_moves`, `number_of_trades` | L | observed |
| FAAB balance | not on any response seen | L | **open — needs a FAAB league** |
| Who owns a player | `;out=ownership` | L | **open — empty at game scope** |
| Free agent against waiver | `players;status=A` and siblings | L | **open** |
| Whether an add is legal now | `eligible_positions_to_add`, `is_undroppable`, `cant_cut_list` | L and G | fields observed, **rules unverified** |
| Ownership trend | `;out=percent_owned`, with `delta`, per week | G | observed, 721 of 2888 — absent below the rostered end, and absent is not zero |
| Pool depth | `players;start=;count=`, 2888 players | G | observed to the last page |

### Injuries, byes and availability to play

| Needs | Source | Scope | State |
| --- | --- | --- | --- |
| Bye week | `bye_weeks` | L and G | observed, every player |
| Injury status | `status`, `status_full` | G | observed, 1654 of 2888 — **but 1280 of those are `NA`, which is unrostered and not an injury** |
| Injury detail | `injury_note` | G | observed, 549 of 2888; a status does not imply a note |
| News | `has_player_notes`, `player_notes_last_timestamp`, `has_recent_player_notes` | G | observed; the notes themselves unread |

### Trades

| Needs | Source | Scope | State |
| --- | --- | --- | --- |
| Trade window | `trade_end_date`, `trade_ratify_type`, `trade_reject_time` | L | observed |
| Every roster to trade against | `team/<key>/roster` per team | L | **observed for own team only; the other seven unrequested** |
| Standings, to know who needs what | `team_standings`, `points_for`, `points_against` | L | observed |
| Yahoo's own suggestions | `teams;out=recommended_trade_partners` | L | observed to exist, contents unread |

### Freshness

| Needs | Source | Scope | State |
| --- | --- | --- | --- |
| How stale a read is | `league_update_timestamp` | L | observed |
| What Yahoo suggests | `@refresh_rate`, `30` on every response | L and G | observed, **never tested against reality** |

## Still open

Nothing below has been read, and none of it should be assumed. What is left is
now almost entirely league-scoped, which is to say it needs the signed-in
browser, or a league configured differently from the one available:

- **Availability in a league**: free agent against waiver against taken, and
  claim deadlines. The `status=A` filter and `;out=ownership` both need league
  scope, and `ownership` is empty without one. This is the largest gap and the
  one most features rest on.
- **The FAAB balance.** Settings say whether a league has one; no response seen
  carries the number. The league available uses waiver priority rather than
  FAAB, so this needs a differently configured league to answer at all.
- **Whether an unowned player is addable now.** Not the same question as
  availability, and not to be inferred from it.
- **League-scoped pagination.** Proven at game scope above, including the empty
  array past the end. Whether a league's own lists behave identically is
  untested, and `post_draft_players` may change what the list even contains.
- **Weekly lock rules and kickoff times.** `game_weeks` gives week boundaries,
  which is not a lock. `weekly_deadline` was `null` in the league read, so what
  a set value looks like is unseen, and per-game kickoff times were not found at
  any scope.
- **Whether `stat_modifiers` covers every case**, including negative and
  fractional points, read against what Yahoo displays. `uses_negative_points`
  and `uses_fractional_points` are present; their effect is unchecked.
- **Stat values, as opposed to stat shape.** Every number read was zero,
  because nothing had been played. Freshness during a game is unknown, and
  `refresh_rate` says `30` on every response with nothing yet testing that.
- **A keeper league, a league mid-playoffs, and a past season.** All three
  unread. The past season is known to be out of reach through the current
  route: `nfl.l.<id>` means this season by construction.
- **What happens to all of it when the season ends.**

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

The game scope needs nothing — no browser, no account, no tooling. Any of these
can be checked from a shell, and should be, because they are the rows this
document is most confident about:

    curl "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/roster_positions?format=json"
    curl "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/stat_categories?format=json"
    curl "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/game_weeks?format=json"
    curl "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/players;count=5;out=percent_owned,draft_analysis?format=json"

The league scope needs the browser, and `.\capture.ps1` records it — the same
tool the draft protocol was read with. It
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
