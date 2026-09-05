# Project tasks

The work in flight and the work already validated. A task is one reviewable
outcome: if it cannot be finished and checked in a single pass, it is a phase
and belongs in `ROADMAP.md`.

## Current phase

Phase 4: prove the platform seam against real leagues.

- [ ] Populate `client/fixtures.local.json` and run the full engine self-test.
  - Scope: copy `client/fixtures.example.json`, fill in real Sleeper league
    IDs, a keeper league, and a finished draft with its pick and keeper counts.
    Run `npm run engine:test` with the data service up.
  - Acceptance criteria: no suite reports "skipped". "Following a real draft"
    and "Reading a real league" both run and pass.
  - Automated validation: the self-test itself.
  - Manual validation: none required.
  - Dependencies or blockers: needs real Sleeper league IDs from the repository
    owner. Nothing else blocks it.

- [ ] Phase 5: follow a Yahoo draft through the browser. **Proven against a live
      mock 2026-09-04. A real league is what is left.**
  - Built: `main` merged into `yahoo-platform`; the frame decoder, the room
    store and the `yahoo` platform behind the seam; the ingestion route; the
    bridge userscript; the platform selector in the client; a Yahoo block in
    `engine:test`.
  - Acceptance criteria: every pick in a live Yahoo room appears on the board,
    in the right slot, against the right seat, with none unmatched. **Met in a
    mock, start to finish.** League 10720547, 14 teams, 15 rounds, followed from
    the first pick to the last: 210 picks, 210 joined, none unmatched, none off
    the board, pool falling 625 to 415. Checked rather than counted — overalls 1
    to 210 each present exactly once, all 14 seats holding exactly 15, no player
    taken twice, and every slot agreeing with a 14 team snake. The reader's own
    seat, 12, was taken from the room URL without being asked for, and the
    results screen graded all 14 rosters off those picks.
  - Two things the run proved that only a live room could. Round 8 put slot 14
    on pick 99 and slot 13 on pick 100, which is the reversal the 2026-09-04
    decision predicted from mock frames. And every position joined, defences
    included: Yahoo writes `Rams` against team `LA`, no name match could work,
    and `joinKey` resolved it on the abbreviation exactly as designed.
  - Automated validation: run and passing. `engine:test` replays the four real
    captures in `tools/yahoo/` plus a synthetic set that runs anywhere;
    typecheck, lint and build all clean. What this does *not* cover is the
    userscript, which no check touches — the live mock above is the only thing
    that has ever exercised it.
  - Manual validation: **the mock is done; a real league is not.** Everything
    known still comes from mock rooms, and that has to be rechecked before draft
    day.
  - Dependencies or blockers: none. Phase 4 is worth closing first rather than
    required.
  - Known gap, now closed: `tools/yahoo/dump/pool-10720547.json` holds a real
    `players/nfl/<league>` response, 1195 entries, so a Yahoo player ID can be
    joined to a real person offline.
  - Found while validating, and fixed: eight rows in that pool carry two
    positions in one field — `WR,RB`, `WR,TE`, `RB,TE` — which `normPos` passed
    through whole, so `joinKey` built `name|WR,RB` and matched nothing. All eight
    are fringe players with no ADP and none is reachable in a 14 team, 15 round
    draft, so it never fired in the live run; it would have put a stranger on the
    board the first time one went late in a deeper league. `normPos` now takes
    the first position of a pair, and the Yahoo self-test gives one pooled player
    a dual label so the case is covered — checked by reverting the fix and
    watching the check fail. Defences were never affected: Yahoo writes `DEF` and
    a team abbreviation, which is what `joinKey` already wanted.

- [ ] Decide whether the service should serve the userscript in a release.
  - Added while validating: `GET /userscript/yahoo-draft-bridge.user.js`, so a
    manager installs from an address and can pick up later versions instead of
    the user re-pasting a file. It is the install path the README now documents.
  - Worth a second look before release: it is the first static asset the service
    serves, and `@downloadURL` in the script hard-codes `127.0.0.1:5178`, which
    is wrong for anyone who moves the port.

## Blocked

- [ ] Yahoo's own Fantasy Sports API, if the application is ever approved.
  - Applied 2026-09-01, no published turnaround. Parked rather than pursued:
    the browser route needs none of it. Worth comparing for pre-draft league
    import if a key arrives, and worth closing out if it does not.

- [ ] Ask the upstream maintainer whether Yahoo support is wanted at all.
  - Not blocked by anything, and it decides where both branches land. See the
    2026-09-01 entry in `DECISIONS.md`.

## Completed

- [x] Phase 3: extract a platform seam, with Sleeper behind it.
  - Delivered on branch `yahoo-platform`, commit `9aa1d4b`. The two Sleeper
    modules moved to `server/src/platforms/sleeper/` at 98% and 99% rename
    similarity; routes take the platform as a path segment; ID validation moved
    onto the platform.
  - Validation run: `npm run typecheck` clean, `npm --prefix client run lint`
    unchanged from baseline, `npm run engine:test` all checks passed. Routes
    checked by hand for a malformed ID, an unknown platform, an encoded-slash
    traversal attempt, a well-formed unknown league, and the untouched board
    route.
  - **Validation skipped, and the risk it leaves:** the two self-test suites
    that call the moved code did not run, because `client/fixtures.local.json`
    does not exist. The evidence that the move is behaviour-preserving is
    therefore the rename similarity, the typecheck, and the by-hand route
    checks — not a test that exercised `leagueSetup`, `draftPicks`,
    `draftState` or `importLeague` against a real league. A regression in those
    four functions would not have been caught. The current-phase task above is
    what closes this.

- [x] Draft and submit the Yahoo API access application.
  - Submitted 2026-09-01. Draft kept at `tools/yahoo/access-application.md`,
    which git ignores.
