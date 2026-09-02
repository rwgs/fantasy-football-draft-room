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

## Phase 5: Yahoo, read-only — blocked

### Outcome

A Yahoo league can be loaded and a Yahoo draft followed, for a user holding
their own approved Yahoo credentials. Sleeper remains the default and keeps
needing no credentials.

### Included work

- OAuth 2.0 authorization code flow, with the client secret in the user's own
  `server/.env` and the refresh token held locally.
- A `yahoo` platform directory implementing the five methods.
- Joining Yahoo picks onto the board by name, position and team, since Yahoo's
  player keys mean nothing to this board.
- A platform selector in the client, and honest documentation of what Yahoo
  costs a user.

### Dependencies and risks

- **Blocked on Yahoo approving API access.** Applied 2026-09-01; no published
  turnaround. Nothing in this phase can be built or tested until it lands.
- The live `draftresults` question in `SPEC.md` is unanswered. If it only
  populates after a draft completes, the assistant mode does not work for Yahoo
  and this phase delivers league import alone.
- Name matching moves onto the critical path of a live draft, where a miss puts
  a hole in the board rather than a footnote in an import.
- Traded picks and pre-draft draft state look absent from Yahoo. Expect to lose
  them rather than to find them.
- Yahoo's JSON is a mechanical conversion of XML, nesting everything in
  `{"0": ..., "count": n}` pseudo-arrays.

### Exit criteria

- A real Yahoo league imports with settings matching the league.
- A real Yahoo draft is followed pick by pick, or the phase records that it
  cannot be and why.
- Sleeper's behavior is unchanged, proven by the Phase 4 checks still passing.

### Validation

- `tools/yahoo/probe.mjs` against a real league, before any implementation, to
  replace guesses about the schema with the schema.
- The `engine:test` suites, extended to cover Yahoo where fixtures allow.
- Manual: a real draft, followed live.

## Phase 6: Release readiness

### Outcome

The Yahoo work is fit to publish, or a decision is recorded not to publish it.

### Included work

- `README.md` and the repository description corrected. Both currently promise
  "no account, no API keys", which stops being true for a Yahoo user.
- `CHANGELOG.md` entry.
- Security review of the OAuth flow and token storage.
- The upstream question in `DECISIONS.md` resolved.

### Dependencies and risks

- Depends on Phase 5, and on Yahoo's answer about redistribution.

### Exit criteria

- No documented promise the software does not keep.
- No secret in the repository or its history.

### Validation

- Full local gate, independent review, and documented manual testing.
