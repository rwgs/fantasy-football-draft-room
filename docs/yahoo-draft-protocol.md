# Yahoo's draft room, as observed

Reference for the feeds a Yahoo draft room uses, written down because nothing
documents them and the next person to look — including a later version of
whoever wrote this — would otherwise start from scratch.

Everything here was watched happening, using the tools in `tools/yahoo/`,
against mock drafts on 2026-09-04: leagues `10711906`, `10713141` and
`10713845`, all 14-team snake. Nothing here comes from Yahoo documentation,
because none covers it.

**None of this is promised by Yahoo.** It is the private protocol between their
draft client and their draft server. It can change in any deploy, without
notice, mid-draft. Treat every line below as a description of one afternoon, not
as an interface.

Each entry is marked **observed** where it was seen directly, or **inferred**
where it is a reading of what was seen. The distinction matters: an inference
that turns out wrong puts a hole in a live draft board.

## Authentication

The draft room uses `pub-api.fantasysports.yahoo.com/fantasy/v3/`, which is not
the OAuth-gated `fantasysports.yahooapis.com` Fantasy Sports API. It
authenticates on the browser's session cookie alone. **Observed:** identical
requests return `200` from inside the room and, without the cookie,

```
HTTP 403  {"description": "Unable to retrieve cookie."}
```

There is no key, no token and no registered application anywhere in the flow.
The consequence is that only code running in the user's own browser can read
any of this, which is what shapes the whole design. See `DECISIONS.md`.

## REST endpoints

All take a bare numeric league ID, all need the cookie.

| Endpoint | Holds |
|---|---|
| `players/nfl/<league>` | The draftable pool. `service.player_list`, 1195 entries |
| `teams/nfl/<league>` | The seats. `service.team_list` with `id`, `teamname`, `managers[].nickname` |
| `settings/nfl/<league>` | League settings |
| `draftstatus/nfl/<league>` | `draft_status`, and the `draft_server` / `draft_port` to connect to |

A player entry carries `id`, `player_key` (`470.p.7200`), `fname`, `lname`,
`display_pos`, `team_abbr`, `bye`, `inj`, Yahoo's own ADP (`average-pick`,
`percent-drafted`, `auction-value`) and projected `season.points`.

**Observed: no REST endpoint carries draft state.** The pool stays at 1195
entries with drafted players still in it and no field marking them gone;
`percent-drafted` and `average-pick` are historical ADP, not live. `draftresults`,
`draft`, `picks` and `draftpicks` do not exist — they fail the CORS preflight
rather than returning 404, which is what a missing path looks like from a page.
**The socket below is the only source of picks.**

## The room URL

```
https://football.fantasysports.yahoo.com/draftclient/f1/<league>/<team>?auth=<token>
```

**Observed:** it names the league and the reader's own team, and team number is
draft slot, so a client never has to ask which seat belongs to the user.

**Observed:** `auth` is single-use. Reloading the URL does not reconnect, it
leaves the draft. Anything running in the room must attach to the page as the
lobby opened it, and can never navigate there itself.

## The socket

`draftstatus` gives `draft_server` and `draft_port`; the client connects to
`wss://<draft_server>/`. **Observed:** the address is assigned per connection
and changed between sessions, so it cannot be hard-coded.

Frames are pipe-delimited text, one record per frame.

### Sent by the client

| Frame | Meaning |
|---|---|
| `8\|<league>\|<team>\|<url-encoded user agent>` | Hello, sent immediately on open. **Observed** |

### Sent on connect, in this order

| Frame | Meaning |
|---|---|
| `H\|S\|30\|0\|0\|<started>` | Settings. `S` is snake and `30` the seconds per pick — both **inferred**, and both agree with the order and clock actually seen. The last field is **observed** to be `0` before a draft opens and `1` on reconnecting to one in progress. The middle two zeros are unknown |
| `R\|<team>\|<team>\|…` | **The entire draft order**, one entry per pick, in pick order. **Observed** at exactly 210 entries for a 14-team, 15-round league, running `1..14, 14..1, …` |
| `Q` | Unknown. No payload |
| `A\|14=0\|13=2\|12=0\|11=1\|…` | One value per seat. **Observed** taking `0`, `1` and `2`, so it is not a boolean and the obvious "autopick on/off" reading is wrong. Meaning unknown |
| `P\|<overall>=<player>,<team>,<cost>\|…` | **Every pick made so far.** Empty on a draft that has not started, which is why it first appeared as a bare `P`. See below |
| `w\|3600\|20` | Unknown. `3600` looks like a limit in seconds |

Two of these carry the state a client needs to catch up, and both are
**observed**, on a reconnect into a draft 91 picks deep.

`R|` gives the order rather than implying it. A league with keepers, traded
picks or a custom order should be read from here, and deriving the order from a
snake would be silently wrong for exactly those leagues.

`P|` replays the picks. Its records are `<overall>=<playerId>,<teamId>,<cost>` —
the same fields as a live `0|` pick in a more compact form, so one decoder
handles both with a little care about the ordering of the fields. This is what
makes a mid-draft reload survivable: a client reconnects and is told everything
it missed, so nothing has to be remembered across a crash.

### Sent while the draft runs

| Frame | Meaning |
|---|---|
| `0\|<overall>\|<playerId>\|<team>\|<rosterSlot>\|<cost>` | **A pick.** The only frame the bridge needs. **Observed** |
| `D\|<overall>\|<team>\|<seconds>` | The clock passing to a seat. **Observed** |
| `C\|<seconds>` | Clock ticking down. **Observed** counting 30, 24, 18 |
| `J\|<team>` | A manager connected. **Inferred** from timing |
| `L\|<team>` | A manager disconnected. **Inferred** from timing |
| `G\|[…]` | Yahoo's own grade for a pick, as JSON: `letterGrade`, `score`, weighted components with explanations |
| `g\|[…]` | Yahoo's own grade for each **team**, as JSON: `teamId`, `score`, `letterGrade`, `pickCount`, `basis`. Lowercase, and a different frame from `G\|` |
| `5\|<n>`, `X\|<n>`, `6\|…` | Unknown, single numeric payload |
| `O\|draft-labels\|<overall>\|[…]` | Yahoo's own value labels, as JSON: `BEST_VALUE` and similar, with a `reason` and `signals` |

`playerId` matches `id` in `players/nfl/<league>`, which is how a pick becomes a
person. `rosterSlot` is the slot filled, including flex as `W/R/T`. `cost` was
`0` throughout every snake draft watched; presumably it is the price in an
auction, **inferred and untested**.

### What this means for reading picks

Filter for `0|` and discard everything else. Seven of the ten frame types are
irrelevant to a board, so Yahoo adding, removing or changing them cannot break
a bridge that only reads picks. That is the main reason to prefer the socket
over the DOM, whose class names are build-hashed and change on any deploy.

## Joining onto this project's board

A pick names a Yahoo player ID, and only `players/nfl/<league>` maps it to a
person, so whatever reads the socket must also hold the pool.

Once resolved, no new matching code is needed. `server/src/names.js` takes it as
it stands, **verified against the normalisers rather than assumed**:

- `normTeam("Pit")` gives `PIT`, and `TEAM_FIX` already covers Yahoo's `Jac` and
  `Was`
- `normPos` passes `QB`, `K` and `DEF` through unchanged — Yahoo says `K`, not
  the `PK` the kicker rule exists for
- `normName` handles `Kyle Pitts Sr.` through its suffix rule
- defences join on team abbreviation, so their naming never matters

So `joinKey(fname + ' ' + lname, display_pos, team_abbr)` is the whole join. The
abbreviated names shown on screen (`C. Olave`) are a display style; the data
carries `fname` and `lname` in full. This matters because `forenamesAgree` needs
three shared opening letters and would reject `C.` against `Chris`, so a bridge
reading the screen rather than the feed would fail on names the feed gets right.

## Captures

`tools/yahoo/` holds raw captures, and git ignores all of it because it names
real leagues and real people:

| File | Holds |
|---|---|
| `capture-mock1.log` | 111 picks, mid-draft onward |
| `capture-mock2.log` | 96 picks from pick 3 |
| `capture-mock3-handshake.log` | A connect sequence from `[ws-open]`, and a bare `P` before a draft opened |
| `capture-mock3-reconnect.log` | A reconnect into a draft 91 picks deep: the `R\|` order and a populated `P\|` |

These are enough to test a decoder offline, which matters because the
alternative is testing it during a draft. `npm run engine:test` replays all four
when they are present, and falls back to synthetic frames when they are not.

**The pool was never captured.** The watcher records response bodies, but no run
kept the body of `players/nfl/<league>`, so nothing here maps a real Yahoo player
ID to a real person. A decoder can be checked against these files; a *join* onto
the board cannot, and is tested against a synthesised pool instead. Keeping one
pool response would close that gap.

## Still unknown

- **What `Q`, `w|`, `5|`, `X|` and `6|` are.** None is needed to read picks.
- **What `A|` means**, now that it is known not to be a boolean.
- **What the two middle `H|` zeros mean**, and whether `S` becomes something
  else for an auction or a linear draft.
- **What `cost` holds in an auction.** It was `0` in every snake draft watched.
- **Whether a real league behaves like a mock.** Every observation here is from
  the mock lobby, and this must be rechecked before a real draft.
