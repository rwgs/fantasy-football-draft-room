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
| `S\|<league>\|<team>\|<player>\|<player>\|…` | **Set the queue**, as the whole ordered list. **Observed**. See `The queue` below |
| `0\|<league>\|<team>\|<overall>\|<player>` | **Make a pick.** **Observed** once, in `capture-mock3-handshake.log`, answered by the inbound `0\|3\|40041\|3\|WR\|0` that followed it. Note the fields are not the inbound `0\|`'s |
| `6\|<league>\|<team>` | Unknown. **Observed** once, immediately before a queue was first built |

### Sent on connect, in this order

| Frame | Meaning |
|---|---|
| `H\|S\|30\|0\|0\|<started>` | Settings. `S` is snake and `30` the seconds per pick — both **inferred**, and both agree with the order and clock actually seen. The last field is **observed** to be `0` before a draft opens and `1` on reconnecting to one in progress. The middle two zeros are unknown |
| `R\|<team>\|<team>\|…` | **The entire draft order**, one entry per pick, in pick order. **Observed** at exactly 210 entries for a 14-team, 15-round league, running `1..14, 14..1, …` |
| `Q` | **Your queue**, which is empty on every connect watched, and so arrives bare. See `The queue` below |
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

None of this reaches the board. The bridge forwards `0`, `H`, `R`, `P` and `Q`
only, and a frame it drops cannot break it — which is why `A|` had to be read
with a recorder injected beside the bridge rather than from anything the service
holds.

`A|` is sent **once, in the connect burst, and never again** when the state it
reports changes, which is how the reading above was taken — by reconnecting and
reading the value afresh. It does not follow that a seat cannot be watched
flipping: `5|` and `6|` appear to announce exactly that, one direction each. See
`Autopick, announced` below.

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
| `5\|<seat>` | **Inferred: that seat has gone onto autopick.** See `Autopick, announced` below |
| `6\|<seat>` | **Inferred: that seat has come off autopick.** Answers the outbound `6\|` above |
| `X\|<n>` | Unknown, single numeric payload. `X\|29` five times |
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

**A queue is invisible to everyone but its owner.** Your own queue is on your
own socket, in the `S|` you send and the `Q|` that answers it, but no frame
carries anybody else's. Nothing watching the socket from another seat can tell a
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

None of this reaches the board. The bridge forwards `0`, `H`, `R`, `P` and `Q`
only, so it drops `D|`, and measuring any of it live would mean the bridge
timestamping picks itself.

## Autopick, announced

`A|` gives every seat's autopick state in the connect burst and is never sent
again, which left the obvious question of how a client learns that a seat has
flipped since. **Inferred:** it learns from `5|` and `6|`, which announce the
two directions.

**Observed**, across `capture-mock1.log` and `capture-mock2.log`, seven `5|`
frames in total:

| | |
|---|---|
| Five of seven | are followed **on the very next line** by a pick from the seat they name |
| The other two | are followed by `6|` naming the same seat, and by no pick from it |

That is the shape of a state rather than an event about a pick. A seat put onto
autopick while it is on the clock is picked for immediately, which is the first
group; a seat put onto autopick while it is waiting sits there until either its
turn comes or its manager returns, which is the second, and the return is the
`6|`.

**Observed: a client can send it.** `capture-mock2.log` line 373 carries
`6|10713141|13` outbound, answered by `6|13` inbound, from a seat that then
immediately built a queue. **Inferred** from that pairing: outbound `6|` is a
seat taking itself off autopick, and the queue that followed is what somebody
does next having just been drafted for.

**Observed: autopick does not stay off.** The same seat is named by `5|13` sixty
lines later and picked for again. So a seat is returned to autopick on whatever
Yahoo's inactivity rule is, and one `6|` buys one reprieve rather than a
setting.

**Observed: a queue fires under autopick.** That later `5|13` is followed
immediately by pick 44 taking `41824`, which is exactly the top of the queue
that seat had set eight frames earlier. It is the only direct evidence in any
capture of a queue actually firing, and it says the queue is what autopick draws
from rather than something autopick ignores.

**Not confirmed, and it inverts if wrong.** `5|` and `6|` could be the other way
round, in which case anything sending `6|` to escape autopick would be switching
it on. One mock settles it: run `capture.ps1`, toggle Yahoo's own autopick
control, and read which frame leaves. Nothing should send `6|` before that.

## The queue

**Observed**, in `capture-mock2.log` and `capture-mock3-handshake.log`, which
between them hold 32 queue writes across three sessions.

Starring a player sends the **entire ordered queue**, and the server echoes back
what it now holds:

```
[ws-out]  S|10713845|3|32687
[ws-in]   Q|32687
[ws-out]  S|10713845|3|32687|40196
[ws-in]   Q|32687|40196
```

There is no add frame and no remove frame. A removal is the same `S|` carrying
a shorter list, which `capture-mock2.log` shows directly at lines 581-584: the
list goes to `40962|33998`, then back to `40962`. So a write is a replacement,
and a client that sends a list missing an entry has deleted that entry.

**Observed: `Q|` only ever answers an `S|`.** Every one of the 32 in the
captures sits on the line after a write. Nothing else provokes one.

**Observed: Yahoo does not tell you it pruned a drafted player.** In
`capture-mock2.log` a nine-deep queue is set at line 393, and all nine players
are drafted over picks 43 to 53 — including one by the queue's own seat — with
no `Q|` sent for any of it. The next write, at line 502, starts from a single
fresh ID. So the client prunes its own list and the server never volunteers the
state: anything reading this has to drop drafted players itself.

**Reported: an empty queue puts the seat into autodraft straight away.**
Watched in a live public mock on 2026-09-06, league `10888301`, and reported
rather than captured: no frame in any capture carries this, and the bridge does
not forward the `A|` that would show a seat flipping. It agrees with what `A|`
already said, though — seven of fourteen seats read autopick at the open of a
room full of real people, which is a lot of managers to have all gone idle in
the first minute.

If it holds, it inverts the cost of being careful here. A queue is not
insurance against wandering off; it is the thing standing between you and
Yahoo's own algorithm from the first pick. Anything that declines to write one
declines at exactly the moment the write was worth most, so the caution below
needs a way out that does not require the user to go and use the feature by hand
first.

**Unknown: whether a queue survives a reconnect.** Both captures that show a
connect carry a bare `Q`, but neither proves anything, because in both cases the
queue was legitimately empty: in `capture-mock3-reconnect.log` all six players
queued earlier in that league had been drafted by the pick the reconnect landed
on, which is checkable against the `P|` in the same file. Until this is answered
nothing can safely write a queue it did not watch being built, because the write
replaces a list it cannot see.

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

- **What `w|` and `X|` are.** Neither is needed to read picks. `Q`, `5|` and
  `6|` were on this list until the outbound frames were read: `Q` is the queue,
  and `5|` and `6|` are autopick going on and coming off, inferred rather than
  observed and with the direction still to be confirmed. See `Autopick,
  announced` above.
- **Whether a queue survives a reconnect**, which decides whether anything can
  write one it did not build. See `The queue` above.
- **Whether Yahoo's own room redraws its queue from a `Q|` it did not ask for.**
  Every `Q|` in the captures answers a write from the room's own client, which
  had already drawn the change itself, so nothing shows what the client does
  with one it did not provoke. If it ignores them, a queue set from outside is
  held by the server and absent from the list on screen until a reload.
- **What `A|` means**, now that it is known not to be a boolean, and now that
  the seats it marks are also known not to behave like autopickers.
- **Whether a queue fires for a manager who is present.** Half answered: it does
  fire under autopick, observed once and directly — `5|13` then pick 44 taking
  the top of the queue that seat had just set. What is still open is whether it
  also fires for a manager the room considers active, which decides whether a
  consistently instant seat is a robot or a human with a deep queue. Answerable
  from inside a room by queueing a player and watching whether your own turn
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
