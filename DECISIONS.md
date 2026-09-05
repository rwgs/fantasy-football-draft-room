# Project decisions

Closed decisions that constrain future changes, newest first. Entries are
appended and never rewritten; a reversal is recorded by adding a new entry and
marking the old one superseded.

Record a decision only when it constrains future work and its rationale cannot
be recovered by reading the code. Routine implementation choices belong in the
diff. This project comments its own reasoning unusually thoroughly, so most of
what would otherwise land here is already next to the code it explains.

## 2026-09-05 The room's lean stays an absolute surplus

Status: Accepted. Reopens if the forecast is ever shown to mispredict a run at a
scarce position in a real draft.

### Decision

`observedLean` keeps counting a raw surplus of picks against a no-lean room and
scaling it by half a round, the same denominator for every position. It is not
changed to a relative measure, and scarce positions get no correction.

### Why

Reviewed because the reading under-states a scarce position badly. Recovering a
dial that was actually set, twelve teams, six seeds, three rounds in:

    RB  +4 reads 4.2    -4 reads -2.6
    WR  +4 reads 3.5    -4 reads -3.5
    QB  +4 reads 2.6    -4 reads -0.9
    TE  +4 reads 3.7    -4 reads -1.0

The quarterback fade is the worst of them and it is arithmetic rather than a
fault. A no-lean room takes about two quarterbacks in three rounds, so the
largest surplus a fade can produce is minus two, which is minus 1.67 on a dial
that runs to five. **A fade of something nobody drafts cannot be observed**, and
no scaling recovers information that was never in the sample.

Relative surplus was measured as the alternative and is worse. Divided by its
own expectation, the same dial reads four times higher at a scarce position than
an abundant one, and it is not stable with depth either:

    dial +2, relative surplus     3 rounds   5 rounds   8 rounds
      RB                              0.11       0.09       0.12
      QB                              0.46       0.30       0.18

The absolute measure is also the right currency for the job. The lean is fed
back into the dials to simulate the rest of the round, and what decides whether
a player survives is how many players actually leave the board, not how unusual
their position's share was.

The reading is monotonic and correctly ordered at every depth and every position
tested, so it never says forcing when a room is fading. That is the property the
forecast depends on.

### What this costs, and where it shows

`LEAN_WORTH_SAYING` is 1.2, so a hard fade of quarterbacks or tight ends is not
put into words until about the fifth round. That is a sentence not shown rather
than a number that is wrong, and it is least useful exactly when it is missing:
quarterbacks are barely being drafted in the first three rounds anyway.

The reading also inflates with depth, because the surplus accumulates while the
denominator does not: a dial of +2 reads 1.6 after three rounds and 3.6 after
eight, and +3, +4 and +5 are indistinguishable by then. Left alone because the
forecast only ever runs to your next pick, and because the computer teams' own
roster need already pulls them off a position they have filled.

### Also

`engine:test` reads the quarterback lean at four rounds rather than three, for
the reason above. Do not fold it back to match the other positions.

## 2026-09-05 The panel is a bookmarklet, not part of the bridge

Status: Accepted. Supersedes the shipping half of the entry below, which put the
panel inside the userscript. The reasoning there about who computes what stands.

### Decision

The panel lives in `userscript/draft-panel.js` and is installed as a bookmarklet
from `http://127.0.0.1:5178/panel`. The bridge userscript went back to one job:
carrying frames. It draws nothing.

### Why

They need different privileges and should not share a fate. The bridge has to be
injected at `document-start`, because it wraps `WebSocket` before Yahoo's bundle
builds one, and only a userscript manager can do that. The panel needs a DOM and
one address on the loopback. Putting it in the userscript gave a thing needing no
privileges every failure mode of a thing that needs several.

That is not hypothetical. The panel spent an entire live draft invisible while
the bridge in the same file posted every pick correctly. The manager reported the
script as up to date, the served file was right, and the body being executed was
not. Nothing about the panel could be debugged, because the only way to change it
was through the mechanism that was broken.

A bookmarklet has no install, no update, no version, and no manager. It is the
source, run when clicked.

### Cost, stated plainly

One click per page load, where a userscript would have been none. That is the
price of the panel not being able to fail silently and invisibly, and on the
evidence it is worth paying.

### Rejected

Keeping a copy in both places. Two implementations of one panel drift, and the
argument against a second copy of the pricing in the service applies here for the
same reason.

## 2026-09-05 The bridge also shows, and still decodes nothing

Status: Accepted. Widens `The bridge carries, the service decodes` below, which
made the bridge one-way.

### Decision

The Yahoo userscript now draws a small panel in the draft room showing what the
board makes of the pick. It still decodes nothing and resolves nobody: it reads
one endpoint on the loopback and paints the words it is handed.

The reading is worked out in the client, posted to the service, and collected
from the service by the bridge. The service holds it and forms no opinion about
it.

### Why

The earlier entry split the work by what each part is able to do: only the
browser can reach Yahoo, so the browser carries; only the service can decode
without shipping a parser into a page we do not own, so the service decodes.
Nothing in that reasoning said the bridge may not display, and the case for it
is the same one that justified the bridge at all. Yahoo answers only the tab the
user is sitting in, and that tab is also the only surface where an answer can be
put in front of them without asking them to look away from the pick clock.

The engine stays in the client for the reason it was put there. Pricing a pick
needs the board, the rosters and a hundred and fifty simulations of the room,
and moving that into the service would either duplicate it or move the whole
draft off the browser. Neither is worth a panel. So the client computes, and the
service is a pigeonhole between two things that cannot address each other: the
app is a page on this machine, the bridge lives on Yahoo's origin.

### What it must never cost

A panel over a real draft is only acceptable if it cannot break the draft under
it. The bridge already held that rule for frames, and it now holds for drawing:

- One element appended to the body of the top frame, holding a shadow root.
  Yahoo's own nodes are never read, moved or restyled, and no stylesheet crosses
  either way. The top frame rather than the bridge's own, because Yahoo runs the
  draft in an iframe and `position: fixed` inside one is fixed to the frame's box
  rather than to the window: pinned to the bottom left of a frame taller than the
  window, the panel is drawn where nobody can see it.
  Open rather than closed: the wall is the shadow root and not the mode, and
  closing it hides the panel from devtools as well, which costs whoever is
  working out why they cannot see it more than it ever cost a stray stylesheet.
- Everything in it is `pointer-events: none` bar the button that hides it, so it
  cannot swallow a click meant for the draft. This is checked in a real browser
  rather than asserted.
- No key handler, no focus, no storage, and nothing sent to Yahoo.
- Every fault swallowed. A broken panel paints nothing and the draft continues.

### Rejected

Parsing Yahoo's own player list and marking it up in place. It reads better and
binds the tool to markup nobody promised, which can change in a deploy in the
middle of a draft. `docs/yahoo-draft-protocol.md` already carries that risk for
the frames, where the payoff is every pick; carrying it again for a decoration
is a bad trade.

Computing the advice in the service, which would put a second implementation of
the pricing behind the same question and let the two disagree.

## 2026-09-05 FantasyPros is not a source on the free tier

Status: Accepted. Reopens only if someone holds a paid key.

### Decision

The board is not built from FantasyPros. `server/.env` still recognises
`FANTASYPROS_API_KEY` because the file is where any machine-local setting
belongs, but nothing reads it and no source module exists.

### Why

The free tier returns ten rows. Not ten per position, and not the top ten: ten
in all, whatever was asked for.

Measured on 2026-09-05 with a real key, two requests:

    GET /nfl/2026/rankings?week=0    count 1782   returned 10
    GET /nfl/players?external_ids=…  count 8545   returned 10

Both replies say so themselves, in `limit: 10`, `public_api_limited: true` and
`tier: "free"`. The ten from the rankings call were the first ten defences in
alphabetical order, so it is not even a useful ten. No amount of caching helps
with data that does not arrive, and this app needs five hundred players deep for
the late rounds of a fifteen round draft.

The terms are not the obstacle, which is worth recording so nobody re-reads them
hoping otherwise. Personal, non-commercial use of a locally run tool is squarely
inside them, fifty requests a day is generous against a board cached for hours,
and the attribution they ask for already has a home in the interface. The
obstacle is only the row cap.

### What is lost, and what would reopen it

The shape of the data is close to ideal, which is why this is worth a record
rather than a shrug. One row from `/nfl/players` carries `rank_ecr`, `rank_adp`,
`rank_ecr_ppr`, `rank_adp_ppr` and `rank_ecr_half` — expert consensus and ADP
for every format this app offers — alongside `yahoo_id` and `espn_id`. Those two
would replace the six matching tiers in `names.js` with an authoritative join,
and the Yahoo bridge currently matches picks by name because nothing better
exists.

So: a paid key, which the docs advertise as five hundred requests a day and full
responses, would make this the strongest source available and would be worth
taking. Nothing else changes the answer.

### What was rejected with it

Building a consensus board around FantasyPros instead of around ESPN. ESPN
stays, and the entry it replaces was never written because ESPN landed first.

## 2026-09-04 The bridge carries, the service decodes

Status: Accepted. Narrows the entry below, which left the split unstated.

### Decision

The Yahoo userscript fetches the player pool and the seats once, and forwards
the draft socket's frames as the raw text Yahoo sent. It decodes nothing and
resolves nobody. `server/src/platforms/yahoo/frames.js` decodes the frames and
`index.js` joins them onto the board.

### Why

The constraint is that only the browser can *reach* Yahoo. It does not follow
that the browser must also *interpret* Yahoo, and the two were conflated in the
first plan, which had the userscript resolve each pick to a person before
sending it.

Decoding is the part most likely to be wrong and most likely to break, because
the frame format is Yahoo's private protocol and nobody promised it. Put it in
the userscript and it can only be tested by drafting; put it in the service and
`npm run engine:test` replays four real captures through it offline, every run,
for free. That is the whole argument, and the captures already existed.

It also makes the part that has to be trusted small. A userscript runs inside a
tab holding the user's Yahoo session, so the less it does the better. What is
left is: hook `WebSocket`, copy strings aside, POST them.

### Rejected alternatives

- **The userscript resolves picks**, as first planned. Rejected: it puts the
  fragile code where no test can reach it, and grows the script that runs beside
  a live session.
- **Duplicating the decoder** on both sides, canonical copy tested. Rejected:
  two copies of the one function most likely to change is the worst of both.

### Consequences

- The service holds a league's player pool in memory while a draft runs. Never
  on disk: it is one person's league, and it is stale the moment the draft ends.
- The bridge must be told to resend the pool after a service restart, so the
  ingestion reply carries `needPool`.
- `POST /api/:platform/room/:id` exists, and is the only route written to. It is
  offered to platforms exposing `ingest` and refused for the rest, so the router
  still names no platform.
- Yahoo is a *pushed* platform behind a seam designed for pulled ones. The five
  methods still fit; `draftPicks` reads memory instead of fetching.

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

Against live 14-team public mocks on 2026-09-04, using the tools in
`tools/yahoo/`. Public, so the rooms held real people drafting in real time,
about half the seats at a time. Everything here was watched happening, not read
in a document. The frame-by-frame
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
- **Whether a configured league behaves like a public mock.** Not the room
  itself, which held real people: human drafting, pick timing, autopick on
  inactivity and the reconnect burst are observed. What is unseen is a league
  someone set up — keepers, traded picks, a commissioner's roster and scoring,
  any format but 14-team snake. Cheap to recheck and must happen before draft
  day.

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
