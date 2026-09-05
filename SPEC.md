# Project specification

What the project must do and the boundaries it stays inside. This document holds
requirements rather than implementation: a change to how something is built does
not belong here, and a change to what counts as correct does.

## Problem

A fantasy football draft is a live event with two failure modes, and neither is
addressed by the draft client the league already provides.

Before the draft, you cannot rehearse. Mock draft rooms exist, but they run on
their own ADP, their own roster shape and their own scoring, so the room you
practice against is not the room you will sit in. A league with keepers, traded
picks or a superflex slot is furthest from what a generic mock offers, and those
are the leagues where preparation matters most.

During the draft, you are reading two boards at once. Your own rankings live in
a spreadsheet, and the players still available live in the platform's draft
client. Reconciling them under a pick clock is where a prepared plan turns back
into guesswork.

Without this project you rehearse against the wrong room, then draft from a list
that goes stale the moment somebody else picks.

## Users

One user: whoever is drafting. They run both halves themselves on their own
machine.

Constraints they bring:

- They will not administer anything. Setup is a Node install and two commands.
- They will not create accounts or obtain API keys for the default path.
- They arrive with a ranking file somebody else published, in a format nobody
  agreed on, naming players in ways that do not match any feed exactly.
- During a live draft they have seconds, not minutes. Anything requiring
  attention away from the pick clock is unusable.
- Their league is theirs. Roster shape, scoring, keepers and draft order are
  facts to be read, not options to be offered.

## Required behavior

- A draft board of roughly 600 players, per scoring format and league size,
  built from free feeds and cached. Standard, half PPR, PPR, superflex and
  dynasty.
- Rookie drafts are **not** offered. Neither free source has usable rookie ADP,
  and a format that runs on nothing is worse than a missing one.
- Roster shapes from 2 to 16 teams and 1 to 30 rounds, snake, linear or third
  round reversal, with counters for QB, RB, WR, TE, FLEX, SUPERFLEX, K, DEF and
  bench.
- A real league's settings, seats, team names, declared keepers and traded picks
  are read from the platform rather than entered by hand.
- A user's own ranking file is matched against the board, the column holding the
  ranking is scored rather than guessed, and anything unmatched is listed with
  its closest candidates for the user to map once and keep.
- Player notes reach the board from a `Notes` column in a ranking file or from a
  separate notes file. The notes file wins, because a ranking export is replaced
  whenever its publisher updates.
- Keepers apply at both ends: the player leaves the board from pick one, and the
  pick that paid for him fills itself when it arrives.
- The assistant follows a real draft by polling, mirrors every pick, and
  simulates nothing of its own.

### Error, empty and recovery cases

- A pick of a player the board has never heard of still owns its slot, named
  from the pick's own metadata. A board with a hole in it no longer lines up
  with the real one.
- A draft order that has not been drawn yet is reported as not drawn. Nobody is
  told which seat is theirs on a guess.
- An ADP column with no entry for a player borrows from another format rather
  than dropping him, and the board records that it borrowed.
- When an upstream feed cannot be reached, a cached copy answers and is marked
  stale. With no cache, the failure is reported rather than served as an empty
  board.
- A ranking file with no usable ranking column, and a notes file with no notes
  column, are both refused rather than accepted silently.

## User experience

Two screens and a result. Settings, where a league is loaded and a room is
tuned; the draft board itself; and a grade at the end showing starting points
and picks gained against ADP for every team.

An anonymity toggle masks league names, league IDs, team names and every
manager's display name together. Masking a name while showing an ID masks
nothing.

The board is usable on a narrow screen, because a draft is often attended from
a phone.

## Architecture and data flow

The draft runs entirely in the browser. The service exists to reach feeds a
browser cannot call directly, cache them, and join them.

- Upstream, read-only: Fantasy Football Calculator (ADP, standard deviation, per
  league size) and Sleeper (projections, deeper pool, injury status). Neither
  requires a key.
- League platforms are read through `server/src/platforms/`, one directory each,
  behind a common five-method interface. A platform is pulled where its feed is
  open, and pushed where it is not: Yahoo answers only the user's own browser, so
  a userscript in their draft room posts to the service and the same five methods
  answer from what arrived. The service never holds a platform credential.
- The service holds a bounded disk and memory cache and no other state.
- Everything the user sets — leagues, rankings, notes, name mappings, keepers,
  the room's dials — is held in their browser.

## Security and privacy

- The service listens on the loopback by default and answers only that machine.
- Any stranger who can reach the service can name any league ID, so every ID is
  validated before it is pasted into an upstream URL, and the cache is bounded
  at both ends so that a stranger cannot decide its size.
- A league ID is enough to look up a league and read every manager in it, so
  seed leagues and manager names come from the environment and never from the
  source. A fresh checkout starts empty.
- No credential, token or secret is committed. Files naming real leagues or
  real people are ignored by git.
- Nothing the user sets leaves their browser.

## Performance and compatibility

- Node `^20.19.0 || >=22.12.0`. Node 21, and Node 22 before 22.12, are excluded.
- Upstream payloads are cached per feed, not per board: ADP for six hours,
  projections for twelve, a league's shape for thirty minutes, and rosters and
  traded picks for ten because both move up to the draft deadline. Last
  season's finished draft is held for a week, since it will not change again.
  A draft in progress is never cached at all, because it is stale the moment it
  is read.
- A pick must land immediately, which is why the engine runs client-side with no
  round trip.

## Non-goals

- No hosted service, no accounts, no database.
- No write access to any league platform. The tool never makes a pick; it is not
  an autodrafter.
- No auction drafts. An auction league is read, and warned that a snake is run
  instead.
- No individual defensive players. The ADP feeds do not rank them.
- No rookie-only drafts, per the required behavior above.

## Acceptance criteria

- `npm run typecheck`, `npm --prefix client run lint` and `npm run engine:test`
  all pass, with the data service running.
- `engine:test` runs its full set, including the two suites that need
  `client/fixtures.local.json`. A run where those skip does not satisfy this.
- A finished real draft replays pick for pick onto the board with no slot left
  empty and no player drafted twice.
- A league's imported settings match the league, and anything that cannot be
  modelled is reported as a warning rather than dropped.

## Unresolved questions

- Whether a real Yahoo draft behaves like a mock one. Every observation so far
  comes from the mock lobby. Answered by watching one real draft, and it must be
  answered before draft day rather than during it.
- Whether Yahoo exposes any equivalent of pre-draft traded picks. Nothing found
  so far, and nothing in the draft room suggests it. The draft order Yahoo sends
  already has them applied, so following a draft does not need them; setting up a
  mock of that league does.
- What Yahoo's `settings/nfl/<league>` holds. No capture has opened it, so a
  Yahoo import carries no roster shape and no scoring rules and says so.
- Whether the upstream project wants Yahoo support at all, now that it needs a
  userscript rather than an API key. Answered by the upstream maintainer. See
  `DECISIONS.md`.
