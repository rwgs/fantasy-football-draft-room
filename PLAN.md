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
- **Only the browser can resolve a pick.** A pick frame names a player by a
  Yahoo ID, and the only thing that maps that ID to a person is the pool
  endpoint, which needs the same cookie. So the userscript resolves each pick to
  a name, position and team before sending it. The service is handed people, not
  identifiers.
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

**2. The userscript.** One file, `userscript/yahoo-draft-bridge.user.js`,
matching the draft room at `document-start`. It replaces `window.WebSocket` with
a wrapper that passes everything through untouched and copies each frame aside,
which has to happen before Yahoo's bundle constructs its socket. It fetches the
pool and the seats once, keeps an ordered list of picks decoded from `0|`
frames, and posts them to the service. It reads the league and the user's own
team off the room's own URL, so it cannot be pointed at the wrong league and
never has to ask which seat is yours, and it takes the draft order from the
`R|` frame the server sends on connect rather than deriving it, which is the
only reading that stays right for a league whose order is not a plain snake.

**3. The Yahoo platform.** `server/src/platforms/yahoo/`, implementing the same
five methods as Sleeper and registered as the second entry. It holds what the
bridge posts in memory only, never on disk: a draft in progress is stale the
moment it is read, and a cache would be a second copy of somebody's league
sitting in a file. `draftPicks` joins the posted people onto the board with
`joinKey` exactly as Sleeper's does, and returns the same `LivePicks` shape, so
nothing downstream of it can tell the two platforms apart.

**4. The platform selector.** `client/src/api.ts` hard-codes `/sleeper/` in
five places. Thread the platform through those calls and add the choice to the
setup screen. This is the only part of the client that changes.

## Trade-offs

- **One route accepts a cross-origin POST.** `AGENTS.md` records that the client
  sees one origin and never meets CORS. The bridge posts from
  `football.fantasysports.yahoo.com`, so the ingestion route needs a narrow
  allowance naming that origin alone. A userscript manager's own request API
  would avoid it and tie the script to one manager; the allowance is the smaller
  cost. The route stays loopback-only, where anything able to reach it is
  already running on the machine.

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

**The decode is testable without a draft.** `tools/yahoo/dump/` holds real
captured frames from a 14-team mock, including 111 picks. Decoding that file and
checking the picks against the pool is a check that runs offline and fails
loudly, and it is the first thing to write.

**Automated.** `npm run typecheck`, `npm --prefix client run lint`, and
`npm run engine:test` with the data service up. The Yahoo path adds no suite
that can run without a live draft, which is why the frame fixture above matters.

**Manual, and required.** A live mock with the app open beside it: every pick in
the room appears on the board, in the right slot, against the right seat, and no
pick is reported unmatched. Then the same against a real league before draft
day, because everything known so far comes from mock rooms.

**Known gaps, carried deliberately.**

- Phase 4's fixtures are still absent, so the Sleeper code this builds beside is
  proven by a rename diff rather than by a test.
- No Yahoo observation yet comes from a real draft.
