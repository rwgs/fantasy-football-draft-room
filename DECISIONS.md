# Project decisions

Closed decisions that constrain future changes, newest first. Entries are
appended and never rewritten; a reversal is recorded by adding a new entry and
marking the old one superseded.

Record a decision only when it constrains future work and its rationale cannot
be recovered by reading the code. Routine implementation choices belong in the
diff. This project comments its own reasoning unusually thoroughly, so most of
what would otherwise land here is already next to the code it explains.

## 2026-09-04 Yahoo is read through the browser, not through the Fantasy Sports API

Status: Accepted. Supersedes the consequences of the 2026-09-01 entry below.

### Decision

A Yahoo draft is followed by a userscript running in the user's own draft room
tab. It reads Yahoo's `pub-api` and the draft socket with the cookies the
browser already holds, and posts plain picks to the local service. The Fantasy
Sports API and its OAuth flow are set aside until a key arrives, and may never
be needed.

### Why

The draft room does not use the API this project applied for. It uses
`pub-api.fantasysports.yahoo.com/fantasy/v3/`, which authenticates with the
browser's session cookie and nothing else. Verified rather than inferred: the
same URLs answer 200 inside the room and, from anywhere without the cookie,

    HTTP 403  {"description": "Unable to retrieve cookie."}

That removes the wall the 2026-09-01 entry was built around. There is no
application, no human review and no unpublished turnaround, because there is no
registered application at all — only someone reading their own league in their
own browser.

### What was observed

Against live 14-team mocks on 2026-09-04, using the tools in `tools/yahoo/`.
Everything here was watched happening, not read in a document. The frame-by-frame
reference is `docs/yahoo-draft-protocol.md`; only what bears on the decision is
repeated here.

- **Picks arrive only over a websocket**, as pipe-delimited text.
  `0|<overall>|<playerId>|<teamId>|<slot>|<cost>` is a pick,
  `D|<overall>|<teamId>|<seconds>` hands over the clock, `C|<n>` is the clock
  ticking. Yahoo pushes its own pick grades on `G|` and value labels on
  `O|draft-labels|` down the same socket. Reading picks means filtering for `0|`
  and ignoring the other nine frame types, so Yahoo changing them cannot break
  it.
- **The draft order is sent on connect**, as `R|` followed by one team per pick
  in pick order. It does not have to be derived, and deriving it would be
  silently wrong for any league whose order is not a plain snake. `teamId` did
  independently match the slot a plain snake predicts — round 8 of 14 runs picks
  99 to 112 in reverse, and the frames put slot 13 on pick 100 — but that is now
  a cross-check rather than the mechanism.
- **No REST endpoint carries draft state.** `players/nfl/<league>` stays at 1195
  entries with drafted players still in it and no field marking them gone;
  `percent-drafted` and `average-pick` are historical ADP. `draftstatus` carries
  only a websocket address. `draftresults`, `draft`, `picks` and `draftpicks` do
  not exist. The socket is the only live source.
- **The player pool joins onto this board unchanged.** Entries carry `fname`,
  `lname`, `display_pos` and `team_abbr` as separate fields, so
  `joinKey(fname + ' ' + lname, display_pos, team_abbr)` works with `names.js`
  exactly as it stands. The abbreviated names on screen are a display style, not
  the data. Defences still join on team, which is why their naming does not
  matter.
- **The room URL says which seat is yours.** `/draftclient/f1/<league>/<team>`
  names the league and the reader's own team, and team is slot. Sleeper cannot
  do this — it makes you pick your manager from a list and cannot publish the
  order until minutes before the draft — so the Yahoo assistant needs no such
  step at all.
- **The room URL carries a one-time `auth` token.** Reloading it does not
  reconnect, it leaves the draft. A userscript therefore attaches to the room as
  the lobby opened it and can never navigate there itself.
- **The DOM is not usable.** Class names are build-hashed, names are shown
  abbreviated, and there is no cohesive pick list to read.

### Rejected alternatives

- **Scraping the draft room DOM.** Rejected on the evidence above: hashed class
  names break at Yahoo's next deploy, and `C. Olave` cannot be joined by
  `forenamesAgree`, which needs three shared opening letters.
- **The service calling `pub-api` with an exported cookie.** It would work, and
  it would put a user's Yahoo session on a server. That is the one thing
  `AGENTS.md` refuses outright, and it would trade this project's central
  promise for a convenience.
- **Waiting for the API key.** Set aside rather than rejected. If it arrives it
  is worth comparing, particularly for pre-draft league import, but nothing now
  waits on it.
- **A packaged browser extension.** Rejected for now: a userscript needs no
  store listing, no review and no signing, and it is one file a user can read
  before running. Revisit only if distribution demands it.

### Consequences

- Yahoo support stops being author-only. Anyone who can install a userscript can
  use it, which reverses the central consequence of the 2026-09-01 entry.
- The README's "no account, no API keys" stays true. It gains a different
  caveat instead: following a Yahoo draft needs a userscript installed, which is
  a real setup step even though it is not a credential.
- A userscript is a new kind of artifact for this repository — code that runs on
  a third party's page, versioned against markup and a protocol neither
  documented nor promised. It needs its own home, its own note in `README.md`,
  and an honest statement that Yahoo can break it without warning.
- The platform registry gets its second entry, which is what Phase 3 left
  pending.
- The Yahoo session never leaves the browser, so the service holds no
  credential and stays as safe to run as it is today.

### Still unverified, and what it would cost

- ~~**Whether a client reconnecting mid-draft is sent the picks it missed.**~~
  Answered later the same day, after this entry was written: yes. The server
  replays every pick in a `P|` frame on connect, observed on a reconnect into a
  draft 91 picks deep. A reloaded tab catches itself up, so the bridge needs to
  remember nothing across a crash. See `docs/yahoo-draft-protocol.md`.
- **Whether a real Yahoo draft behaves like a mock.** Every observation above
  comes from the mock lobby. This is cheap to recheck and must happen before
  draft day.

## 2026-09-01 Yahoo support is for its author, not for the project's users

Status: Superseded by the 2026-09-04 entry above. Its reading of Yahoo's OAuth
flow still holds; its conclusion that Yahoo support cannot reach ordinary users
does not, because the draft room never uses that API.

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
