# Yahoo league support

Approach for the change currently in flight. Replaced when the next non-trivial
change begins, so anything that must outlive this change is promoted first.

Branch: `yahoo-platform`. Phase 3 of `ROADMAP.md` is committed; Phase 4 is the
next actionable step and Phase 5 is blocked.

## Problem

The tool reads exactly one league platform. Loading a real league — its roster
shape, scoring, seats, team names, keepers and traded picks — works for Sleeper
and for nothing else, and the draft assistant follows a Sleeper draft or no
draft at all. A user who plays in Yahoo gets the mock draft room, their own
rankings and the grade, and none of the features that make the tool worth
running during an actual draft.

Sleeper is also wired straight through the service's routes, so there is no
place a second platform could be added without duplicating them.

## Constraints discovered

Each of these was verified this session rather than assumed.

- **Most of the app is already platform-neutral.** "Sleeper" names two unrelated
  things here: a *data feed* (`server/src/sources/sleeper.js`, projections and
  ADP) and a *league platform*. Only the second is coupled. The board, rankings,
  notes, engine and grading are untouched by this work, and a Yahoo user keeps
  the Sleeper data feed either way. Verified by reading the imports.

- **Yahoo requires OAuth 2.0 with a confidential client.** Consumer key and
  secret, tokens expiring in 3600 seconds, refresh tokens for renewal. The
  secret cannot live in the browser, so the token exchange is server-side.
  Verified from Yahoo's OAuth 2.0 guide.

- **Yahoo API access is gated behind human review.** "Fantasy Sports" does not
  appear in the permissions list when registering an application; access comes
  from a reviewed application instead. This is the constraint that shaped the
  whole approach, and it was expensive to discover — it is invisible until you
  reach the registration form and find the permission missing. Verified from
  `https://sports.yahoo.com/developer/access/` and from the registration form
  itself. Applied 2026-09-01.

- **Yahoo's `draftresults` is documented to populate mid-draft**: "if this is
  called during the draft this includes the players that have been drafted thus
  far." Each pick carries `pick`, `round`, `cost`, `team_key` and `player_id`.
  Verified from library documentation only, **not** against a real draft. The
  assistant mode depends on it entirely.

- **Yahoo player keys are useless to this board.** Sleeper's pick payloads carry
  Sleeper player IDs, which *are* the board's IDs, so the join is direct
  (`server/src/platforms/sleeper/draft.js`). Yahoo's `nfl.p.12345` means
  nothing here, so every Yahoo pick has to go through the name, position and
  team matching in `server/src/names.js`.

- **Traded picks and pre-draft draft state appear absent from Yahoo.** No
  equivalent of Sleeper's `traded_picks` was found, nor of a draft order that
  can be read before the draft opens.

- **Yahoo's JSON is a mechanical conversion of its XML**, nesting collections in
  `{"0": {...}, "count": n}` pseudo-arrays.

## Approach

Three steps, in order, each landing on its own.

**1. Extract the seam. Committed as `9aa1d4b`.** Move
`server/src/sleeperLeague.js` and `server/src/sleeperDraft.js` into
`server/src/platforms/sleeper/` unchanged, add an adapter exposing the five
methods those files already provide, and add an explicit registry. Change the
routes in `server/src/index.js` to take the platform as a path segment, which
keeps every existing URL working and leaves `client/src/api.ts` untouched. Move
ID validation onto the platform. Reuse `cached()`, `buildBoard()` and the
`names.js` helpers exactly as they are.

**2. Close the verification gap.** Populate `client/fixtures.local.json` and run
the full self-test, so step 1 is proven rather than inferred.

**3. Implement Yahoo, once approved.** Run `tools/yahoo/probe.mjs` against a
real league first and design from the dumped JSON rather than from the notes
above. Then a `yahoo` platform directory implementing the same five methods,
an OAuth callback route, the secret in the user's own `server/.env`, and picks
joined through `names.js`.

## Trade-offs

- **A registry with one entry.** Until step 3 lands, this is an abstraction with
  a single implementation, and its justification is pending. Accepted because
  the alternative — extracting the seam and implementing Yahoo in one diff —
  mixes a provable refactor with unprovable new network code.

- **The seam is shaped around Sleeper.** The five methods are Sleeper's, and
  Yahoo may not fit them: it has no traded picks and no readable pre-draft
  state. Expect the interface to bend when the second implementation arrives.
  Deliberately not designed around a Yahoo shape that has not been observed yet.

- **Yahoo support helps almost nobody.** See `DECISIONS.md`. The honest position
  is that this is a personal feature in a public repository, and it will be
  documented as one.

- **Surviving risk:** if `draftresults` turns out not to populate live, the
  assistant mode — the reason to build this — does not work for Yahoo, and the
  phase delivers league import alone. This is known and unresolved, and it is
  cheap to check the moment access is granted.

## Verification

**Automated.**

- `npm run typecheck` — catches a broken import or a changed shape after the
  move. Run, clean.
- `npm --prefix client run lint` — run; warnings unchanged from baseline and all
  pre-existing in `App.tsx`.
- `npm run engine:test` — run, all checks passed, **but two suites skipped**.
  See below.

**Manual, and run.** Against the service on the refactored code: a malformed ID
returns the original 400 and message; a well-formed ID Sleeper does not hold
returns the upstream 400; an unknown platform returns 404 listing the known
names; an encoded-slash traversal attempt is still refused; the untouched board
route still answers 200. `/api/health` reporting `platforms` was used to confirm
the service under test was the new code and not a stale process on port 5178 —
which it initially was, invalidating the first run of these checks.

**Not verified, and the specific failure it would catch.** The self-test suites
"Following a real draft" and "Reading a real league" skip without
`client/fixtures.local.json`. They are the only automated checks that call
`importLeague`, `leagueUsers`, `leagueSetup`, `draftState` or `draftPicks` — in
other words, every function this change moved. A regression inside those
functions would pass everything that was run. The rename similarity of 98% and
99% shows the files were not meaningfully edited, which is evidence but not a
test. Closing this is the current task in `TASKS.md`.

**Cannot be verified in this environment.** Nothing about Yahoo, until access is
approved. No Yahoo endpoint answers without it, so every Yahoo statement in this
document is from documentation rather than observation, and is marked as such.
