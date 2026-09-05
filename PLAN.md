# Following a Yahoo draft through the browser

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
