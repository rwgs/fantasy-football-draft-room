# Yahoo-first in-season advice

Status: planned, 2026-09-08. This request authorizes the planning documents;
implementation has not started. Requirements live in [SPEC.md](SPEC.md), phase
order in [ROADMAP.md](ROADMAP.md), and actionable work in [TASKS.md](TASKS.md).

## Outcome and scope

Extend this local app with an in-season section for the user's Yahoo league:
choose weekly starters, evaluate waiver pickups and drops, evaluate trades,
and compare trading with using waivers or keeping the current roster. Yahoo
comes first; other league platforms come later. Analysis feeds may come from
other providers even while Yahoo is the only supported in-season platform.

Keep the draft screens and behavior intact. Share player identity, feed access,
league settings, caching and useful roster rules where they actually fit.
Weekly advice gets its own calculations rather than reusing draft ADP, pick
survival or CPU behavior as a measure of weekly player value. Advice remains
read-only: the user makes lineup changes, claims and trades in Yahoo.

## First prove the data, then build the advice

The existing Yahoo adapter reads a live draft room. It does not prove access
to current league rosters, weekly lineups, scoring, waivers or transactions
after the draft. Its `importLeague` explicitly leaves scoring and roster shape
unknown. The first implementation milestone is therefore a data-access study
against the user's actual league, outside a draft room.

For each required field, record the observed source, example shape, player and
league identifiers, pagination, refresh behavior, failure cases and permission
requirements. Keep identifying captures local and ignored; use synthetic or
sanitized fixtures in tests. Record verified findings in a new
`docs/yahoo-in-season-data.md` during that study, rather than guessing endpoints
in this plan.

| Data to establish | What depends on it |
| --- | --- |
| Season, week, own team, every roster and lineup | Team view and current baseline |
| Exact scoring, slots, all eligible positions, IR and roster limits | Legal lineups and moves |
| NFL kickoff times, byes, status and Yahoo's lock rules | Moves still possible this week |
| Full player pool, ownership, free-agent/waiver status and claim deadlines | Available replacements |
| Waiver method, priority, budget and transaction restrictions | Cost and feasibility of claims |
| Trade deadline, rules and other teams' needs | Feasible trade scenarios |
| Weekly projections, remaining-season outlook and their update times | Quantified recommendations |

Browser-based reading is the first candidate because it fits the existing
no-server-credentials boundary. Investigate ordinary league pages and the data
they read; do not assume the draft socket or its userscript works there. If a
browser reader is viable, keep transport in the browser and interpretation in
the service, and forward only required data, never cookies, tokens or headers.
Do not widen the draft script's page matches as a shortcut.

Yahoo describes an official Fantasy Sports API and OAuth on its
[API overview](https://developer.yahoo.com/api/) (checked 2026-09-08). That
establishes a possible alternative, not this project's access or the required
field coverage. The API application is still recorded as pending in TASKS.md;
its current approval status has not been verified. Revisit this route only
with evidence that changes the 2026-09-04 decision. An OAuth design that stores
credentials in the service would require changing the current boundary.

If the browser route cannot supply the required data, present the observed
gaps and a concrete alternative, such as a user-imported snapshot or an
approved API integration. Stop before implementing a different access or
credential model. A blocked Yahoo route does not silently switch priority to
Sleeper.

## Implementation approach and checks

**Phase 7: establish access and projection coverage.** Two separate checks:
read the real Yahoo league, and identify usable weekly analysis data. Audit
available Yahoo, Sleeper and ESPN data for coverage, scoring compatibility,
freshness and usage requirements. The current season projections and ESPN
draft rankings do not establish weekly or remaining-season coverage.
FantasyPros remains excluded under the 2026-09-05 decision unless a paid key
changes the premise. Deliver a field coverage table and a proposed minimum
data contract, with missing fields and affected features explicit. Check it
against the Yahoo UI; prove completeness across pagination and all rosters.

**Phase 8: display a trustworthy league snapshot.** Add Yahoo in-season read
capabilities alongside the existing draft adapter; choose their exact methods
from observed data rather than stretching the five draft methods. Keep league
ownership/rules separate from analysis feeds so a Yahoo league can use another
provider's projections. Use platform, season and league identity together;
preserve provider player IDs and all Yahoo eligibility positions. The existing
name matching can help resolve records, but taking only the first position is
insufficient for lineup eligibility. Ambiguous or missing matches remain
visible, and players without draft ADP must remain in the pool.

Publish coherent snapshots with capture time, source update time when known,
completeness and per-feed age. Do not combine half of a new ownership snapshot
with half of an old one. Keep private league snapshots in bounded service
memory and user settings in browser storage; do not introduce a database or
persist private league payloads in the public feed disk cache. A restart means
resyncing. Determine refresh intervals and stale limits from the Phase 7
evidence, separately from the draft's cache durations. Incomplete or stale
ownership/lock data blocks actionable advice; it may still be displayed with
its age. Test league switching, pagination failure, service restart, a silent
reader and player-match failures. Manually compare every roster and setting.

**Phase 9: weekly lineup advice.** Establish a pure calculation over a league
snapshot and week-specific player data, in a separate in-season module. Score
projected stats using actual league rules where available; provider point
totals are usable only when their scoring basis matches. Unsupported scoring
and missing projections are explicit, never silently defaulted or treated as
zero. Respect multi-position eligibility, FLEX, SUPERFLEX, IR, byes and locked
players. Compare the current lineup with the best legal lineup still possible,
showing swaps, projected difference, source age and uncertainty. Validate small
cases against exhaustive enumeration, including a greedy FLEX assignment that
would block a better lineup. Check locked players stay fixed and missing data
cannot produce a confident recommendation. This is the first useful release.

**Phase 10: waiver pickups and drops.** Apply each feasible add/drop to the
same baseline and rerun the lineup calculation. Include the player given up,
bench/bye coverage, roster restrictions, claim timing, FAAB or priority cost,
and alternatives if the claim fails. An unowned player is not necessarily an
immediate free agent. Show this week's improvement separately from the
remaining-season outlook; do not invent the latter from preseason ADP or an
annual total divided by weeks. Bid amounts are suggestions with assumptions,
not a claim-win probability. Test an illegal drop, a locked addition, a
pending waiver, insufficient budget and a better player whose drop cost makes
the move worse. Compare examples with Yahoo's available-player view without
submitting a transaction.

**Phase 11: trades and choosing how to improve.** First evaluate user-entered
offers, then suggest a bounded shortlist of targets from other rosters using
the same evaluator. Recalculate both teams after a trade, including lost
starters, replacement pickups, roster space, effective timing and bye coverage.
Show why the other team might benefit without predicting their willingness to
accept. Compare keep/optimize, waiver add/drop and trade scenarios using the
same snapshot, scoring and time horizon. Keep FAAB costs and player costs
visible rather than inventing a points-to-dollars conversion. Test unequal
player-count trades, a nominal upgrade that hurts the lineup, a trade that
cannot take effect in time, and an available waiver alternative that makes
the trade unnecessary. Missing remaining-season evidence limits the advice;
it cannot justify a confident season-long trade recommendation.

Other league platforms are deferred until Phase 11 is useful for Yahoo and the
user chooses the next integration. Add one adapter at a time against the same
contract checks. No separate repository, generic plugin framework, automatic
transactions, hosted accounts, AI service dependency or dynasty draft-pick
valuation is part of this plan.

## Validation, sequencing and stop points

Each phase depends on the preceding phase's exit criteria in ROADMAP.md. Split
implementation into the reviewable tasks in TASKS.md; expand later phases into
tasks only when their inputs are known. Phase 7 discovery need not wait for a
future live draft or the older Sleeper fixture work. Those existing checks and
release obligations remain open, and this plan does not mark them complete.

For implementation, run focused deterministic checks first. Endpoint-visible
behavior belongs in `npm run engine:test`; service-only internals belong in
`npm run server:test`; browser transport needs bridge coverage. Extend the
existing runners only as required. The complete local gate is typecheck,
client lint, engine tests, server tests, bridge tests, build and screenshots.
Check `npm run serve -- status` before trusting service tests. Extend shots to
exercise the in-season views and failures while retaining both draft modes.
Record missing private fixtures and manual evidence explicitly; a skipped
real-league check does not establish platform correctness or release readiness.

For each phase, validate real Yahoo readings beside the app without submitting
lineups, claims or trades. Record discrepancies and stop dependent advice when
required rules/data are unavailable. Before calling a recommendation complete,
demonstrate both a beneficial move and a superficially attractive move the
calculation correctly rejects.

Keep implementation commits separable by phase. Rollback means reverting only
that phase's changes after review, leaving the draft workflow and existing
browser settings usable. Version new browser state separately so it cannot
overwrite saved draft settings. No destructive migration is planned.

Stop now at the user's planning-only boundary. After implementation is
authorized, execute one phase at a time and report its checks before moving
on. Pause for a decision if access requires credentials in the service, paid
data, a different persistence model, unsupported league rules or reduced scope.
Do not treat elapsed time or a failed data source as approval for a substitute.

## Earlier Yahoo draft plan, retained

The earlier plan below is preserved because draft validation and release work
remain open. It is a historical account, not current status: TASKS.md records
the main merge and live mock validation as done, and bridge tests now exist.
Its statements about being behind main and never running the userscript are
superseded by those records. This planning change does not re-audit or close
the remaining draft tasks.

### Following a Yahoo draft through the browser

Approach for the change currently in flight. Replaced when the next non-trivial
change begins, so anything that must outlive this change is promoted first.

Branch: `yahoo-platform`. It is **behind `main`**: it was cut before the
planning documents existed, so all seven show as deleted against it. Merging
`main` into it is the first step and is needed before it can ever merge back.

Why the approach is what it is sits in the 2026-09-04 entry of `DECISIONS.md`,
and what Yahoo actually sends is catalogued in `docs/yahoo-draft-protocol.md`.
This document is only how the software is built on top of both.

## Problem

The draft assistant follows a Sleeper draft or no draft at all. A Yahoo user
gets the mock room, their rankings, their notes and the grade, and none of the
live features that make the tool worth running while an actual draft happens.

The Fantasy Sports API was the obvious way in and it is gated behind a human
review with no published turnaround. The draft room does not use that API, so
the tool does not have to either.

## What the design is forced into

Three constraints decide the shape, and none of them is a preference.

- **Only the browser can read a Yahoo draft.** `pub-api` answers a session
  cookie and refuses everything else. The service has no cookie and must never
  hold one, so the code that reads Yahoo runs in the user's tab and nothing
  else can.
- **Only the browser can reach the pool.** A pick frame names a player by a
  Yahoo ID, and the only thing that maps that ID to a person is the pool
  endpoint, which needs the same cookie. So the userscript fetches the pool and
  posts it once. It does not resolve picks itself: reaching Yahoo and
  interpreting Yahoo are separate jobs, and only the first one has to happen in
  the tab. See the 2026-09-04 entry in `DECISIONS.md`.
- **The socket has to be hooked before it is built.** Nothing lists the picks
  over HTTP, and the only chance to wrap `WebSocket` is before Yahoo's bundle
  constructs one, so the script runs at `document-start` or not at all. What it
  does not have to do is remember anything: the server replays every pick made
  so far in a `P|` frame on connect, so a reloaded tab catches itself up and a
  crash mid-draft costs nothing.

## Approach

Four steps, in order, each landing on its own.

**1. Catch the branch up.** Merge `main` into `yahoo-platform`, bringing the
planning documents and the two commits that followed. No behaviour changes.
Phase 4 of `ROADMAP.md` — the fixtures that prove the seam — is still worth
closing first, because a regression in the moved Sleeper code is much cheaper to
find now than underneath a second platform.

**2. The userscript. Built.** One file,
`userscript/yahoo-draft-bridge.user.js`, matching the draft room at
`document-start`. It replaces `window.WebSocket` with a wrapper that passes
everything through untouched and copies each frame aside, which has to happen
before Yahoo's bundle constructs its socket. It fetches the pool and the seats
once, and forwards the frames as the text Yahoo sent, decoding nothing. It reads
the league and the user's own team off the room's own URL, so it cannot be
pointed at the wrong league and never has to ask which seat is yours. It keeps
no state and remembers nothing across a reload, because the draft server replays
every pick in a `P|` frame on connect.

**3. The Yahoo platform. Built.** `server/src/platforms/yahoo/`, implementing
the same five methods as Sleeper and registered as the second entry.
`frames.js` decodes the socket, `room.js` holds what the bridge posted, in
memory only and never on disk: a draft in progress is stale the moment it is
read, and a cache would be a second copy of somebody's league sitting in a file.
`draftPicks` resolves each pick through the posted pool and then joins it with
`joinKey` exactly as Sleeper's does, returning the same `LivePicks` shape, so
nothing downstream can tell the two platforms apart.

The order comes from the `R|` frame rather than being derived from a snake,
which is the only reading that stays right for a league whose order is not one.
What Yahoo does **not** put in the draft room is the roster shape and the
scoring rules, so `importLeague` returns null for both and warns, rather than
importing a league that is not the user's.

**4. The platform selector. Built.** `client/src/api.ts` hard-coded `/sleeper/`
in five places; the platform is now an argument to each. A saved league records
which platform it came from, and one saved before there was a choice reads as
Sleeper. The setup screen gained the choice, and the import summary had to learn
that a roster and a scoring rule can be absent — it read `imported.roster.K`
unconditionally, which a Yahoo import would have thrown on.

## Trade-offs

- **One route accepts a cross-origin POST.** `AGENTS.md` records that the client
  sees one origin and never meets CORS. The bridge posts from
  `football.fantasysports.yahoo.com`, so the ingestion route has to answer a
  cross-origin request. **No allowance was added, because none was needed:**
  `server/src/index.js` already calls `app.use(cors())` with no options, so every
  route has always answered every origin. That is worth stating plainly rather
  than leaving as a surprise — what keeps the service to this machine is the
  loopback bind, not CORS. Tightening the global policy is a separate change and
  was left alone.

- **The bridge is versioned against something nobody promised.** Yahoo can
  change the frame format in a deploy and the script stops working, with no
  deprecation and no warning. This is stated plainly to users rather than
  discovered by them mid-draft, and the decode is kept in one small function so
  that a break is cheap to fix.

- **A userscript is a setup step.** It is not a credential and not an account,
  so the README's promise survives, but "install this in Tampermonkey" is real
  friction that Sleeper does not ask for. Sleeper stays the default.

- **The seam bends here.** Sleeper is pulled by the service; Yahoo is pushed to
  it. The five methods still fit, but `draftPicks` reads from memory rather than
  fetching, and `leagueSetup` answers from what was posted. If the fit turns
  out to be forced, the interface is what changes, not the Yahoo code.

## Verification

**The decode is testable without a draft, and is tested.** `engine:test` gained
a "Reading a Yahoo draft room" block that posts frames the way the bridge does
and checks what comes back out. It runs two ways, and both ran:

- **Synthetic frames, always.** Real grammar, invented player IDs and seats, so
  it runs in a fresh clone and names nobody. It covers the trap in the protocol:
  a replayed pick is `<overall>=<player>,<seat>,<cost>` and a live one is
  `0|<overall>|<player>|<seat>|<slot>|<cost>`, so reading either with the other's
  layout silently swaps the seat and the cost.
- **The four real captures, when present.** `tools/yahoo/*.log` is git-ignored,
  so this half skips for anyone but the author. All four replay clean: 433 picks
  decoded, no duplicates, and the `R|` order at 210 entries for 14 teams.

**Automated, and run.** `npm run typecheck` clean. `npm --prefix client run lint`
at 33 warnings, unchanged from baseline and all pre-existing. `npm run build`
clean. `npm run engine:test` all checks passed, with the two Sleeper fixture
suites still skipping.

**Manual, and still owed.** A live mock with the app open beside it: every pick
in the room appears on the board, in the right slot, against the right seat, and
none reported unmatched. Then the same against a real league before draft day.
Nothing below substitutes for this, because nothing below has run the userscript.

**Known gaps, carried deliberately.**

- **The userscript has never run.** It is the one piece no check here touches:
  the tests post to the route the way it would, which proves the service and not
  the script.
- **No real pick has ever been resolved to a real person.** No capture kept the
  body of `players/nfl/<league>`, so the join is tested against a pool
  synthesised from this project's own board. The decode is real; the join is
  proven only on invented IDs.
- Phase 4's fixtures are still absent, so the Sleeper code this builds beside is
  proven by a rename diff rather than by a test.
- No Yahoo observation yet comes from a real draft.
- Yahoo's roster shape and scoring were never observed, so a Yahoo import
  carries neither.
