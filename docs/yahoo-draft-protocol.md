# Yahoo's draft room, as observed

Reference for the feeds a Yahoo draft room uses, written down because nothing
documents them and the next person to look — including a later version of
whoever wrote this — would otherwise start from scratch.

Everything here was watched happening, using the tools in `tools/yahoo/`,
against mock drafts on 2026-09-04: leagues `10711906`, `10713141` and
`10713845`, all 14-team snake. Nothing here comes from Yahoo documentation,
because none covers it.

**A mock here means a public mock, not a simulation.** The rooms held real
people drafting in real time, about half the seats at a time: the `A|` frames
captured from `10713845` read seven of fourteen seats live at the open and
eight of fourteen ninety-one picks later. That is what makes these captures
worth anything. Human pick timing, seats falling to autopick when someone
stops acting, and the reconnect burst are all behaviour of a real room, not of
a lobby full of bots. What a mock is not is a league that counts, and
`Open questions` below says which parts of this document that leaves untested.

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
| `A\|14=0\|13=2\|12=0\|11=1\|…` | One value per seat. **Observed** taking `0`, `1` and `2`. `1` is **observed once** to mean autopick, and `2` is still unknown. See below |
| `P\|<overall>=<player>,<team>,<cost>\|…` | **Every pick made so far.** Empty on a draft that has not started, which is why it first appeared as a bare `P`. See below |
| `w\|3600\|20` | Unknown. `3600` looks like a limit in seconds |

Two of these carry the state a client needs to catch up, and both are
**observed**, on a reconnect into a draft 91 picks deep.

#### What `A|` says, as far as it is known

`1` is autopick. Read on 2026-09-05 by rejoining a 14-team mock from a seat
already known to be in autopick, put there by Yahoo for inactivity, and reading
that seat back out of the connect burst:

    A|14=1|13=1|12=1|11=1|10=0|9=1|8=1|7=1|6=0|5=0|4=1|3=1|2=1|1=1
         ^ the seat known to be autopicking

Three seats read `0`, late in a room that had been filling with autopickers for
an hour. That agrees with the seat counts at the top of this document, which
read `0` as a manager still acting — seven of fourteen at one open, eight of
fourteen ninety-one picks later, in rooms of real people. Counting zeros as live
seats was an inference when it was written; `1` being autopick is now observed
directly, and the two readings are the same reading.

**`2` remains unknown.** It has appeared once across every capture taken, on a
seat whose state nothing independent established. So this is a three-state field
with two states identified, and the plain "autopick on or off" reading is still
wrong.

None of this reaches the board. The bridge forwards `0`, `H`, `R` and `P` only,
and a frame it drops cannot break it — which is why `A|` had to be read with a
recorder injected beside the bridge rather than from anything the service holds.

`A|` is sent **once, in the connect burst, and never again** when the state it
reports changes. A client cannot watch a seat flip; it can only reconnect and
read the value afresh, which is how the reading above was taken.

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

### What a pick's timing says

**Observed**, from `dump/frames-2026-09-05T03-16-12-613Z.jsonl`, the one capture
carrying wall-clock timestamps. Measuring each pick as the gap between the `D|`
that passed the clock and the `0|` that filled it, over 52 picks of a 14-team
room:

| seat | picks | under 1s | median |
|---|---|---|---|
| 1 | 2 | 0 | 7.72s |
| 2 | 2 | 0 | 22.40s |
| 5 | 4 | 4 | 0.57s |
| 9 | 4 | 0 | 19.37s |
| 13 | 4 | 4 | 0.96s |
| 14 | 4 | 4 | 0.89s |

Six of fourteen seats never took more than a second and four never took less
than two, and two picks landed inside 100 ms, which is faster than a click. So
automation is legible **per seat rather than per pick**: a seat is consistently
instant or consistently not, and a single fast pick means nothing. Seats do
flip mid-draft, which is what falling to autopick for inactivity looks like.

**Observed: an instant pick is not simply Yahoo's rank order.** Joined against
`o_rank` in `dump/pool-10720547.json`, seat 14 took ranks 85 and 88 back to
back, both under a second, while 65, 67, 69 and 72 were still on the board and
went in the next four picks. So a sub-second pick is either a queue firing or an
autopick weighting positional need, and the timing cannot separate those two.

**A queue is invisible to everyone but its owner.** No frame carries one, and
the only trace of the feature in any capture is the room preloading
`add_to_queue.mp3`. Nothing watching the socket from another seat can tell a
queued pick from an autopicked one.

**Counting `C|` ticks instead of timestamps does not work.** The clock frames
arrive about every six seconds and 53 to 80 per cent of all picks land before
the first one, so tick counting has no resolution in the window where nearly
every pick happens.

**The `A|` flag does not predict any of this.** Cross-referencing the two
captures that carry it, the seats it marks `1` picked *slower* than the seats
reading `0` — mean 1.74 ticks against 0.26 in `capture-mock3-reconnect`, where
77 of 87 picks by `0` seats were instant. Either the connect-time snapshot goes
stale within a round or two, or `1` does not mean what one reading of one seat
suggested.

None of this reaches the board. The bridge forwards `0`, `H`, `R` and `P` only,
so it drops `D|`, and measuring any of it live would mean the bridge timestamping
picks itself.

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
- **What `A|` means**, now that it is known not to be a boolean, and now that
  the seats it marks are also known not to behave like autopickers.
- **Whether a queue fires for a manager who is present**, or only on expiry and
  under autopick. It decides whether a consistently instant seat is a robot or a
  human with a deep queue, and so whether pick timing can be used to keep
  Yahoo's own algorithm out of a reading of how a room drafts. Not answerable
  from any capture: a queue is private to its owner. Answerable in two minutes
  from inside a room, by queueing a player and watching whether your own turn
  fills without a click.
- **What the two middle `H|` zeros mean**, and whether `S` becomes something
  else for an auction or a linear draft.
- **What `cost` holds in an auction.** It was `0` in every snake draft watched.
- **Whether a configured league behaves like a public mock.** Not the room
  itself: the mocks held real people, so human drafting, pick timing, autopick
  on inactivity and the reconnect burst are all observed. What no capture holds
  is a league someone set up. Keepers, traded picks, a commissioner's roster
  shape and scoring rules, and any format but 14-team snake are all unseen, and
  the first three are exactly what move the draft order away from a plain
  snake. Recheck before a draft that counts.
