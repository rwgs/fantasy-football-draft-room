# Project roadmap

Ordered outcomes, each one leaving the project in a working state.

Phases 1 and 2 shipped before this document existed and are recorded as
completed rather than restated in detail; `CHANGELOG.md` holds what they
delivered. Phases 3 onward are the Yahoo work currently in flight.

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

## Phase 5: Yahoo, read-only, through the browser

### Outcome

A Yahoo draft is followed pick by pick, by a user who has installed a
userscript. No account, no API key and no approval from Yahoo. Sleeper remains
the default and keeps needing no userscript either.

### Included work

- `main` merged into `yahoo-platform`, which was cut before the planning
  documents existed.
- A userscript matching the draft room, which reads the pool and the draft
  socket with the browser's own cookies and posts decoded picks to the service.
- A `yahoo` platform directory implementing the five methods, holding what the
  bridge posts in memory only.
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
- Every observation so far comes from a mock room, not a real league.
- Whether a reconnecting client is sent the picks it missed is unobserved, so a
  mid-draft reload is of unknown cost.
- Traded picks and pre-draft draft state still look absent. Expect to lose them
  rather than to find them.

### Exit criteria

- A real Yahoo league imports with settings matching the league.
- A real Yahoo draft is followed pick by pick, or the phase records that it
  cannot be and why.
- Sleeper's behavior is unchanged, proven by the Phase 4 checks still passing.

### Validation

- The frames captured in `tools/yahoo/` decoded offline, so the pick decode is
  checked without needing a draft to be running.
- The `engine:test` suites, extended to cover Yahoo where fixtures allow.
- Manual: a live mock beside the app, then a real draft, followed live.

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
