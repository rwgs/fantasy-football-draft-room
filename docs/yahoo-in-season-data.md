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

The `;out=` suffix is the API's own sub-resource syntax, so the same path
should extend to other sub-resources. Whether it does is **open**; see below.

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
reception or per passing yard. See the gap below.

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
part of what waiver advice needs; the waiver *method* and any FAAB budget are
not in this response and remain **open**.

## The gap this study found

**Observed, and it is the finding that shapes Phase 8.** The pages that display
settings, rosters and the player pool do not fetch them as JSON. Navigating to
the league settings page and the players page produced no new `pub-api` calls
at all — both arrived as server-rendered HTML, 939 KB and 1.09 MB respectively.
The team page behaved the same way.

So the clean JSON route covers the league, the teams and the user, and stops
exactly where the scoring rules, the roster slots and the rosters themselves
begin. Those three are the inputs a legal-lineup check cannot do without.

Two ways forward, and the choice is not yet made:

1. **Ask the same API for the sub-resources the pages do not.**
   `/fantasy/v2/league/<key>/settings` and
   `/fantasy/v2/team/<key>/roster` are standard sub-resources of the API whose
   envelope these responses already use, and the `;out=` syntax observed above
   is that API's own. Whether they answer a cookie the way `teams` does is
   **untested** — the probe was written and not run, because issuing a request
   the page itself never made is a step beyond observing one, and it needs a
   decision rather than an assumption.
2. **Parse the HTML.** It demonstrably contains the data, since the pages
   display it. It is also the brittle option: a markup change breaks it
   silently, and 1 MB of advertising-heavy HTML is a poor contract.

Option 1 is worth testing before option 2 is costed, because if it answers, it
gives the same envelope as everything above and the whole snapshot comes from
one shape.

## Still open

Nothing below has been read, and none of it should be assumed:

- Scoring rules — points per reception, per yard, per touchdown.
- Roster slots, position eligibility, IR rules and roster limits.
- Any roster at all, own or otherwise, and current weekly lineups.
- Player availability: free agent against waiver, and claim deadlines.
- Waiver method, FAAB budget, and transaction restrictions.
- The trade deadline and trade rules.
- Pagination, on any list endpoint.
- Refresh behaviour and how stale a cached read may be.
- Whether any of this differs in a keeper league, or one mid-playoffs.

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
