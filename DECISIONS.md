# Project decisions

Closed decisions that constrain future changes, newest first. Entries are
appended and never rewritten; a reversal is recorded by adding a new entry and
marking the old one superseded.

Record a decision only when it constrains future work and its rationale cannot
be recovered by reading the code. Routine implementation choices belong in the
diff. This project comments its own reasoning unusually thoroughly, so most of
what would otherwise land here is already next to the code it explains.

## 2026-09-01 Yahoo support is for its author, not for the project's users

Status: Accepted.

### Decision

Yahoo league support is built for the repository owner's own leagues. It ships
in the repository, documented as requiring the user to obtain their own Yahoo
credentials and their own approval from Yahoo. Sleeper remains the default and
continues to need neither.

### Why

Yahoo does not offer self-serve access to the Fantasy Sports API. "Fantasy
Sports" is absent from the permissions list when registering an application,
because access is gated behind a reviewed application at
`https://sports.yahoo.com/developer/access/`, which asks for the intended user
base and warns that insufficiently detailed submissions are closed without
correspondence.

That makes the obvious model — every user registers their own app and pastes
two strings into `.env` — false. Every user would need their own human review,
with no published turnaround. For a tool people clone and run locally, that is
not a setup step, it is a wall.

Yahoo also issues access tokens that expire in 3600 seconds and requires a
confidential client, so the secret cannot live in the browser. The exchange has
to happen server-side.

### Rejected alternatives

- **A hosted service with a shared Yahoo app.** Solves the approval problem for
  every user at once. Rejected: it requires operating a server holding other
  users' Yahoo tokens, which contradicts this project's core promise of no
  account, no database and nothing leaving your browser. It is a different
  project with a different risk profile.
- **Shipping the client secret in the repository.** Rejected outright; it is an
  MIT-licensed public repository.
- **Replacing Sleeper with Yahoo.** Rejected: Sleeper needs no credentials and
  works for everyone, so removing it would trade a universal integration for a
  gated one.
- **A separate fork for Yahoo.** Rejected: the board, rankings, notes and engine
  are shared, and two copies would drift.

### Consequences

- The README and the repository description both promise "no account, no API
  keys". That has to gain a caveat before Yahoo support is released.
- Yahoo support cannot be a headline feature, because almost nobody can enable
  it.
- Whether this belongs upstream at all is the upstream maintainer's call, since
  they would inherit the support burden. Unresolved; see `TASKS.md`.

## 2026-09-01 League platforms sit behind a five-method seam

Status: Accepted.

### Decision

Reading a league platform goes through `server/src/platforms/<name>/`, each
exposing the same five methods — `importLeague`, `leagueUsers`, `leagueSetup`,
`draftState`, `draftPicks` — plus its own ID validation. Routes take the
platform as a path segment. The registry is an explicit list, not a directory
scan.

### Why

Sleeper was wired directly through the service's routes, so a second platform
meant either duplicating five routes or branching inside each one. Those five
methods are not an invented abstraction: they are exactly what the settings
screen and the draft assistant already needed, so the seam follows a line that
was already there.

ID validation had to move with it. A long run of digits is a fact about
Sleeper; a Yahoo league key is `461.l.123456`. A single rule loose enough to
admit both would stop being a check, and these IDs are pasted into upstream
URLs.

Taking the platform as a path segment rather than a query parameter or a new
route prefix meant `/api/sleeper/...` kept working unchanged, so the client
needed no edit and the change stayed server-side and reviewable in one sitting.

### Rejected alternatives

- **A plugin loader scanning the directory.** Rejected: two platforms do not
  need one, and a service that imports whatever it finds on disk is a worse
  thing to run than one with an explicit list.
- **Branching on platform inside each existing route.** Rejected: it puts the
  same conditional in five places and leaves ID validation in the routes, where
  it does not belong.
- **Doing the extraction together with the Yahoo implementation.** Rejected:
  it mixes a pure no-behaviour-change refactor with new network code in one
  unreviewable diff.

### Consequences

- Adding a platform is a directory and one line in `server/src/platforms/index.js`.
- Until a second platform lands, this is a registry with one entry in it —
  an abstraction whose justification is still pending. If Yahoo never lands,
  it should be reconsidered rather than left as scaffolding.
- `/api/health` now reports which platforms a copy can read.
