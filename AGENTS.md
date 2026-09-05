# Project instructions

The conventions an agent needs in every session for this repository, loaded
automatically rather than pointed at. Keep it short enough to follow: a rule
earns its place by preventing a repeat mistake or recording durable project
behavior, and reference material belongs under `docs/`.

## Purpose

A fantasy football draft tool with two modes. **Mock draft** simulates a room
against you: live ADP for your scoring format, any roster shape, your own
ranking file, and dials for how hard the computer teams lean on each position.
**Draft assistant** simulates nothing: it follows a real draft as it happens,
mirroring every pick onto the board so your rankings and availability always
face the actual room.

Users run it themselves, on their own machine. There is no hosted copy, no
account, and no database. Every setting a user makes stays in their browser.

## Architecture

Two halves. The draft itself runs in the browser, because a pick has to land
the instant it is clicked and nothing about a draft needs a server round trip.
The service exists only to reach feeds a browser cannot call directly, cache
them, and join them so the client never guesses whether two records name the
same player.

- `client/` — React and Vite, port 5177. Proxies `/api` to the service, so the
  browser sees one origin and never meets CORS.
  - `src/engine/` — the draft itself: order, CPU behavior, rosters, keepers,
    grading, survival odds. No network calls, which is what makes it testable.
  - `src/components/` — the setup, draft and results screens.
  - `src/storage.ts` — everything the user sets, in their own browser.
- `server/` — Express, port 5178, loopback only by default.
  - `src/sources/` — the two upstream feeds: Fantasy Football Calculator for
    ADP and standard deviation, Sleeper for projections and a deeper pool.
    Neither asks for a key.
  - `src/board.js` — joins those two into one board per format and league size.
  - `src/names.js` — the one place that decides when two records name the same
    player. Defences join on team abbreviation, everyone else on name and
    position.
  - `src/rankings.js` — six matching tiers for a user's own ranking or notes
    file, plus the column scoring that picks which column holds the ranking.
  - `src/platforms/` — one directory per league platform, each answering the
    same five questions. See `DECISIONS.md` for why this seam exists.
  - `src/cache.js` — disk and memory cache, bounded at both ends because any
    stranger can name a league ID and each one is a new key.
- `userscript/` — the Yahoo draft bridge, which runs in the user's own browser
  because Yahoo answers a session cookie the service must never hold. It is
  installed by hand into a userscript manager, not built or served from here.
  Sleeper needs nothing like it.

Nothing is generated or built into the tree. `client/dist` is a build output
and `server/data/cache` is a cache; neither is edited by hand.

Toolchain: Node `^20.19.0 || >=22.12.0`. The range has a hole — Node 21, and
Node 22 before 22.12, will not run it.

## Working boundaries

- Leave unrelated changes exactly as found. Every changed line traces to
  something the request asked for, so raise a simpler approach or an unrelated
  defect rather than acting on it.
- Make the smallest change that solves the stated problem. Add no speculative
  feature, abstraction for a single call site, configuration knob, or handling for
  a case that cannot occur.
- Match the naming, layout, and style already in the file, even where a different
  approach would be the better call in a new project.
- Remove what the change orphans, such as an import nothing uses. Leave
  pre-existing dead code alone unless asked to remove it, and mention it where it
  matters.
- Never commit or print credentials, sessions, private data, or environment
  files.
- Ask before destructive work. Deleting, overwriting, resetting, force-pushing,
  migrating, and deploying are not implied by a request to fix something.
- Ask before a change that settles a product or architecture question, rather
  than implementing one already settled.

## Before editing

- State the plan, or what success looks like, before editing, as a check that can
  fail rather than a description: the test that reproduces the bug, the test for
  the input that must be rejected, the same tests passing either side of a
  refactor. Pair each step of multi-step work with the check that confirms it.
- Stop at any ambiguity in the request, before editing anything. Name what is
  unclear and the readings it admits, and wait for an answer rather than picking
  one silently or proceeding on the likeliest reading.
- An unread fact is not an ambiguity. Read the code or run the command that
  settles it, and state any assumption that changes the result.
- Say when a simpler approach than the one asked for would do, and challenge a
  wrong premise before building on top of it.

## Commands

npm, from `package-lock.json`. Run these from the repository root; the root
scripts delegate with `--prefix`.

```bash
npm run install:all      # root, server and client. Needed before anything else.
npm run dev              # both halves at once. Client on 5177, service on 5178.
npm run start            # the data service alone, on 5178, in the foreground.
npm run serve            # say what is on 5178, offer to restart or stop it
npm run serve -- status  # or start, stop, restart. Windows: .\serve.ps1 status

npm run typecheck        # tsc against both the app and the test config
npm --prefix client run lint    # oxlint
npm run engine:test      # the engine self-test. See below: needs the service up.
npm run server:test      # node --test, for service code no endpoint can show
npm run build            # tsc -b, then the Vite production build
```

`npm run server:test` is for the service's own internals, and it is the smaller
half on purpose: anything reachable through an endpoint belongs in the engine
self-test with the rest, because that is where a check meets the code the way a
caller does. What lands here is what a caller cannot see, such as two requests
racing for one cold cache key. It talks to nothing and needs no service running.

`npm run engine:test` fetches a real board from `http://localhost:5178`, so the
data service has to be running or every check fails at the first fetch. Bring
one up with `npm run serve`, or use `npm run dev` for both halves.

Two of its suites — "Following a real draft" and "Reading a real league" — skip
unless `client/fixtures.local.json` exists. They are the only checks that
exercise `server/src/platforms/`, so a green run without that file says nothing
about league or draft code. Copy `client/fixtures.example.json` and fill it in;
git ignores it because it names real leagues and real people.

Port 5178 is easy to leave occupied by a previous run, and the trap is not the
busy port, which announces itself. It is that a service left running from an
earlier session answers `/api/health` perfectly well while serving code that has
since changed, so a check passes against the old build and says nothing about
the new one.

`npm run serve -- status` is the answer to that. It reports the pid, how long
the process has been up, and whether anything under `server/src` has changed
since it started, which is the question worth asking before trusting a run. Use
`npm run serve -- restart` rather than hunting the process, and prefer it to
killing a port by hand. It refuses to touch a port held by something that is not
this service.

Run without an action it reports and then offers the choices that apply, and
starts the service when nothing is up. Piped or run by an agent it reports and
changes nothing rather than blocking on a prompt nobody will answer.

## Validation

- Run the focused check while implementing.
- Run the complete required local gate before reporting done.
- Inspect the final status and diff, and confirm every changed line traces to
  something the task asked for.
- Verify visible behavior with screenshots or equivalent rendered output.
- Report skipped checks and outstanding manual testing rather than omitting
  them.

## Documentation routing

- `SPEC.md` for requirements and acceptance criteria.
- `ROADMAP.md` for phase order and exit criteria.
- `TASKS.md` for current work and validation status.
- `PLAN.md` for the approach behind the change currently in flight.
- `DECISIONS.md` before changing an area it constrains, and before proposing an
  approach it already rejected.
- `docs/` for reference material: things that are true about the world rather
  than decisions about this project. `docs/yahoo-draft-protocol.md` is what a
  Yahoo draft room sends and when, none of which Yahoo documents. Read it when a
  task points at it, not by default.
- `README.md` is where a human or an agent arriving cold starts, and it owns none
  of the above. It links to these documents, and to the files it describes,
  rather than restating them: an explanation kept away from what it explains
  drifts from it silently.
