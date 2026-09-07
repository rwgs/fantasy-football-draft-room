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
captured from `10713845` name seven of fourteen seats as having a manager at the
open and five of fourteen ninety-one picks later, one more reading `2`. That is
what makes these captures worth anything. Human pick timing, seats falling to
autopick when someone stops acting, and the reconnect burst are all behaviour of
a real room, not of a lobby full of bots. What a mock is not is a league that
counts, and `Open questions` below says which parts of this document that leaves
untested.

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
| `A\|14=1\|13=0\|12=1\|11=0\|…` | One value per seat. **Observed** taking `0`, `1` and `2`. `1` is a manager present at that seat, `0` is nobody, `2` is still unknown. See below |
| `P\|<overall>=<player>,<team>,<cost>\|…` | **Every pick made so far.** Empty on a draft that has not started, which is why it first appeared as a bare `P`. See below |
| `w\|3600\|20` | Unknown. `3600` looks like a limit in seconds |

Two of these carry the state a client needs to catch up, and both are
**observed**, on a reconnect into a draft 91 picks deep.

#### What `A|` says, as far as it is known

`1` is a **manager present at that seat**, and `0` is nobody. Autopick is a
separate axis, carried by `5|` and `6|` rather than by this frame, which is why
a seat can read `1` while something else is picking for it.

**Observed**, in `frames-2026-09-07T00-09-55-872Z.jsonl`, which holds two `A|`
frames from one 14-team mock — one before the draft opened, one from a reconnect
in round 7 — and every `J|` and `L|` in between. Read against those alone, all
fourteen seats agree:

| flag | seats | what happened between the two frames |
|---|---|---|
| `1` to `0` | 2, 6, 7, 9, 13 | an `L\|` for each: the manager left |
| `1` to `1` | 1, 3, 12, 14 | stayed, or left and came back on a `J\|` |
| `0` to `0` | 4, 5, 8, 10, 11 | no `J\|` and no `L\|` ever: never a manager |

Fourteen for fourteen. It settles `J|` and `L|` as a side effect: they were
inferred from timing, and the flag moves exactly in step with them.

**This does not overturn the 2026-09-05 reading, it explains it.** That seat
reported `1` and was known to be autopicking, because it was a seat Yahoo had
put onto autopick for inactivity — which leaves the manager sitting in it. So
`1` was right, and autopick was the wrong axis to read it on. Seat 14 above says
the same thing from the other end: it reported `1` throughout a draft it spent
half of being picked for.

**The pick timing agrees, over 210 picks:**

| flag | picks | median | under 1s |
|---|---|---|---|
| `1` | 60 | 8.10s | 22% |
| `0` | 150 | 0.88s | 94% |

A seat with nobody in it answers in under a second because nothing is deciding.
A seat with a manager takes eight, except when its clock runs out and autopick
takes the pick for it, which is what the 22 per cent is.

**`2` remains unknown.** It has appeared once across every capture taken, on a
seat whose state nothing independent established.

None of this reaches the board. The bridge forwards `0`, `H`, `R`, `P` and `Q`
only, and a frame it drops cannot break it — which is why `A|` had to be read
with a recorder injected beside the bridge rather than from anything the service
holds.

`A|` is sent **once, in the connect burst, and never again** when the state it
reports changes, which is how the reading above was taken — by reconnecting and
reading the value afresh. It does not follow that a seat cannot be watched
flipping: `5|` and `6|` announce exactly that, one direction each, confirmed. See
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
| `J\|<team>` | A manager connected. **Observed**: the `A\|` flag reads `1` for exactly the seats that have not sent an `L\|` since |
| `L\|<team>` | A manager disconnected. **Observed**, the same way as `J\|` |
| `G\|[…]` | Yahoo's own grade for a pick, as JSON: `letterGrade`, `score`, weighted components with explanations |
| `g\|[…]` | Yahoo's own grade for each **team**, as JSON: `teamId`, `score`, `letterGrade`, `pickCount`, `basis`. Lowercase, and a different frame from `G\|` |
| `5\|<seat>` | **Observed: that seat has gone onto autopick.** See `Autopick, announced` below |
| `6\|<seat>` | **Observed: that seat has come off autopick.** Answers the outbound `6\|` above |
| `X\|<n>` | Unknown, single numeric payload, always `X\|29`. **Observed** immediately before a `5\|` naming *your own* seat, and never before one naming another |
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

**The `A|` flag predicts it almost perfectly**, once read as manager presence
rather than autopick. Over the 210 picks of
`frames-2026-09-07T00-09-55-872Z.jsonl`, seats flagged `0` picked at a median of
0.88s with 94 per cent under a second, and seats flagged `1` at 8.10s with 22
per cent. What stood here said the opposite — that the flag predicted nothing,
because the seats it marked `1` picked *slower* than the seats reading `0`. The
observation was right and only its premise was wrong: `1` is a manager, and
managers are slow. See `What A| says` above.

None of this reaches the board. The bridge forwards `0`, `H`, `R`, `P` and `Q`
only, so it drops `D|`, and measuring any of it live would mean the bridge
timestamping picks itself.

## Autopick, announced

`A|` names the seats that have a manager and says nothing about autopick, so the
connect burst carries no autopick state at all. `5|` and `6|` are the only
source of it, and they give it as edges rather than as a snapshot: a client
joining mid-draft learns who is present and not who is being picked for, and
finds out the rest only as seats flip.

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

**Confirmed, in `frames-2026-09-06T23-47-40-033Z.jsonl`.** The direction is no
longer inferred, and settling it needed no guess about which way a control had
been moved, because the seat's state was known independently on both sides of
each frame. Seat 3 of league `10892178`, over 314 frames:

| | frame | state before | state after |
|---|---|---|---|
| **On** | `5\|3` | picking by hand, outbound `0\|10892178\|3\|3\|30121` | picked for 30-50 ms later |
| **Off** | `6\|10892178\|3` then `6\|3` | on autopick, from the row above | back on its own clock |

So `5|` is autopick going **on** and `6|` is it coming **off**, which is what
this section inferred above and could not show. The outbound form is
`6|<league>|<seat>`, answered by a broadcast `6|<seat>` in 34 and 139 ms across
the two occurrences.

**Observed: what returns a seat to autopick is its clock expiring.** Every one
of the six `5|` frames in that capture sits within 100 ms of a `C|0`, and three
of them named a seat that had just let a full 30-second clock run out unpicked.
This replaces the older reading of "whatever Yahoo's inactivity rule is" with
the rule itself: a seat is not dropped for being quiet, it is dropped for
missing a pick. One `6|` buys one clock rather than a setting, which is why the
same seat was named by `5|3` three times in eleven rounds.

**Observed: `5|` announces a transition, not a pick.** After the third `5|3`
that seat stayed on autopick and took picks 82 and 87 with no further `5|`. So a
reader tracking autopick state has to treat `5|` and `6|` as edges and hold the
state between them. Counting `5|` frames counts flips, not autopicked picks.

**Observed: a queue fires under autopick.** In `capture-mock2.log` the seat that
took itself off with an outbound `6|` is named by `5|13` sixty lines later, and
that frame is followed immediately by pick 44 taking `41824`, which is exactly
the top of the queue that seat had set eight frames earlier. It is the only
direct evidence in any capture of a queue actually firing, and it says the queue
is what autopick draws from rather than something autopick ignores.

**Observed: `X|29` accompanies the flip, but only your own.** All three `X|29`
frames in the capture land between a `C|0` and a `5|3`, 20 to 90 ms ahead of it.
None precedes `5|9`, `5|12` or `5|1`, which are the same transition on somebody
else's seat. Three for three on the reader's own seat and zero for three on
another is thin, but it is a shape rather than the loose numeric the frame table
used to carry, and it suggests `X|` is addressed rather than broadcast. What the
`29` itself means is still unknown.

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
| `dump/frames-2026-09-06T23-47-40-033Z.jsonl` | 87 picks from pick 3, timestamped: the `5\|` and `6\|` pairs that fixed the autopick direction |
| `dump/frames-2026-09-07T00-09-55-872Z.jsonl` | A whole 210-pick draft, joined before it opened: two connect bursts, and the `J\|` and `L\|` that read `A\|` |

These are enough to test a decoder offline, which matters because the
alternative is testing it during a draft. `npm run engine:test` replays the four logs
when they are present, and falls back to synthetic frames when they are not.

**The pool was never captured.** The watcher records response bodies, but no run
kept the body of `players/nfl/<league>`, so nothing here maps a real Yahoo player
ID to a real person. A decoder can be checked against these files; a *join* onto
the board cannot, and is tested against a synthesised pool instead. Keeping one
pool response would close that gap.

## Still unknown

- **What `w|` and `X|` are.** Neither is needed to read picks. `Q`, `5|` and
  `6|` were on this list until the outbound frames were read, and the direction
  of the last two has been confirmed in a mock since: `Q` is the queue, `5|` is
  autopick going on, `6|` is it coming off. `X|29` is now known to sit between a
  `C|0` and a `5|` naming your own seat, which is more than was known about it
  and still not what it means. See `Autopick, announced` above.
- **Whether a queue survives a reconnect**, which decides whether anything can
  write one it did not build. See `The queue` above.
- **Whether Yahoo's own room redraws its queue from a `Q|` it did not ask for.**
  Every `Q|` in the captures answers a write from the room's own client, which
  had already drawn the change itself, so nothing shows what the client does
  with one it did not provoke. If it ignores them, a queue set from outside is
  held by the server and absent from the list on screen until a reload.
- **What `A|`'s third state `2` means.** The frame itself is no longer a puzzle:
  `1` is a manager present at that seat and `0` is nobody, read off two `A|`
  frames from one draft and every `J|` and `L|` between them. `2` has appeared
  once in every capture ever taken, on a seat nothing independent described. See
  `What A| says` above.
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
