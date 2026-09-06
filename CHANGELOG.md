# Changelog

What changed, and why. Dates are the day the change landed on `main`.

This project follows [semantic versioning](https://semver.org): the middle
number moves when something is added, the last one when something is only
fixed.

---

## Unreleased

### Fixed

**Yahoo's own ADP is offered whenever the room can supply it, not only when it
happened to be there first.** A board reports the feeds it could have been
priced on as of the moment it was built, and the app asked for one board and
kept the answer. A room arrives on its own schedule and mostly after that
moment: the bridge is installed once the app is already open, a service
restarted mid-draft is sent the pool again, a page is reloaded between rounds.
None of those moved anything the board was keyed on, so "Your draft room" stayed
greyed out for the rest of the session, saying it needed a live draft to follow
while a live draft ran behind it. The only way back was to toggle another feed
off and on, which nobody would think to do.

A room now reports whether it holds an ADP at all, separately from the seat and
the order it already reported, and the app watches that and asks for the board
again when it changes. Both directions: a room that goes away takes the feed
with it rather than leaving a choice that can no longer be honoured.

**A Yahoo pick reaches the board in about two seconds instead of eight.** The
assistant polled every eight seconds whatever it was following. That is a fair
rate for Sleeper, which is a request at somebody else's public feed, and much
too slow for Yahoo, where the picks have already been read: the bridge in your
own tab posts them within half a second and the service answers from its own
memory in about ten milliseconds. Waiting eight seconds to ask a question that
was already answered was the whole of the lag. Yahoo now has its own beat and
Sleeper keeps the old one. The panel over the draft room, which reads the app's
answer every two and a half seconds, is unchanged.

**The draft assistant says what to pick, and both modes say it the same way.**
The recommendation was held back to picks you could make, which in the assistant
meant naming one for every seat while you entered a room's picks by hand and
naming none at all while a feed ran the room. The mode that simulates nothing,
and so has the most use for a read, was the one that showed it least. It now
names a pick in both modes whether or not the clock is on you. Off the clock it
is tagged `Target` rather than `Take` and says what goes before your turn rather
than what goes if you wait, because the number was always priced against your
own next pick and only the word was wrong.

**"Take best available" is offered in the assistant too.** It only ever existed
in the mock. It follows your own turn in both modes, not every seat you can
record: the best available to you is not what somebody else took.

**A Yahoo mock and this app's mock draft are told apart.** They share a word and
almost nothing else: a Yahoo mock is a public room of real people drafting a team
that is not for their league, so it is followed with the Draft assistant, while
this app's mock draft simulates a room. Ticking "This is a Yahoo mock draft" in
the mock draft used to hold the league number and wait for a draft room, and the
banner promised the board would open by itself once the room was up. Only the
assistant opens a board off a room, so that promise could not be kept. In the
mock draft the tick now sets Yahoo's roster shape and nothing else, and a pasted
number is read at once or refused at once. The waiting, and the board that opens
by itself, stay with the assistant, where they work.

The two modes now say which is which on the switch that picks them, the Yahoo
tab says in the mock draft that a new Yahoo number needs your draft room open
either way and that a league already saved does not, and the league list is no
longer titled for one platform when it offers two.

**A panel shown for two platforms stops naming one of them.** "Follow a real
draft" said Check Sleeper, Press Check Sleeper, and "it appears here once
Sleeper sets it" while a Yahoo league was loaded. It names the platform of the
league in hand, and the draft order sentence says where the order actually comes
from: Sleeper publishes it, Yahoo puts it in the draft room where only the
bridge can read it. The same panel offered to "run a mock instead", which is the
overloaded word again; it says this app's own mock draft.

**The clock says when the pick is yours, in words.** The gold wash and the gold
seat name both said it in colour, to somebody already reading the clock, and on
a phone the row's labels are stripped out. A `Your pick` badge now sits in the
clock strip on your own turn in both modes. The assistant's clock also read
"Recording for You" on your own pick, which was the screen calling your pick
somebody else's; it reads "On the clock" there now.

### Added

**The order the player pool opens on is a setting.** It opened on your own
ranking where you had a file loaded and on ADP where you did not, and "Worth"
was only ever reached by clicking for it, every draft, in both modes. "Open the
pool on" in The league now says which, and is kept with the rest of your
settings. It only decides where the list starts; the sort over the list is
unchanged. Asking for your own ranking without a file loaded still opens on ADP,
because an order over a ranking nobody uploaded is no order at all.

**The panel over the Yahoo room says what to pick.** It showed three positions,
who was left at each, and what waiting cost. It did not show the pick, which is
the thing you open a panel for. It now leads with the recommendation and its
arithmetic, the same one the pool shows, worked out once in the app and handed
over rather than computed twice.

Each row gained what the player is worth and how many are left before the drop,
so the row says whether the wait matters rather than only what it costs. A line
at the foot says whether the numbers were read from runs of your actual room or
off ADP, because a run already under way moves one and cannot move the other,
and a panel that does not say which is one you cannot weigh.

Bigger with it: 320px rather than 246, larger type, and the pick sized to be
read at a glance. It still takes no clicks and still covers nothing you can
interact with.


**The pick this turn is for.** Three readings decide a pick and they were in
three places: what a player is worth, in the pool; which position runs out
first, in the panel beside it; and what you still have to start, in the panel
below that. The pool now marks the one player they agree on, and says why in a
line you can argue with.

Only the leader at each position is weighed, because the cost of waiting is
measured against the best man left and the fourth receiver does not inherit the
urgency of the first. Urgency counts only where it is yours: a position you can
no longer start contributes none of it, which leaves worth alone to decide once
your lineup is full. A position filled to its cap is never named however much
the best man left is worth.

It stays quiet when there is nothing to say. Two positions within a field goal
of each other is not a decision, and naming one would invent it rather than
report it. It also says nothing out of turn, when the pick is somebody else's.

**Worth leads the pool row.** ADP, CONS and WORTH were the same size, so the row
asked you to choose the question as well as answer it. Worth is the only one of
the three that is points rather than a draft position, and the only one that
says whether a player is worth taking here, so it now carries the size. The
other two stay on the row: the gap between them is how you see the sources
disagree, and demoting them out of comparison would take that reading away.


**A light mode.** The board in daylight, following your system setting by
default. A button in the masthead overrides it and cycles auto, light, dark, and
what you choose is kept in the browser with everything else.

It is not the felt lit brightly. A green ground washed pale goes grey and takes
every position hue with it, so the metaphor turns over instead: the sticker
paper the type was always made of becomes the ground the type sits on. The six
position hues stay the same six hues, taken down in lightness until each one
reads on paper.

Both palettes are now held to one measured floor. Everything used as type
clears 4.5:1 against every surface it can land on, and no two accent hues sit
close enough to be confused for one another.

**Choose which sources price the board.** The ADP setting was four fixed
combinations of Sleeper, Fantasy Football Calculator and ESPN. It is now a tick
per feed plus a rule — averaged, or read in order, where the first feed that has
heard of a player wins and the rest fill its gaps. The same control appears over
a live draft, so a lens can be changed without restarting one.

Hovering a feed says what it measures, which is the part that decides the
choice: Sleeper and Fantasy Football Calculator both count real drafts over
different populations, so agreeing is one measurement counted twice; ESPN's is a
judgement and the only one that can disagree for a reason.

The four older namings still mean exactly what they meant, so a saved league
opens on the board it opened on before. `sleeper` reads as `order:sleeper,ffc`,
`blend` as `avg:sleeper,ffc`, and so on. The self-test compares every one of
them against the encoded form, over every player a draft can reach.

**Your own Yahoo room as a fourth ADP.** Yahoo publishes what its own drafters
do, and only to a browser holding the session cookie, so it arrives with the
bridge's pool and can never be fetched by the service. It was already being read
to judge which way a room leans; it can now price the board itself. Offered only
while a Yahoo draft is being followed, and greyed out with the reason everywhere
else.

**A key on the draft screen, and a number that says whether to pick him.** The
pool's third column was raw projected points, which is the one number on the row
that cannot be read across positions: 240 points is a poor starting back and an
outstanding tight end, and nothing said which. It now shows points above a
replacement starter at the player's own position, so the six positions sort as
one list and below zero means the waiver wire has somebody as good. A player who
has slid a full round past his own ADP is marked. **What these numbers mean**
above the pool says what each of them implies, closed by default.

**Follow a Yahoo draft.** The assistant already followed a Sleeper draft. Yahoo
publishes nothing to anyone but your own browser, so this takes a userscript —
`userscript/yahoo-draft-bridge.user.js` — running in your own draft room. It
reads the room the way the room reads itself and posts to the service on your
machine. Your Yahoo session never leaves the browser, and there is still no
account to make and no API key to get.

The settings screen gained a choice of platform, and a saved league remembers
which one it came from. A league saved before there was a choice is a Sleeper
league.

Yahoo's draft room carries the seats, the team names, the full draft order and
every pick. It does not carry the roster shape or the scoring rules, so a Yahoo
import leaves those as you set them and warns rather than inventing them. The
draft order is read from Yahoo rather than worked out from a snake, which is the
only reading that stays right for a league with keepers or a traded pick.

The service serves the bridge at
`http://127.0.0.1:5178/userscript/yahoo-draft-bridge.user.js`, so a userscript
manager installs it from an address and can fetch a later version, rather than
holding a pasted copy that quietly stops matching the one in the repository.

`docs/yahoo-draft-protocol.md` records what Yahoo's draft room actually sends,
marked observed or inferred line by line. None of it is documented or promised
by Yahoo, and a deploy can change it without warning.

**Chrome and Edge need one switch thrown, and say nothing when it is not.** Both
gate user scripts: until "Allow user scripts" is on for the manager, the bridge
installs, enables, reports no error and never runs. The README leads with it and
gives the one console probe that tells that failure apart from every other one.

**The board, in the Yahoo draft room.** A small panel over the draft page A small panel over the page carries the pick you are
on, what the room is leaning towards, and the three positions worth spending
this pick on with the odds each one lasts. It is the same reading the app shows,
so there is one answer rather than two, and it means a pick can be made without
looking away from the room.

It installs as a bookmarklet from `http://127.0.0.1:5178/panel`: drag it to the
bookmarks bar once, click it in the draft room. It is deliberately not part of
the bridge userscript, which needs privileged injection to wrap `WebSocket` and
would have handed the panel all of its ways of failing to install. See
`DECISIONS.md`.

The app works it out and posts it; the service holds it; the panel collects it
and paints it. Nothing was moved into the service, which still forms no opinion
about a draft, and nothing was moved into the userscript, which still decodes
nothing. See `DECISIONS.md`.

It cannot get in the way of the draft under it, and that is checked in a real
browser rather than asserted. It is one element in a shadow root, so no
style crosses in either direction and Yahoo's own nodes are never touched. It is
drawn into the top frame, because Yahoo runs the draft in an iframe and anything
pinned inside one is pinned to the frame rather than to the window.
Everything in it ignores the mouse except the button that hides it, so a click
where it sits still reaches the draft. Every fault is swallowed: a panel that
breaks paints nothing and the draft carries on.

**A tick for a Yahoo mock draft.** Yahoo's mock rooms all run the same roster
and never say so, and Yahoo's draft room publishes no roster shape at all, so a
mock used to arrive wearing whatever was last set for a real league. Ticking the
box on a Yahoo league sets what Yahoo will not: QB, WR, WR, RB, RB, TE, W/R/T, K
and DEF, with six on the bench, for fifteen rounds.

It also opens the board as soon as the room can be read, in the seat you are
actually sitting in. The draft room address the bridge runs in names your team,
so the app no longer has to ask which manager is you; that seat now comes back
with the rest of the draft state.

Paste the league number from the mock lobby, which shows it before the draft
starts, and the app waits: the lobby hands out that number two or three minutes
before the draft room tab exists, so waiting is a state on the settings screen
rather than a load that failed. It asks the service every few seconds whether
the room is there, and reads the league the moment your draft room is up and the
bridge in it has posted the seat and the draft order. In the draft assistant the
board then opens by itself. Unticking the box stops it.

A Yahoo mock is a public room of real people rather than a simulation, so it is
the assistant that follows one, not this app's own mock draft. Ticking the box
in a mock still sets the roster, because that is a fact about the room either
way.

Nothing opens on a league ID alone. The ID of the last league you loaded comes
back with the page and says nothing about any room, so what starts a board is
the room itself answering.

**What a position costs to skip.** Above your roster, each position now carries
the best player left at it in points over a replacement starter, the value you
can expect to still be there at your next pick, and the gap between them. The
costliest position to skip sorts to the top. The survival bar already said
whether a player lasts; this says whether that matters, which is the question
you actually have on the clock. A back with a one in five chance of lasting is a
crisis when the next back is forty points worse and a shrug when the next one is
three points worse.

Replacement level is read off the market rather than a table of invented flex
shares, so a superflex league moves the quarterback replacement down on its own
without being told to.

**Odds read off your room, not off the average of thousands.** When the
assistant is following a real draft, the board now plays the rest of the round
out from the real picks and the real rosters, a hundred and fifty times, and
reports how often each player was still there when your turn came round. Those
odds replace the ADP ones, and the pool marks which is which. A receiver run
already under way moves these numbers where it cannot move ADP. If the room is
leaning hard somewhere, the panel says so in a sentence.

This is for a draft you are following only, not for this app's own mock draft:
there the room's lean is the one you dialled in yourself, so measuring it and
applying it again would count it twice.

**Enter the picks by hand.** Assistant mode used to refuse to open without a
league carrying a draft. A room on a site this app cannot read, or one whose
feed turns out not to publish picks while it runs, is still a room worth having
the board for, so it now opens ready to take the picks typed in, and does that
by default when there is nothing to follow. Everything downstream treats a typed
pick as a pick: rosters fill, the board fills, and the grade at the end reads it
like any other draft. Where there is a feed you can switch between the two, and
the poll stops while you are typing so it cannot overwrite what you entered.

**One command for the data service.** `npm run serve` says what is on port 5178
and offers to restart or stop it, and starts it when nothing is running. It also
answers the question that used to have no command behind it: whether the service
you are talking to is running the code you have. A service left up from an
earlier session answers a health check perfectly happily while serving something
older, and now says so instead. On Windows `.\serve.ps1 restart` avoids npm's
`--` for passing the action through.

**A pick is named the way the draft room names it.** The draft screen called a
pick `3.05`, the round and the seat inside it, which is the reading a snake
draft turns on and the one the board is laid out by. Yahoo counts picks
straight through and calls the same pick 29, so matching the screen against the
room in front of you meant counting seats. The clock, your next pick, the
survival odds and the cost of waiting now carry both. The board, the keepers
and the results tables are unchanged: the board already says the seat by which
column a pick is in, so the round and the seat is the only reading it needs.

**Change which ADP without leaving the draft.** The choice of ADP source lived
in settings, which meant walking out of a draft to see the same room read
against different numbers. In assistant mode it now sits in the pool header
where the source was already named. Nothing is simulated there, so the ADP is
only a lens on a real room: every pick that has happened stays exactly as it
happened and only what the players left are worth changes. A mock draft is
running on its ADP rather than looking through it, so that one still asks in
settings. The swap lands while the draft is paused or being entered by hand
too, which is where it is most likely to be wanted.

**The room is read before it drafts, not a round after.** The odds a player
lasts used to come from ADP until a full round of real picks was in, which in a
14 team league is the whole of the first round. Yahoo publishes what its own
drafters do, and only to a browser holding your session, so the bridge now
carries it back with the picks. Where it exists, the room's lean is known from
the first pick.

It is worth about one thing, honestly: Yahoo drafts quarterbacks earlier than
the wider market, and almost nothing else differs. Measured against a real
Yahoo pool that reads as a lean of 1.7 on the dials, enough to say "this room is
forcing QB" on the board where nothing was said before, and enough to move the
best quarterback's chance of lasting to your next pick from 90 per cent to 75.
Once a round of real picks exists they win: what this draft did beats what
Yahoo's drafts do in general.

**A third opinion on the board, and a way to see where they disagree.** Sleeper
and Fantasy Football Calculator both measure the same thing — where players
actually come off the board — so agreeing with each other is one measurement
counted twice. ESPN publishes a draft rank, which is a judgement rather than a
measurement, and it is free and needs no key. Pick **Consensus of all three**
as your ADP source to average them, and the pool carries the gap between the
sources beside the number so a mean never hides whether three agreed or two
disagreed.

Three rules make the average mean something. A rank is not a pick number, so
ESPN's ranks are mapped onto the market's own scale by position, which brings
them from 412 picks away from the market to 81. ESPN abstains on kickers and
defences, where its placement is the convention that you draft them last rather
than a view on the player. And a source that has run out of players abstains
rather than voting with a number from past the end of any draft.

**PPR is the default scoring.** It was half PPR, in the setting a new browser
starts with and in the format the service falls back to. ESPN publishes a rank
table for PPR and none for half PPR, so this is also the format where its
opinion is its own rather than borrowed.

**Take the board away as a file.** The three-source board was readable on screen
and had no way out of the browser. Your rankings section now downloads it as a
CSV: every player, what Sleeper, Fantasy Football Calculator and ESPN each said,
how far apart they were, the projection and the bye. It is written to be read
back by the same matcher that reads a ranking file, so the round trip is to sort
it in a spreadsheet and load it in again as your own.

The headers are chosen against that matcher's column scoring rather than picked
for looks: it scores header names, and a file whose `Rank` column loses to its
`ADP` column comes back in market order while still calling itself yours. The
self test exports a real board, feeds it back, and checks every row returns on
an exact match in the order it left.

### Fixed

**The board shows its position colours.** Every hue in this palette exists for
the board, and the board was the one place not using them. A pick read `RB` in
the same grey as its bye week, with the colour spent on a two-pixel edge you
cannot scan a column by. The position now carries its own colour, in both
themes.

**Text you read while deciding was too faint.** The muted step sat at 3.1:1 on
a raised surface, under the readable floor, and it carries the survival lines
and the run counts next to every player. Both quiet steps now land on the same
ratios in both themes, so neither theme is the legible one. QB red was under the
floor too, at 4.1:1.

**A choice of sources can no longer empty a position.** ESPN abstains on kickers
and defences, because ranking those two last is a roster convention rather than a
view about anybody. Making it independently selectable therefore took all 45
kickers and all 32 defences off the board, leaving a league that starts one of
each unable to fill a roster. The feeds you pick now decide who is asked first
rather than who may answer: where none of them has an opinion the rest are read,
and the player carries a flag saying so. Found by the self-test that now covers
it, before it ever shipped.

**The player pool stopped spending a row on nothing.** Adding the consensus
column gave the pool a sixth cell and left it with five columns, so the third
number wrapped underneath the queue star and pushed the survival bar onto a
third line. Every row in the pool paid for it. The grid has six columns again
and a row is 64 pixels rather than 83, which is about three more players on
screen without changing what any of them says.

**A player eligible at two positions joins the board again.** Yahoo writes dual
eligibility as `WR,RB` where every other source writes one position, and the
whole pair was being used as a lookup key, so the pick found nobody and landed
as a stranger on the board. Only fringe players carry it, which is why a full
mock draft never tripped over it.

**The blended ADP no longer invents a number neither source measured.**
Sleeper's board runs past pick 700 and Fantasy Football Calculator's stops
around 230, so a player one puts at 142 and the other at 700 is not a player
they disagree about by five hundred picks: one measured a pick, the other is
saying nobody takes him. Averaging the two put him at 421 and out of the
draft. Twenty six players Fantasy Football Calculator drafts inside a fifteen
round board were being pushed out of it this way, nine of them receivers,
along with most of the kickers and defences. A source with no pick to report
now abstains, and the blend is of whoever measured one.

**A slow feed is no longer asked the same question three times.** Following a
draft rebuilds the board every eight seconds, and every rebuild asks for seven
cached feeds. If one had expired and the upstream took longer than the poll to
answer, the next poll started a second fetch of the same thing and the one after
that a third, each holding a payload of a megabyte or more. Callers now share
the one fetch.

**Known limits.** Everything was built from public mock drafts, and a mock is
the only thing the bridge has ever followed live: a 14 team room, followed pick
by pick with every pick joined and none unmatched. A public mock is real people
drafting rather than a simulation, about half the seats live throughout, so a
live room's timing, its seats dropping to autopick, and catching up after a
reload have all been watched working. What has not been seen is a league someone
configured: keepers, traded picks, your own roster and scoring rules, any format
but a 14 team snake. The userscript itself still has no automated test. Run a
mock beside the board before trusting it.

---

## 1.1.0 — 2026-09-01

### Added

**Notes on a player, shown under him in the pool.** Everything else on that row
is measured — ADP, projected points, the odds he lasts. A note is the one thing
you wrote, so it reads in your own words next to the numbers everybody else
has. Long notes clamp to a line and open on a tap; short ones just sit there.

A note reaches the board two ways and both are optional:

- A `Notes`, `Note` or `Comment` column in the ranking file you already upload.
  Costs nothing if the export you use happens to carry one.
- A notes file of your own, under **Your notes** on the settings screen. This
  one wins, because a ranking export is replaced every time its publisher
  updates and should not quietly undo something you wrote.

A notes file is a ranking file with the ranking left out, so it runs through the
same six matching tiers as your rankings and honours the name mappings you have
already saved. `POST /api/notes` refuses a file with no notes column rather than
succeeding silently and showing you nothing.

### Fixed

**A note keeps its commas.** Prose has commas, so an unquoted note splits into
several cells and the row ends up wider than its header. When the notes column
is last, the note is now cut from the raw line instead of rejoined from the
split pieces — the splitter trims every field, so rejoining returned
`him,because` for a note that said `him, because`.

**The Node version the README asks for is the one the build needs.** It said
"Node 20 or newer", which wrongly admits Node 21 and Node 22 before 22.12.
Vite's range is `^20.19.0 || >=22.12.0` and it has a hole in the middle, so the
README now says so.

### Note if you deploy this

Serve `client/dist` so that a request for a hashed asset which no longer exists
returns **404**, not `index.html`. A single-page fallback that catches
`/assets/*` hands back HTML under a `.js` URL, and if you also cache those
immutably a browser holding a stale page breaks until a hard refresh. Route
everything else to `index.html` as normal.

---

## 1.0.0 — 2026-08-31

First public release. A fantasy football draft tool with two modes: a mock
draft against a room you can tune, and an assistant that follows your real
Sleeper draft pick by pick.

The draft runs in the browser. The data service exists to reach two free feeds
a browser cannot call directly, to cache them, and to join them in one place so
the client never has to guess whether two records name the same player. Neither
feed asks for an API key.

Notable in this first release, because they are the parts that took the longest
to get right:

- **A ranking column is scored, not matched.** A real export can carry six
  columns with "rank" in the name and only one of them is the ranking. Guessing
  wrong sorts your board into market order and still calls it yours, which is
  the worst kind of bug because nothing about the result looks broken.
- **Six matching tiers**, so "Cameron Ward" reaches Cam Ward and every team
  defence resolves to a team abbreviation. Anything that clears none of them is
  listed with its closest matches rather than silently dropped.
- **ADP borrows across formats.** The columns are not equally populated, and
  without borrowing every board but half PPR was missing a third of its players.
- **Keepers apply at both ends** — the player leaves the board at pick one and
  the pick that paid for him fills itself when it arrives.
- **An anonymity toggle** that masks league names, league IDs, team names and
  every manager's display name together, because masking the name while showing
  the ID masks nothing.

Your own leagues and Sleeper name are read from the environment rather than
written into the source. A league ID is enough to look a league up and read
every manager in it, so a fresh checkout starts empty and asks for one.
