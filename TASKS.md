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

- [ ] Phase 5: follow a Yahoo draft through the browser. **Code complete, not
      yet proven against a live room.**
  - Built: `main` merged into `yahoo-platform`; the frame decoder, the room
    store and the `yahoo` platform behind the seam; the ingestion route; the
    bridge userscript; the platform selector in the client; a Yahoo block in
    `engine:test`.
  - Acceptance criteria: every pick in a live Yahoo room appears on the board,
    in the right slot, against the right seat, with none unmatched. **Not met
    yet** — see the manual validation below, which is what meets it.
  - Automated validation: run and passing. `engine:test` replays the four real
    captures in `tools/yahoo/` plus a synthetic set that runs anywhere;
    typecheck, lint and build all clean. What this does *not* cover is the
    userscript, which no check touches.
  - Manual validation: **outstanding.** A live mock beside the app, then a real
    league before draft day. Until that runs, the bridge is unproven code.
  - Dependencies or blockers: none. Phase 4 is worth closing first rather than
    required.
  - Known gap worth closing while mocking: keep one `players/nfl/<league>`
    response. No capture has one, so nothing has ever joined a real Yahoo player
    ID to a real person.

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
