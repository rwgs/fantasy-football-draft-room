# Project roadmap

Ordered outcomes, each one leaving the project in a working state.

Phases 1 and 2 shipped before this document existed and are recorded as
completed rather than restated in detail; `CHANGELOG.md` holds what they
delivered. Phases 3 through 6 are the Yahoo draft work currently in flight.
Phases 7 through 11 are the Yahoo-first in-season extension requested on
2026-09-08. Phase 7's discovery and Phase 8's league view are built, each with
outstanding items named below; Phase 9 is split into tasks in
[TASKS.md](TASKS.md) and started -- Y9.0's measurement and Y9.1's scoring join
are built, Y9.2 to Y9.4 are not; Phases 10 and 11 remain outcomes with no tasks
written. See [PLAN.md](PLAN.md) for the approach, and `TASKS.md` for what
has actually been validated -- this document owns the order and the exit
criteria, not the status of a build.

## Phase 1: First release — complete, 1.0.0

The mock draft room and the Sleeper draft assistant, released 2026-08-31.
See `CHANGELOG.md`.

## Phase 2: Player notes — complete, 1.1.0

Notes on a player shown under him in the pool, released 2026-09-01.
See `CHANGELOG.md`.

## Phase 3: A seam for more than one league platform — complete, unreleased

### Outcome

The service reads league platforms through a common interface rather than
having Sleeper wired through its routes. A second platform becomes a directory
and one line in a registry, and nothing else in the service knows how many
there are.

### Included work

- `server/src/platforms/sleeper/` holding the existing Sleeper modules, moved
  unchanged.
- A five-method adapter per platform, and a registry naming them.
- Routes taking the platform as a path segment, so existing URLs are unchanged.
- ID validation moved onto the platform that owns it.

### Dependencies and risks

- No dependencies. The risk is that an interface shaped around one
  implementation does not fit the second, which is only discharged by Phase 5
  actually landing behind it.

### Exit criteria

- `/api/sleeper/...` behaves exactly as before, byte for byte.
- The client requires no change.
- An unknown platform is refused with a list of the ones that exist.

### Validation

- `npm run typecheck`, lint, and `npm run engine:test`.
- Routes checked by hand for a bad ID, an unknown platform, an encoded-slash
  traversal attempt, and a well-formed ID the upstream does not have.
- **Incomplete.** The two `engine:test` suites covering the moved code skipped,
  because `client/fixtures.local.json` does not exist. Phase 4 closes this.

## Phase 4: Prove the seam against real leagues

### Outcome

The checks that exercise league and draft code actually run, so Phase 3 is
verified rather than inferred from a clean rename diff.

### Included work

- `client/fixtures.local.json`, naming real Sleeper leagues, a keeper league
  and a finished draft.
- A full `engine:test` run with no skipped suites.

### Dependencies and risks

- Needs real Sleeper league IDs from the person running it. Nothing else.
- Risk: a regression in the moved code has been sitting undetected since
  Phase 3. Cheap to find now, expensive to find underneath a Yahoo
  implementation.

### Exit criteria

- `engine:test` reports no skipped suites and every check passes.

### Validation

- The self-test itself. That is the point of the phase.

## Phase 5: Yahoo, read-only, through the browser — proven in a public mock

### Outcome

A Yahoo draft is followed pick by pick, by a user who has installed a
userscript. No account, no API key and no approval from Yahoo. Sleeper remains
the default and keeps needing no userscript either.

### Included work

- `main` merged into `yahoo-platform`, which was cut before the planning
  documents existed.
- A userscript matching the draft room, which reads the pool and the draft
  socket with the browser's own cookies and posts the pool and the raw frames to
  the service. It decodes nothing; see the 2026-09-04 entry in `DECISIONS.md`.
- A `yahoo` platform directory implementing the five methods, holding what the
  bridge posts in memory only, and the one route in the service written to.
- Joining Yahoo picks onto the board by name, position and team, which the pool
  endpoint supports as it stands.
- A platform selector in the client, and honest documentation of what a
  userscript costs a user and how it can break.

### Dependencies and risks

- No longer blocked on Yahoo. The draft room never touches the API that was
  applied for; see the 2026-09-04 entry in `DECISIONS.md`.
- The frame format is undocumented and unpromised. A Yahoo deploy can break the
  bridge with no warning, mid-draft.
- Name matching moves onto the critical path of a live draft, where a miss puts
  a hole in the board rather than a footnote in an import.
- Every observation so far comes from a public mock, so the room was real
  people drafting in real time and the protocol, pick timing, autopick on
  inactivity and reconnect replay are all observed. What no observation covers
  is a league someone configured: keepers, traded picks, a commissioner's
  roster and scoring, any format but 14-team snake. That is what is left, and
  it is why this phase stays open.
- A reconnecting client **is** sent the picks it missed, in a `P|` frame, so a
  mid-draft reload costs nothing. Observed on a reconnect 91 picks deep.
- Traded picks and pre-draft draft state still look absent. Expect to lose them
  rather than to find them. The `R|` order already has both applied, which is
  why it is read rather than derived.
- Yahoo's roster shape and scoring are not in the draft room at all, so a Yahoo
  import cannot carry them and says so instead.

### Exit criteria

- A real Yahoo league imports the seats, the order and the round count. The
  roster shape and the scoring are **not** exit criteria: the draft room does
  not carry them, and the import warns rather than inventing them. **Met in a
  mock:** league 10720547 imported 14 named seats, a 15 round draft and the full
  order, and refused to invent the roster or the scoring.
- A real Yahoo draft is followed pick by pick, or the phase records that it
  cannot be and why. **Met in a mock, 2026-09-04**, first pick to last: 210 of
  210 joined, none unmatched, every seat holding exactly 15 and every slot
  agreeing with the snake. A league that counts is still outstanding.
- Sleeper's behavior is unchanged, proven by the Phase 4 checks still passing.

### What the live mock taught

- **The bridge cannot rely on a userscript manager alone.** Chrome and Edge gate
  user scripts in MV3, and Tampermonkey installs, enables and reports success
  while injecting nothing: `window.WebSocket` stays native and no frame is ever
  seen. This cost a whole mock room before it was spotted, so the README now
  leads with the switch and gives `window.WebSocket.name` as the one probe that
  tells the two failures apart. `tools/yahoo/cdp-bridge.mjs` injects the same
  file over the DevTools protocol when the manager will not.
- **The first post prompts for local network access**, which is a permission
  dialog appearing mid-draft to somebody who does not know what asked for it.
- **Reading the pool rather than the screen is what makes the join work.** Chris
  Olave was drafted and matched. He is the exact name the 2026-09-04 decision
  used to reject DOM scraping, because `C. Olave` fails `forenamesAgree`.

### Validation

- The frames captured in `tools/yahoo/` decoded offline, so the pick decode is
  checked without needing a draft to be running.
- The `engine:test` suites, extended to cover Yahoo where fixtures allow.
- Manual: a live public mock beside the app, done. Then a configured league,
  followed live, which is the part still outstanding.

## Phase 6: Release readiness

### Outcome

The Yahoo work is fit to publish, or a decision is recorded not to publish it.

### Included work

- `README.md` and the repository description checked. "No account, no API keys"
  survives the browser route, but following a Yahoo draft needs a userscript
  installed, and that has to be said where the promise is made.
- The userscript documented for what it is: code running on somebody else's
  page, against a format nobody promised, which Yahoo can break without notice.
- `CHANGELOG.md` entry.
- Security review of the ingestion route and its cross-origin allowance, and a
  check that no Yahoo session can reach the service.
- The upstream question in `DECISIONS.md` resolved.

### Dependencies and risks

- Depends on Phase 5.

### Exit criteria

- No documented promise the software does not keep.
- No secret in the repository or its history.

### Validation

- Full local gate, independent review, and documented manual testing.

## Phase 7: Prove Yahoo in-season access and analysis data -- built, not closed

Outcome: a verified way to read the user's actual Yahoo league outside the
draft room, and a coverage assessment for weekly and remaining-season advice.

Scope: observe the league's data access; document fields, identifiers,
pagination, refresh, permissions and gaps; verify scoring and roster rules;
assess projection sources. Browser reading is the first candidate under the
existing credential boundary. The API application status is unverified.

Dependencies: implementation authorization and access to the user's signed-in
league for observation. This investigation need not wait for Phases 4-6's
outstanding live-draft/fixture work; those obligations remain open.

Exit: each required field in PLAN.md is demonstrated against Yahoo or recorded
as unavailable with the dependent feature held. A minimum data contract and
access approach are reviewable. Do not start dependent phases with guessed
fields. If the available route requires changing credentials, cost or scope,
present the alternative and wait for that decision.

Validation: compare readings to Yahoo; check complete pagination and all team
rosters; retain only sanitized fixtures in git. Record reproducible reads and
source coverage, not a claim that the draft bridge proves in-season support.

**Where it stands.** The exit is met on the data contract: the reader is proved
end to end, the coverage table is in `docs/yahoo-in-season-data.md`, the source
assessment is in `docs/in-season-data-sources.md`, and the contract is in
`PLAN.md`. Two things keep it open, and both need something this project cannot
reach on its own: the API application's status, which only the account holder
can read, and the league-scope reads that need a signed-in browser run -- a
waiver player, a free agent, the other seven rosters and a FAAB balance no
league on hand has. Y7.1 and Y7.2 in `TASKS.md` carry the detail.

## Phase 8: A trustworthy Yahoo league view -- built, exit met on the reading side

Outcome: select the Yahoo league and own team, then see current rosters,
settings, availability and data age in an in-season view alongside the draft.

Dependencies: Phase 7 proves the required reads and the chosen access model.
Scope: Yahoo reader, normalized snapshots, player ID mapping, eligibility,
bounded private memory state and explicit missing/stale states.

Exit: every roster and relevant setting agrees with Yahoo; unknown players
remain visible; switching league/season cannot reuse another league's state;
interrupted pagination cannot turn owned players into available players.

Validation: synthetic snapshot and endpoint checks, transport checks where
applicable, restart/staleness/partial-response cases, browser screenshots and
a manual comparison to the user's league. Run the full local implementation
gate defined in PLAN.md; preserve and report outstanding draft validation.

**Where it stands.** Built as Y8.1 to Y8.6, and the owner confirmed against
their real league that every roster matches and the own-team mark is on their
team. Two items keep the exit short of fully discharged: the scoring was called
"ok" rather than checked rule by rule against Yahoo, and **no second real
league has been read**, so "switching league cannot reuse another league's
state" is proven in the harness and not in life.

## Phase 9: Weekly starting-lineup advice

Outcome: the first useful in-season release recommends legal swaps from the
user's roster and explains the projected difference for the selected week.

Dependencies: Phase 8, and weekly projection/scoring coverage, **which is now
verified** -- Y9.0 measured the spread between the two sources and proved that
components times modifiers reproduces a real scoring system.
Scope: a separate pure in-season calculation, exact league scoring, all
eligibility positions, fixed locked players, byes, IR and missing data. The
advice appears on **two surfaces**, the app's screen first and a panel over
Yahoo's own league pages second, per the 2026-09-08 decision -- because the
lineup is set in Yahoo, which is also why nothing here writes one.

Exit: advice respects all supported rules and improves on or agrees with the
current legal lineup. Unsupported rules or missing required data limit advice
explicitly. The user still makes the changes in Yahoo.

**One limit is now known rather than anticipated, and it narrows the phase.**
Y9.1 established on 2026-09-09 that a kicker's and a team defence's components
cannot be verified from what the two projection feeds publish, so neither is
scored: **a K or DEF slot gets no projection and no advice.** Eleven of Yahoo's
108 stat categories are scored and the rest report as unsupported, which the
exit criterion above already required to be visible. See `DECISIONS.md`,
2026-09-09, for why a table was not simply written anyway.

Validation: small cases checked against exhaustive legal lineups, FLEX and
SUPERFLEX traps, kickoff/lock boundaries, missing projections and screenshots.
Manually compare a normal week and a constrained lineup to Yahoo. Full gate.

## Phase 10: Waiver pickups with their drop costs

Outcome: compare feasible additions with keeping the roster, including the
player dropped, weekly benefit, future coverage and FAAB/priority cost.

Dependencies: Phase 9, complete availability and verified waiver rules.
Remaining-season claims also require the Phase 7 analysis coverage.

Exit: each suggestion names a legal add/drop and its timing; unavailable or
locked players cannot be offered as immediate fixes. Missing future data is
disclosed. Claim success is never promised.

Validation: ownership, waiver versus free-agent status, deadlines, budget,
illegal drops and a nominal upgrade whose drop cost makes it worse. Compare
with Yahoo without submitting claims; screenshot advice and limitations. Full
gate. Do not enable any transaction-writing path.

## Phase 11: Trade advice and comparison with waivers

Outcome: evaluate entered offers, suggest a small set of targets, and compare
trade, waiver and keep/optimize scenarios for the user's team.

Dependencies: Phase 10, other teams' current rosters, verified trade rules and
remaining-season evidence for any season-long recommendation.

Exit: all scenarios share a baseline and horizon; trades account for both
teams' outgoing players, replacements, roster space and effective date. Show
why a target could fit the other team without asserting they will accept.

Validation: unequal-count trades, lost starters, unavailable replacements,
deadline restrictions, a harmful apparent upgrade and a waiver alternative
that makes a trade unnecessary. Manual Yahoo comparison, screenshots and full
gate. Existing release obligations remain required before publication.

## Deferred: Other in-season platforms

After the Yahoo workflow is useful through Phase 11, let the user choose the
next platform. Reuse the demonstrated data contract and advice calculations;
prove the new adapter against the same checks. No integration or framework
work for Sleeper, ESPN or another league platform is scheduled now. Using an
analysis feed from one of them does not require adding its league integration.
