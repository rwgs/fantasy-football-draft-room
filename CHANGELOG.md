# Changelog

What changed, and why. Dates are the day the change landed on `main`.

This project follows [semantic versioning](https://semver.org): the middle
number moves when something is added, the last one when something is only
fixed.

---

## Unreleased

### Added

**The week's advice, over Yahoo's own league page.** The reader's panel now
shows what the app makes of the league it just read: what each desk would start
and bench, what the lineup scores now against the best one available, and the
player they do not agree on. Only that last half of the comparison, because it
is the only part that is a decision and the panel is small; who both desks start
is most of the roster and stays on the app's screen. It is the same endpoint the
app's screen reads, so the two agree by construction rather than by care.

It sits in the panel the reader already draws rather than being a second thing
to install, which is a change of plan the reader's own beat made possible: the
advice is fetched straight after the reading that produced it, so what is on
screen is never advice about a snapshot it cannot date. A caution rides with it
that matters more here than on the app's screen, because this is the page where
the moves get made - Yahoo publishes no kickoff time at any scope, so whether a
player has already locked is not known, and each move wants checking before it
is set. Nothing here sets a lineup; that stays your action in the page
underneath.

**This week's lineup, and what changing it is worth.** The in-season screen
puts the best legal lineup your roster can field beside the one you have
actually set, and names the swaps between them: which seat, who comes out, who
goes in, and what the difference scores. Three desks answer separately rather
than as one blended number — Sleeper's projections, ESPN's, and Yahoo's own —
because a mean showed a player at 13.0 where the desks said 15.29 and 10.75,
which is a number no desk holds and a disagreement hidden rather than reported.
Every roster in the league is scored the same way, with the team you are playing
this week first.

**Best-player-first is not the best lineup, and the difference is invisible.**
Filling seats with the best available player loses points silently: a league
starting one flex and one receiver, holding a 20-point receiver, an 18-point
back and a 10-point receiver, puts the 20 in the flex because the flex comes
first and fits, and strands the back at 30 points where 38 was available.
Nothing about the 30 looks wrong. The lineup is instead solved as a matroid,
where the test for adding a player is whether the whole set can still be seated
rather than whether a seat is free — the shuffle that moves the receiver out of
the flex. `lineup.test.js` enumerates every legal lineup for small rosters and
checks the answer against the true maximum, so the optimum is proved rather
than asserted, and runs the naive greedy on the trap above to watch it lose.
Where several best lineups tie, the one reached in the fewest moves wins, and a
player who only changes seat is reported as moved rather than as benched and
started.

**Every limit sits next to the thing it limits**, because this is the one screen
in the project that recommends anything. A projection is scored under your
league's own rules, joining Yahoo's categories to its modifiers rather than
reading a label, and where a rule cannot be scored it refuses to guess. A
starter no desk projects is named, since that is the reason the total is what it
is. A slot nothing on the roster can legally fill says so. And Yahoo publishes
no kickoff time at any scope, so whether a player has already locked is simply
not known — which matters most in the reader's own panel, since that is the page
where the moves get made. Nothing here sets a lineup.

**Yahoo is a third desk, from its own roster pages.** Yahoo publishes a
per-player projection on a team's roster page and nowhere in its API, so the
reader scrapes that column in the browser that already has the page and posts
the numbers; the extraction is there rather than in the service because the page
is 1.14 MB and there is one per team. HTML has no contract, so it fails loud —
a missing column reports nothing found, never nobody projected — and the league
scoreboard's own team total is kept beside it as the one thing that can catch
the scrape drifting. Where only that published total arrived, Yahoo still heads
a column, carrying a team total under a run of blanks rather than disappearing.

**The userscripts are tested against a fake room and a fake league.**
`npm run bridge:test` loads the bridge for real and runs it against a fake
`WebSocket`, a fake `fetch` and a fake room URL, so the frame the assertions
read is the frame it puts on the wire; `npm run reader:test` does the same for
the league reader. Both were the part of this project no check touched, where a
live draft had been the only thing that ever exercised them. Neither needs a
service running.

**The league reader can keep itself current.** It installs as a userscript now
as well as a bookmarklet, from the same file and the same page: pick the
bookmarklet for one reading when you click it, or the userscript to have your
league read whenever its page loads and then again on a beat you set. Ten
minutes by default, adjustable from the small panel it leaves on the Yahoo page,
and `never` there is the bookmarklet's behaviour if you would rather ask for
each reading yourself.

What this buys is that a lineup you change in Yahoo reaches the app without
being fetched by hand, and that restarting the service costs nothing but a wait
- the snapshot it drops is read again on the next beat.

Two limits worth knowing. It still only reads while a Yahoo tab is open,
because the session cookie that makes any of this work lives there and never
here, so the app cannot hold a current picture of a league nobody has opened.
And a userscript manager is a place a script can go stale in silence - this
project lost three mock drafts to exactly that - so the bookmarklet is kept
rather than replaced, the install page names the per-extension control to check
when nothing appears, and the panel stays visible for as long as a beat is
running. The reader does not yet report its build back the way the bridge does;
until it can, a stale one polls perfectly while posting a shape the service has
moved on from. See `DECISIONS.md`, 2026-09-09.

**A Yahoo league can be read outside a draft, and shown.** The service can be
handed your league — the settings, the exact scoring, every team, and your own
roster — and **My league in season** on the settings screen puts it on a screen
of its own. A fourth screen rather than a third mode, because the mode badge
says how a *draft* runs and this is not a draft, so the draft flow is untouched
and this sits beside it.

What that screen shows is what was read and how old it is, before anything
built on it is worth reading: every roster against the slots the league
actually starts, each player's bye, injury status and ownership, and the age of
each feed behind them. Every absence says which absence it is — a player the
pool never matched reads "not in the pool" rather than as a blank column, a
feed that failed says so rather than showing an age, and a league nobody has
read is offered the reader instead of rendering as an empty league.

Yahoo's league pages turned out to stop short of what was needed: settings,
team and player pages fetch no JSON at all and arrive as a megabyte of
server-rendered HTML. The same API those pages already call answers its own
sub-resources anyway, which they simply do not use, so no HTML is parsed
anywhere. That ends the unknown the draft adapter has carried since Yahoo went
in — it could never read a roster shape or a scoring rule, because a draft room
does not send them. Scoring arrives as categories joined to modifiers rather
than a label, slots keep a composite flex as one position, and a roster carries
what each player may fill against what they fill now.

It reads through a bookmarklet installed from `/league-reader`, on the same
reasoning as the panel: only the browser has the session cookie, and the bridge
is a userscript solely because it must wrap `WebSocket` before Yahoo's own code
runs. This needs none of that, so it does not inherit a userscript's ways of
failing to install. It runs only on a Yahoo page, sends no cookie anywhere, and
every request it makes is a GET.

Your own team is finally identified rather than guessed. The profile endpoint
returns a guid and every team carries its managers' guids, so the two match —
where a draft room has no identifier for a person separate from their seat,
which is why the draft code has to read the seat number out of the room address.

**The app says which bridge is running, and says when one has stopped.**
Following a Yahoo draft needs the bridge userscript installed, and a stale copy
is the failure this project keeps having: it mirrors every pick perfectly while
writing no queue, and says nothing about it. 2026-09-07 cost three mock drafts
to a copy that served, stored and listed as 1.3.0 while running 1.0.0, whose
frame filter is three versions old and drops every `Q` before it leaves the
page. The service was working correctly the whole time.

So the service now stamps a build into every copy it hands out, the running
bridge reports that build on every post, and the masthead names the version
whenever Yahoo is the platform — on any screen, in either mode, rather than only
inside a draft that has already started. A banner says when the build does not
match the file on disk. A copy too old to name itself reads as behind rather
than as unknown, and a copy run straight from the repository is never called
stale.

Silence is answered too, because none of those readings expires on its own: a
bridge posts only from inside a draft room, so "current" is a fact about a copy
that was talking then. Fifteen seconds without a post takes the reassurance
away, says in the masthead how long it has been, and raises a banner naming both
causes. A bridge nothing has ever heard from is not called silent, because a
draft room nobody has opened yet looks exactly like that.

What that episode turned out to be is worth knowing before your own draft.
Chromium's per-extension **"Allow user scripts"** control is a separate gate
from the `userScripts` permission. With it off, Tampermonkey registers nothing
and injects nothing, while every other account of the script agrees that all is
well — the dashboard shows no warning, the stored copy is correct, the update
check passes, and the served file is right. Only the page disagrees.
`window.WebSocket` still being unpatched in the draft room is the one-line
check, and a bridge that logs no version banner has not run at all.

**A pick says which starting slot it fills.** The take line under the
recommendation knew only that a candidate went into some open slot, so it said
"You still have to start one" — which, reported from a live draft on 2026-09-07
by a user who had just drafted a tight end, reads as being told to take a
second. The arithmetic was right and the sentence was not: a flex takes a back,
a receiver or a tight end, so with the flex empty a second tight end genuinely
does fill a starter. The other branch was wrong the same way, claiming a full
lineup where all it knew was that this player filled nothing.

It now names the slot: "He fills your open WR slot", or your flex, or your
superflex, or "He fills no starting slot, so this is depth." Naming it is worth
more than politeness, because it names the bar the player should be judged
against. A service too old to send the slot has the clause dropped rather than
guessed, and the panel over the draft room takes one of three words or nothing,
so the page under it cannot put arbitrary text on the panel.

**Everything the service hands out follows `PORT`.** Set it and nothing
downstream used to move: the bridge posted to a port nothing was listening on,
the manager checked a closed port for updates so the copy could never refresh
itself, the panel read nothing, and the app's "reinstall from the service" link
was dead at the moment you had just been told to click it. That last one is this
project's own recurring failure arriving by the one route the build stamp cannot
see, since a bridge that never reaches the service reports no build to compare.
The file keeps a working default and the service rewrites on the way out, so a
copy served on the default port is byte for byte the file on disk, and a copy
run straight from the repository still works unmodified.

**A per-feed age, on the draft screen.** Each ADP feed now says how old its own
reading is, so a stale one is visible during the draft rather than hidden behind
a fresh one.

**Yahoo's player data now arrives without a browser.** It makes the privacy
boundary sharper rather than looser. Yahoo's API turns out to have two halves
that do not authenticate alike: anything about *your league* needs your session
cookie, and anything about *players in general* needs nothing at all. So the
pool — all 2888 of them, with injury status, bye weeks and an ownership
percentage carrying a weekly delta — is now an ordinary feed the service
fetches and caches for itself, alongside Fantasy Football Calculator, Sleeper
and ESPN. Your league still never leaves your browser except as parsed data you
asked it to send. The rule was "no credentials in the service"; it now reads
"the service fetches what needs no credentials, and touches nothing that does".

It also picks up the vocabularies a league's own settings have to be read
against, which includes the full list of flex slots — something this project had
written down as unknowable and which Yahoo publishes outright.

### Fixed

**Your own team is there when the in-season screen opens.** Reported from the
app: opening the league from the masthead listed every rival's roster and not
the reader's own, and the week's advice was missing rather than pending.
Clicking the league in the picker, or pressing Read, brought both in - which is
the tell, because those are the other way into the same screen. Your own roster
is shown once, at the top, inside the week's panel, and that panel waits on a
second request the masthead never made. Both ways in now ask for the same three
things, so neither can render half a screen again.

**A player the advice moves is moved, not benched and started.** The third
round of one defect, reported from a real board each time, and the last two
were fixes that did not go far enough. Where the best lineup keeps a player but
wants him in a different slot - a back at `RB` that belongs in the flex - the
swap table named him twice, once as benched and once as started, which reads as
a bug in the one place that tells you what to do.

Whether a player starts and which seat he sits in are two questions, and every
version of this until now answered them as one. The swaps are now worked out
over the whole lineup, so they only ever name a player entering or leaving it,
and a player who stays and shifts slot is reported separately as the relocation
it is: "Move Justin Jefferson from WR to W/R/T. Still starting either way - a
slot change, not a swap." Both the app's screen and the panel over Yahoo's
league page say it.

Where nobody comes out of the lineup for an incoming player, the bench column
now says `nobody` rather than `empty`. Either the seat was empty or a
relocation freed one; both are a lineup that gains a starter rather than
exchanging one, and only the first was ever an empty seat.

**The desks disagree about players, not about seats.** Reported twice from a
real board on 2026-09-09, the second time as a partial fix. First: a lineup
with two `RB` seats showed Christian McCaffrey started by Sleeper in one and by
ESPN in the other, and the screen named him on both sides of the disputed table
while reporting nothing as agreed. Then, once seats of the same slot were
grouped: the same player, started at `RB` by one desk and in the flex by the
other, named on both sides again.

A player is worth the same points in every seat he can fill, which is what
makes the best lineup computable at all. So a *set* of startable players scores
the same however it is seated, and two desks recommending the same set are
giving the same advice whatever slots their two matchings used. What they can
differ about is who starts. Both reports were the same mistake — comparing the
desks somewhere narrower than the thing they disagree about — and the unit is
now the set of starters, which covers seats and slots at once.

The table changed with it. A row is a player against a player rather than a
seat, so the slot sits beside each pick and says where that desk would put him;
the heading counts players; and who both desks start is now named underneath,
which the service had been working out and throwing away. On the board that was
reported, three disputed seats naming McCaffrey twice become one decision.

**Un-starring a player takes him out of your Yahoo queue.** Reported live in
league 876392 on 2026-09-07, by the run that first proved the write works at
all: the star could add and could never take back. Nothing distinguishes the
app's own entries from yours by looking at the room, and after any write Yahoo
echoes the app's list straight back in a `Q|`, so the queue read off that frame
held the app's own choices wearing your clothes. Merging it whole underneath the
stars rewrote every player the app had ever queued, on every beat, for the rest
of the draft.

The room now remembers the ids it asked for, and only what is left after
subtracting them is treated as yours to protect. The rule itself does not move:
a queue this app never wrote is still never cleared, and an entry you made in
Yahoo's own panel still survives every write that does not name him. What
changed is which list the rule is applied to. The disclosure under the control
said "merges and loses nothing", which was true of your entries and had become
misleading about the app's, so it says what it does instead.

Two costs are recorded rather than fixed. A service restarted mid-draft forgets
whose entries were whose. And an empty list is still never sent, so the last
player the app queued has to be deleted in Yahoo's own panel — un-star in the
app first, because deleting while starred writes him back.

**The queue is written again after the service restarts.** The app posts its
wanted list only when the list changes. A service restarted mid-draft comes back
with the room whole — the bridge says the picks, the pool, the seats and the
last `Q|` again — but nothing says the app's own wanted list again, because the
app is the only place it exists, and the app's own guard still held the same
string. So queue writing alone stayed dormant until a star was touched. The
picks read now carries the queue's state on the beat the app already listens to,
and a service that has forgotten lifts the guard for exactly one post.

**The autodraft queue is a plan, not four ways to make one pick.** Reported live
as Yahoo taking two defences, and then two kickers. The queue was built from the
same list that fills the row on screen, which is a pick and three substitutes,
each priced against the roster as it stands — so the same position stays on top
and the next man at it comes up again. That is correct for advice, and it became
a plan with a wasted pick in it because Yahoo reads a queue as successive picks.
Late on is where it showed: worth over replacement is what puts a position on
the list at all, and by the end the positions with anything left worth having
are the ones with a single slot. The queue is now built by advancing the roster
as it goes, so a position that reaches its cap drops out of everything below it,
counting both what you already hold and what your starred players would add. The
row on screen still repeats a position, because for one pick that is the right
answer.

**Replacement starters are allocated inside the slots your league actually
has.** The live 12 team half-PPR board allocated 131 replacement starters
against 108 real slots, which inflated back and receiver worth against
quarterback and tight end for every player on it. It was silent, and it was on
every board.

**The board keeps measuring your actual room while you are on the clock.** The
forecast returned nothing whenever it was your turn, so every measurement of the
room you are really in was dropped for generic ADP at the one moment the pick
had to be made. The screen and the forecast now read one horizon, with your own
turn stepped over rather than played by the computer. Alongside it: a player far
past his ADP stops reading as certain to last, because the survival tail is now
read in logs; the best survivor is measured by what he is worth rather than by
ADP order, so both sides of the waiting-cost subtraction mean the same "best"; a
player no run leaves on the board reads as an explicit zero, which three
consumers had been reading two different ways; and a corrected live pick reads
as a change rather than as the same room, with out-of-order poll answers
dropped.

**A pick is scored on what two turns come to.** The score was a player's worth
counted twice and what you would do instead not at all, which on the audit's own
table took a back for 150 over the receiver worth 170. It is now his worth plus
the best you would expect at another position you still have to start. The two
numbers the panel prints are the two the pick was chosen on.

**The advice follows the two rules the computer teams already followed.** Both
were in the opponents' code, described there as hard rules, so the app was
holding its own opponents to a standard it did not hold its own advice to. Once
your picks left equal your open starting slots, only a candidate that fills a
starter is weighed; and beating a replacement starter orders the list rather
than qualifying for it. Before this it would name a backup quarterback worth 100
over the receiver worth 30 who would have filled your last empty slot, and
return no queue at all from a pool of thirty sub-replacement backs.

**A flex filler is priced at what a flex costs to fill.** With a tight end held
and the flex open, a second one was priced against roughly TE12 in a one tight
end league — a soft bar the top of that board is steep above — while the slot he
was competing for was the flex, whose bar is a back or a receiver. Worth over
replacement asks what the slot would otherwise hold, so a candidate taking a
flex or a superflex is now priced over that slot's own bar, and the take line
says which bar it stands over. Between two flex candidates the one with more
points wins rather than the one with the softer bar. The pool's WORTH column
does not move, because that is a fact about a player at his position rather than
about your roster.

**A position your league cannot start is kept off the board.** It was being
priced and offered in a league with no slot for it.

**A two-way player's projection reaches his board row.** Where the position a
player is filed at is not one a roster can hold, his projection is now read at
the first eligible position that is, so the market already holding him at
receiver gets the projection instead of an empty column. Travis Hunter is this
season's case: `fantasy_positions` is `["DB", "WR"]` and only `player.position`
says DB, and the three points columns of 65.6, 83.1 and 100.6 are each exactly
17.5 apart, which is 35 catches at half a point rather than any tackle total.

**Every player carries his team's bye.** 399 of 626 rows had no bye while the
board already knew all 32 teams' weeks, so a roster of starters who all sit in
week 7 showed an empty column, no clash highlight and no clash in the grade — a
missing field reading as a covered roster. The bye is now read off the team,
because that is whose week off it is.

**A feed that answers badly is treated as a failed fetch.** A response that
parses cleanly but carries no players, or none at a position the board expects,
used to overwrite a good cached snapshot with an empty one, because a
valid-but-empty response does not throw. The prior snapshot is now kept and
marked stale. There was also no timeout anywhere in the service, so a hung ESPN
could hold the whole board behind the other feeds; every feed now carries one,
and ESPN is awaited only where it prices the board.

**The key on the draft screen can be read to the end.** Open, it was 2143 px of
key in a 724 px column that clips rather than scrolls, so everything past ALL 3
was off the bottom with no way to reach it, and the player list — the point of
the screen — was squeezed to nothing. One term also carried two cells, and the
grid places what it is given: the second landed in the term column and pushed
every entry after it a cell along, so R, the alternates, HANDCUFF and COVERS
each read with their label and their meaning in the wrong columns. Checked open
at 1440x900, 1440x650 and 430x844.

**The stale-bridge banner no longer tells you to reload the draft room.**
Yahoo's `auth` is single use: reloading the URL does not reconnect, it leaves
the draft. So the one banner that fires mid-draft, against a bridge that is
still mirroring picks correctly, was advising the thing that ends your draft, to
fix a fault whose whole cost is an unwritten queue. It says to re-open the room
from the lobby instead, with the reason after it.

**The survival bar had never been drawn at all.** Its fill is a `span` inside a
plain `span`, so it stayed `display: inline`, and an inline box takes neither a
width nor a height: the element measured 0 by 0 and painted nothing, in every
theme, since it was written. What was on screen under each player was the track
alone — a bare grey rule, which is exactly what "the bar doesn't fill" and "the
bars are colourless" look like. The track survived only because it is a grid
item and so was blockified for free, and the cost-of-waiting panel's equivalent
has always worked because that one is a `div`.

**The survival bar is drawn where it says something, and says the word where it
does not.** It was on every row and moved on almost none of them. Measured on a
real board: of 620 players 593 read exactly 100 per cent and 7 read 0, leaving
20 anywhere in between; several rounds in it was 547, 2 and 34. The model is
why — a player goes at his ADP with a spread of about a ninth of it, so "might
or might not last" is a band roughly twenty five players wide and everyone
outside it is certain either way. Because the pool is sorted by ADP or by worth,
the top of the screen was always the certainly-gone end, and it drew a two per
cent stub that looked like a broken control rather than a confident zero.
Scrolling past your own next pick only reached hundreds of identical full ones.

The bar now appears only where the answer is in doubt. A player who will not
reach your turn says "gone by 5.06 #54" instead, and one who certainly will says
nothing and gives the row back its height. The bars that remain carry their
position's colour, and where one is under 25 per cent it is painted as a warning
instead, which is a signal now rather than the whole screen at once.

**The consensus column says which feeds it means.** It was labelled CONS, which
named neither the sources nor the arithmetic. It is now ALL 3, because that is
what distinguishes it from ADP: it is always the mean of Sleeper, Fantasy
Football Calculator and ESPN, whichever of them you chose to price the board
with. The key also now says the thing that was silently true — choose Averaged
with all three feeds and ALL 3 is the same arithmetic as ADP, so the two columns
show the same number and only one of them is telling you anything.

**"Refresh ADP" forces one fetch, not every fetch for the rest of the session.**
The token behind the button only ever counted up and was tested against zero, so
one press at setup left every later board fetch forcing its way past the cache
and back out to all three upstream feeds — on a scoring change, a league size
change, a feed change, and now on a draft room turning up. A press is one forced
fetch again.

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

**The board can set your Yahoo draft queue.** Off unless you turn it on, over a
Yahoo draft, with the Yahoo queue control above the player list. `Mirror` sends
the players you star; `Autodraft` sends those and then the board's own picks
after them, so a clock that runs out takes a player worth having. It is not an
autodrafter and does not make a pick: a Yahoo queue fires when your clock
expires, which is insurance for a pick you might miss rather than a pick made
for you. The frame that would take one outright is now documented and is
deliberately absent from the bridge.

Your own Yahoo entries are never dropped, and **First** says whether yours or
theirs go on top. The one exception is a write made before the room has ever
reported a queue, which replaces whatever was in it, unseen. That happens when
the bridge attached after the socket was already open: Yahoo does report a queue
unprompted, on the connect burst, arriving bare when the queue is empty — so a
bridge that joins with the room is told the queue within a second and never has
to write in ignorance. The control says so, and every write after the first
merges.

All of this came out of `tools/yahoo/`, which had been holding the answer since
September: `S|<league>|<team>|<ids…>` sets the whole queue and `Q|` echoes it
back, across 32 writes nobody had read. `docs/yahoo-draft-protocol.md` had
listed the client as sending one frame and `Q` as unknown; it now carries the
queue, the pick frame, and what `5|` and `6|` appear to be.

**A rookie is marked, and ADP says how firm it is.** A player with no NFL season
behind his projection carries an R next to his team and bye. Hovering ADP now
says the spread in picks and how many real drafts measured it, or that no feed
measures him and the spread is estimated from his ADP — which is what the bar
under the row is worked out from, and the difference between 1,806 drafts
agreeing to within half a pick and forty agreeing to within twelve.

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
but a 14 team snake. Run a mock beside the board before trusting it.

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
