# Project decisions

Closed decisions that constrain future changes, newest first. Entries are
appended and never rewritten; a reversal is recorded by adding a new entry and
marking the old one superseded.

Record a decision only when it constrains future work and its rationale cannot
be recovered by reading the code. Routine implementation choices belong in the
diff. This project comments its own reasoning unusually thoroughly, so most of
what would otherwise land here is already next to the code it explains.

## 2026-09-09 The week's advice goes in the reader's panel, not a panel of its own

Status: Accepted, by the repository owner. Supersedes the delivery half of
`TASKS.md`'s Y9.4, which planned a separate bookmarklet; the acceptance criteria
in that task are unchanged and are what this was built against.

### Decision

The advice over Yahoo's league pages is painted by
`userscript/league-reader.js`, in the panel it already draws, immediately after
each read. It is not a second install. `draft-panel.js` stays as it is: the
draft room and the league page are different pages doing different jobs.

### Why the plan changed

Y9.4 was written on 2026-09-08, when the reader was a bookmarklet that ran only
when clicked. A panel showing advice therefore had to be its own thing, because
there was nothing already running on the league page to put it in.

The entry above changed that the same day the panel was asked for. The reader is
now a userscript that runs on every league page load and polls, so there *is*
something already there — and it knows the one thing a separate panel would have
to guess: when a fresh reading landed. The advice is fetched straight after the
post that produced it, so what is on screen is always the reading above it. A
separate panel would have had to poll the service on a timer and would still
have shown advice from a snapshot it could not date.

Against that, the cost of a second install: a second build to keep current, a
second thing to go stale, and a second manager or bookmark for the user.

### Cost, stated plainly

**The advice display now rides inside a userscript**, and the 2026-09-05 panel
decision refused exactly that — "a thing that needs no privileges should not
inherit the failure modes of one that does". That reasoning was about the
*bridge*, which must be injected at `document-start`. It does not transfer here:
reading the league and showing what the app makes of it are one job on one page,
and the reading already needs the manager. There is no privilege the display
inherits that the reader was not already carrying.

What is real is that a manager that stops running loses both halves at once. The
answer is the same as the entry above: the bookmarklet still exists and still
reads, the panel is visible whenever a beat is running, and the reader's build
report is the piece still to build.

**The advice sentences are a second copy of the app's**, with nothing checking
they agree — the cost Y9.4 accepted in advance and the same one the draft take
line already carries. `reader.test.mjs` pins the panel's own wording against a
fixture of the endpoint's shape, which catches the panel drifting from the
endpoint but not the panel drifting from the app's screen.

### Rejected

**A separate bookmarklet, per Y9.4 as written.** Above.

**Letting the panel set a lineup.** Never considered seriously and recorded so
nobody proposes it as an obvious extension: `SPEC.md` gives recommendations
only, and setting the lineup stays the user's action in the page underneath.
The one write this project makes to a platform is the draft queue, and the
reasoning that justified it does not reach a roster move.


## 2026-09-09 The league reader is a userscript as well, and polls on a beat the user sets

Status: Accepted, by the repository owner, on the condition the original entry
named. Narrows `The in-season reader is a bookmarklet, like the panel`
(2026-09-08) without superseding it: the bookmarklet stays and is still the
install this project points a new user at first.

### Decision

`userscript/league-reader.js` is served two ways from one source. As a
bookmarklet from `/league-reader`, unchanged: one reading, when clicked. As a
userscript from `/userscript/yahoo-league-reader.user.js`, matched to
`/f1/*`, it reads when the league page loads and then again every N minutes
while the tab is open. N lives in `localStorage` on Yahoo's own origin, defaults
to 10, and zero means read on load and never again.

The service stamps which mode the copy it hands out is, because nothing inside
a script can tell how it was invoked and the two behaviours must not be guessed
at. It is not folded into `yahoo-draft-bridge.user.js`; that was rejected in the
2026-09-08 entry and nothing here reopens it.

### Why now, and not on 2026-09-08

The earlier entry did not reject a userscript. It deferred it, and named the
condition:

> it should be reopened if the workflow turns out to want it — in particular if
> a league tab stays open all season, when a userscript could poll and keep the
> snapshot warm with no interaction at all. Wait for a screen that consumes the
> snapshot before judging that: there is none yet, and refresh ergonomics
> guessed at without one are guessed at.

Y9.3 built that screen. The owner then used it, and the click became the thing
in the way: a service restart drops the snapshot, so the weekly advice screen
answered "nothing read yet" until the bookmarklet was clicked again, and a
lineup changed in Yahoo did not reach the app at all until it was. That is the
workflow the deferral was waiting to see.

The setting is what makes it one decision rather than two. The 2026-09-08 entry
argued a click is a fair price "at the frequency in-season advice is actually
used", which is a claim about a frequency nobody had measured. A beat the user
sets does not need that claim to be right, and zero is the old behaviour still
available to anyone who agrees with it.

### What it costs, stated plainly

**A userscript manager is a place a script goes stale in silence, and that has
not changed.** It is the whole reason the panel stopped being a userscript and
the reason this was a bookmarklet first: 2026-09-07 cost three mock drafts to a
manager that served, stored and listed 1.3.0 while running 1.0.0, and the cause
was a per-extension "Allow user scripts" control that was off while the
permission itself was granted — a state in which nothing registers, nothing
injects and nothing complains.

Three things hold against it, and the third is not built yet:

- **The bookmarklet is kept.** Whatever the manager does, there is an install
  that cannot fail without saying so, and the install page says which is which
  and names the control to check.
- **The panel stays on screen while a beat is running**, rather than fading like
  the bookmarklet's message. A reader polling somebody's league for a season
  should not be invisible, and it is the only place that can stop it.
- **The reader does not report its build back.** The bridge does — `bridge.js`
  stamps a build into the copy it serves and the running copy reports it, so the
  masthead can say when an install is behind. The reader stamps the build and
  nothing reads it back. Until that exists a stale reader polls perfectly while
  posting a shape the service has moved on from, which is the 2026-09-07 failure
  with a slower fuse. It is the next piece of work and not a hypothetical.

**It only reads while a Yahoo tab is open.** No beat makes the service able to
fetch a league: `/fantasy/v2/league/…` is 401 without the cookie and the service
must never hold one. So the app still cannot hold a current picture of a league
nobody has opened, and this narrows that rather than fixing it.

**It is eleven requests a beat** in an eight-team league — three league
resources and one per roster. At ten minutes that is about 1,600 a day against
Yahoo from the user's own session. The offered intervals are 5 minutes and up
and the code floors any hand-edited value at five seconds, which is a runaway
guard rather than a rate limit.

### Rejected

**Gating the beat on tab visibility.** The obvious economy, and it would break
the feature: the whole shape of this is a league page sitting in a background
tab while the user looks at the app in another, so the tab doing the reading is
the tab nobody is looking at nearly always. Skipping hidden tabs would stop
exactly the case it was built for.

**Persisting the snapshot to disk so a restart keeps it.** This would have
addressed the complaint that started the conversation more cheaply, and it is
refused by requirement rather than by preference: `SPEC.md` keeps private league
snapshots out of the disk cache, and the 2026-09-08 entry on fetching Yahoo's
public half turns that into the boundary the whole arrangement rests on —
"public player data on disk, private league data in memory only". A beat reaches
the same outcome without touching it, because a reader that polls re-reads a few
minutes after a restart on its own.

**Putting the interval in the app's settings, where every other setting lives.**
It cannot go there. The app is a different origin, no page can read another's
storage, and the service holds no user state by design. Yahoo's own origin is
the only place the reader can both write and read, so the control has to be on
the panel it draws there.


## 2026-09-09 The in-season scoring join is the service's, and only verified components get a number

Status: Accepted. The seam was chosen by the repository owner when Y9.1 asked;
the verification rule is a finding from building it. Constrains Y9.2 to Y9.4 and
anything later that scores a projection.

### Decision

Two things, and the second is the one with teeth.

**The scoring lives in the service**, as `server/src/platforms/yahoo/scoring.js`
beside `inSeason.js`, with the weekly feeds as `sources/sleeperProjections.js`
and `sources/espnProjections.js` cached on disk like the other public feeds. The
alternative considered was a module in the client engine, on the good argument
that the draft engine's purity is what makes it testable.

**A component gets a number only if it has been reproduced against a feed's own
published points.** Everything else is reported as an unsupported rule. In
practice that means eleven of Yahoo's 108 stat categories are scored, and
kickers and team defences are not scored at all -- so **a K or DEF slot gets no
projection, from either desk.**

### Why the service, and not the engine

Because Y9.4 needs the Yahoo-page panel to read one advice endpoint, and the
entry above already committed to the numbers having one home. Service-side gives
that directly. Client-side would have needed the draft path's `putAdvice`
pigeonhole -- the app computing and posting, the bridge collecting -- which for
a draft is right, because the engine that prices a pick genuinely lives in the
client, and which in season would mean the panel shows nothing unless the app
screen happens to be open. A lineup is not set with the app open beside it.

It also follows the data. The components come from feeds the service fetches and
the modifiers from a snapshot the service holds, so a client-side join would
ship both across the wire to compute what the service already has in hand.

### Why only what was verified, which is the expensive half

Because the failure mode of a guess here is invisible. A mis-mapped stat id
produces a total of the right shape, in the right range, that sorts sensibly
against the others and is simply not this league's points. Nothing downstream
can tell, and the user cannot either.

Three readings decided it, and the third is the one that changed the answer:

- ESPN's own `scoringItems` names ids and never their meaning, and the twelve
  offensive ids Y9.0 established were confirmed a second way -- the median ratio
  between ESPN's value and the Sleeper component naming the same quantity, over
  players both desks project. Passing yards 0.986, receiving yards 0.991,
  receptions 0.980. Two desks measuring one quantity.
- Correlation alone cannot do that, which is why the ratio was used. Inside a
  position group every stat correlates above 0.95 with every other, because they
  all scale with a player's volume, so a correlation test matches a
  quarterback's interceptions to his completions.
- **A good fit is not verification when the system is underdetermined.** Solving
  for Sleeper's kicker ruleset by least squares fitted all 32 kickers to within
  0.008 -- and returned a 30-39 yard field goal at -0.29 points and a blocked
  kick, on the defensive fit, at -4.22. The control run settles it: the same
  method on running backs, whose scoring is known, recovered a lost fumble at
  -0.68 against its true -2. Twelve to twenty-one free parameters fit thirty-two
  observations whatever they mean.

So a kicker's and a defence's components could be tabulated but not checked, and
this project does not put a number in front of a user that rests on a guess
about what an undocumented field means.

### The cost, accepted rather than discovered later

**The first useful in-season release cannot advise on a kicker or a defence
slot.** Y9.2's optimiser will have no projection for either, Y9.3's screen has
to say so rather than showing a blank, and a league scoring field goals by
distance or points allowed will see those rules listed as unsupported. That is a
real reduction in what Phase 9 delivers and it is the honest one: the
alternative was 32 defences ranked against each other on two hundredths of a
return touchdown.

It was nearly worse. ESPN files a return-touchdown projection against every team
defence, so the first version of the reader -- which kept any row carrying any
component -- put all 32 on the board at about 0.14 points under a league that
scores return touchdowns. It looked exactly like advice. `SCOREABLE_POSITIONS`
in `sources/components.js` is the rule that stops it: the test for whether a
player is projected is not whether any component is present but whether the
position's scoring can be represented at all.

### What would reopen it

A published vocabulary for either feed's kicker and defence fields, or any
source that publishes a kicker's points against components it also publishes, so
the mapping has something to be checked against. Yahoo publishing points at
game scope would do it too, and it does not -- stats come back raw, which is the
whole reason this file exists.

## 2026-09-08 Weekly advice lands on both surfaces, and the app screen goes first

Status: Accepted, by the repository owner, asked before Phase 9 was split into
tasks. Constrains Phase 9 and every phase after it that produces advice.

### Decision

Weekly advice renders in two places, and the order is not arbitrary.

**The app's in-season screen first**, as the full surface: the current lineup
against the best legal one, both projection sources with their spread visible,
per-feed age, and every limit spelled out. This is where a reading that needs
room to explain itself belongs, and it is the only surface `npm run shots` can
photograph, so it is the only one a check can see.

**A panel over Yahoo's own league pages second**, as a compact reading of the
same numbers, on the exact pattern `userscript/draft-panel.js` already proves:
a bookmarklet, one element on the end of the body holding a shadow root, every
part of it ignoring the mouse except its own close button, no storage, no key
handler, no focus. It reads the service on the loopback and paints. It never
talks to Yahoo, never reads a cookie, and **never writes a lineup** -- the user
still makes every change themselves, which is what `ROADMAP.md` Phase 9 already
required.

### Why

Because the advice is consumed where the lineup is set, and that is Yahoo.

The app screen alone would put the reading one tab away from the only page that
can act on it, and a start/sit call is read and acted on in the same minute. The
draft side of this project already learned the same lesson from the other
direction: the panel exists because a board's reading of a room is wanted over
the room, not beside it.

The panel second rather than first because the calculation has to be right
before a second renderer of it is worth having, and because the app screen is
the one a check can photograph. Building the harder-to-observe surface first
would mean debugging the arithmetic and the injection at once.

A bookmarklet rather than a userscript, again: the 2026-09-05 entry settled that
a thing needing no privileges should not inherit the failure modes of one that
does, and the 2026-09-08 reader entry applied it a second time. Nothing here
wraps `WebSocket` at `document-start`, so nothing here needs a manager.

### The cost, accepted rather than discovered later

**Every sentence of advice becomes a second copy, and nothing checks the two
agree.** The panel is a separate script that cannot import from the client, so
`fillsStarter`'s take line is already one string in two files -- recorded in
`AGENTS.md` and hit once, when the take line was corrected on 2026-09-07 and had
to be corrected twice. Phase 9 adds more such sentences than the draft board
has.

This is accepted knowingly, not solved. What makes it tolerable is that the
numbers are not duplicated: both surfaces read one endpoint, so the arithmetic
has one home and only the wording has two. A future consolidation, if the
wording drifts far enough to hurt, is to serve the sentences from the endpoint
alongside the numbers rather than to make the panel import anything.

**The panel cannot be photographed by `shots`**, because it renders on a Yahoo
page and `shots` drives this app. So its rendering is manually validated by
construction, exactly as the draft panel's is. The endpoint behind it is
checkable and must carry the coverage the panel cannot.

### What this does not decide

- Whether the panel polls on a beat or paints once when clicked. The draft
  panel polls at 2500ms because a draft moves; a lineup does not move that way,
  and the answer is Y9.4's to pick from what the screen needs.
- Whether the panel ever appears on any Yahoo page other than the league's own.
  It matches what it is clicked on, and widening the draft bridge's matches
  stays rejected, per `PLAN.md` and the 2026-09-08 reader entry.
- Anything about writing to Yahoo. There is no lineup-write path, this does not
  open one, and `SPEC.md`'s non-goal on writes stands unchanged apart from the
  draft-queue narrowing already recorded.

## 2026-09-08 Two joins, because a Yahoo id and a name answer different questions

Status: Accepted. Applies to `server/src/platforms/yahoo/inSeason.js`, and
constrains Phase 9, which inherits the second join rather than writing one.

### Decision

A league snapshot is joined twice, and the two are not interchangeable.

**To Yahoo's own player pool, exactly, on the whole `player_key`.** All three
Yahoo surfaces this project reads write a player the same way: the draft room
sends `470.p.7200`, the league scope answers `470.p.<id>` and the public game
scope answers `470.p.40059`. So there is nothing to match, and `names.js` is not
asked. The whole key is used and not the bare id, because the id is stable
across seasons while the game code in front of it is not: joining on `40059`
alone would match last season's record for the same person, with the wrong team
and the wrong bye on it, and look like a success.

**To the cross-source board, through `names.js`.** Fantasy Football Calculator,
Sleeper and ESPN have never heard of a Yahoo player id, so a name, a position
and a team is all there is. Every eligible position is tried rather than the
first: a board row holds one position and the sources disagree about which,
so a player Yahoo lists as `RB,TE` whom Sleeper calls a tight end is missed by
a first-only join. That is not hypothetical -- it is Riley Nowakowski, measured.

A composite slot such as `W/R/T` resolves from the published vocabulary, by
looking each part of its `display_name` up against the single positions' own
display names in the same list. Not from a letter table.

### Why

Because the alternative to each was measured and is worse.

Using `names.js` for the Yahoo half would be choosing a fuzzy match over an
exact identifier, which can only lose. Against the real feeds the id join is
1195 of 1195 on every player eligible at a position the board covers; a name
join cannot beat that and can put the wrong person on a roster.

A letter table -- `W` is a receiver, `R` a back -- is this project deciding what
Yahoo's slots mean. `/game/nfl/roster_positions` publishes all 21 slots and,
measured, carries **no eligible-set field at all**: `position`,
`abbreviation`, `display_name`, `position_type` and nothing else. But a
composite's display name is exactly the singles' display names joined by a
slash, so the list explains itself, and a composite Yahoo adds later resolves
without this repository being edited. A composite whose parts do not all resolve
is reported unresolved rather than half answered, because half a flex's eligible
set would pass a player who cannot fill the slot.

### What this does not decide, and the cost

**The board covers six positions and Yahoo's pool covers twenty-one.** The
board is a draft board -- `DRAFTABLE` is QB, RB, WR, TE, K, DEF -- and the pool
carries `OFF` whole-offence entries and every individual defensive position
besides. Measured against real feeds, the board join is 100% of every player
owned in a tenth of leagues or more and 33% below one percent ownership, and
every miss above five percent ownership is an `OFF` or IDP record. So a league
with IDP slots will show its defensive starters as board-unmatched, honestly and
by construction. Those slots still resolve, and the players still appear with
their eligibility; what they have no cross-source row for is a projection. Y8.4
owns saying so on screen, and Phase 9 owns whether such a league can be advised
at all.

Nothing here scores, projects or recommends anybody. The weekly calculation is a
separate module in a later phase and should not grow out of this file.

## 2026-09-08 The service fetches Yahoo's public half; the browser keeps the league

Status: Accepted. Narrows `The in-season reader is a bookmarklet, like the
panel` below, which decided how a *league* is read and did not know this
existed.

### Decision

Yahoo's API has two scopes, and this project treats them as two different
sources.

`/fantasy/v2/game/nfl/...` is public. **The service fetches it directly**, with
its own module under `server/src/sources/`, cached on disk through
`server/src/cache.js`, exactly as Fantasy Football Calculator, Sleeper and ESPN
already are. No browser is involved and no click is needed.

`/fantasy/v2/league/<key>/...` is not public. It stays exactly where the
bookmarklet decision put it: read in the browser, on the user's own cookie,
posted to the service, held in bounded memory and never written to the disk
cache.

### Why

The scopes do not authenticate alike, which was measured rather than assumed.
Asked with no cookie at all, from a shell, every league path answered `401`
with "You must be logged in to view this league" and every game path answered
`200`. Same league, same season, same minute. `docs/yahoo-in-season-data.md`
records the reading and `docs/in-season-data-sources.md` places it against the
other three feeds.

What sits in the public half is most of what weekly advice needs about players:
the 2888-player pool, injury status and detail, bye weeks, an ownership
percentage carrying a weekly delta, ADP, the 108-stat vocabulary and the week
dates. None of that is about anyone's league, so making a user click a
bookmarklet to obtain it would be asking them to authorise a public fact.

Three things follow, and they are the reason this is worth an entry:

- **It is a feed, so it gets what feeds get.** One fetch serves every request
  rather than one per snapshot, the existing disk cache and staleness handling
  apply unchanged, and an in-season screen can render player data with no Yahoo
  tab open anywhere.
- **The privacy boundary gets sharper, not blurrier.** The rule was "no
  credentials in the service". It now reads: the service fetches what needs no
  credentials, and touches nothing that does. Public player data on disk,
  private league data in memory only, which is what `SPEC.md` already asks for.
- **The bookmarklet gets smaller.** It reads four league resources and does not
  grow a fifth for the pool.

### What was rejected, and what would reopen it

Widening the bookmarklet to fetch the game scope too, keeping one transport.
Rejected because it makes a public fetch depend on a click, a Yahoo tab and a
session, and because it would put the same bytes through a per-snapshot path
instead of a shared cache.

Leaving the choice until a screen existed, which is how the
bookmarklet-versus-userscript question was deliberately handled. Rejected here
because that question turned on a cost only a consumer could weigh, and this one
does not: the scope boundary is measured, and the cheaper side of it is already
a solved pattern in this repository.

What would reopen it is Yahoo putting the game scope behind a session. The
symptom would be a `401` from a path that has never needed one, and the fallback
is the rejected option above — the bookmarklet already runs where a cookie is.

## 2026-09-08 Weekly projections come from two sources, and the disagreement shows

Status: Accepted. Extends the reasoning in `espnRanks.js` from draft ranks to
weekly projections.

### Decision

Weekly and remaining-season projections are taken from **both Sleeper and
ESPN**, kept separately with their own source, week and update time, and the
spread between them is shown rather than averaged away.

Yahoo is not a projection source; it publishes none at any public path. Fantasy
Football Calculator is not either; it has nothing weekly at all.

### Why

Both were measured to cover the full regular season — Sleeper weeks 1 to 18,
ESPN weeks 0 to 18 where 0 is the season total, so ESPN answers
rest-of-season directly rather than by summing. `docs/in-season-data-sources.md`
has the evidence.

Taking both is the same argument `espnRanks.js` already makes about the draft
board, applied one level along. Sleeper's weekly numbers are Rotowire's, which
it names in `company`. ESPN's are ESPN's own. Two independent desks disagreeing
about a player in a given week is information about confidence, and a mean of
the two destroys exactly that. The project already treats agreement between two
measurements of the same thing as one number counted twice, and this is the
opposite case: two genuinely separate opinions.

It also removes a single point of failure from the first feature anyone would
use. A week where one feed has not published is a week with an answer and a
caveat rather than no answer.

### What this does not decide, and the cost

It does not say how the two are combined into one recommendation. Showing a
range, preferring one as primary, or refusing to advise when they diverge past
some width are all still open, and belong with the lineup calculation in Phase 9
where there is something to test them against.

**Nothing here claims the two agree.** No comparison between them has been run.
How far apart they typically sit is unmeasured, and if it turns out to be wide
enough that the spread swamps the advice, that is a finding for Phase 9 and may
force this entry to be narrowed to one source.

The cost is two feeds to keep working instead of one, and a reconciliation step
that a single source would not need. Both were accepted with that in view.

## 2026-09-08 The in-season reader is a bookmarklet, like the panel

Status: Accepted. Applies `The panel is a bookmarklet, not part of the bridge`
below to a second thing that needs no privileges, rather than deciding anything
new about userscripts.

### Decision

Reading a Yahoo league in-season runs from a bookmarklet installed off the
service, on the same pattern as the panel: source in `userscript/`, served
stamped from a `/…` address, whole body carried in the bookmarklet. It is not
added to `yahoo-draft-bridge.user.js`, and the bridge's `@match` list is not
widened to league pages.

### Why

Something has to run on a Yahoo page, because every read that made this
possible worked only by the browser attaching its own cookie, and the service
must never hold one. That is the whole of the requirement. It is three ordinary
`fetch` calls against a stable API, wanted when the user asks for a refresh
rather than continuously.

Set against what the bridge needs, that is nothing. The bridge must be a
userscript because it wraps `WebSocket` at `document-start`, before Yahoo's
bundle builds one, and only a manager can inject that early. The panel decision
below already refused to give a thing needing no privileges every failure mode
of a thing that needs several, and the in-season reader is the same shape of
thing as the panel.

The evidence since is worse than when that was written. 2026-09-07 cost three
mock drafts to a userscript that served, stored and listed as current while
running a copy three versions old, and the cause turned out to be a per-
extension "Allow user scripts" control that was off while the permission itself
was granted — a state in which a manager registers nothing, injects nothing and
reports no fault anywhere. A second userscript is a second thing that can fail
that way, silently.

A bookmarklet has no install, no update, no version and no manager. Whatever it
does wrong, it does in the open.

The argument that settles it is smaller than it first looks, and worth stating
so nobody re-derives a bigger one. **Either way the read happens on a Yahoo
page**, because that is the only origin holding the cookie. A userscript would
not let the app refresh itself while the user sits in it; it would save a click
once they are already on the league page, not a trip. Against that click it
costs four requests on every league page load whether a read was wanted or not.
At the frequency in-season advice is actually used — setting a lineup, checking
waivers — a click is a fair price for failing in the open.

### Cheap to reverse, which is why it is decided now

Converting the reader to a userscript is adding a metadata header and a match to
the same file. Nothing on the service side moves, because it does not care who
posted. So this is not a door closing, and it should be reopened if the workflow
turns out to want it — in particular if a league tab stays open all season, when
a userscript could poll and keep the snapshot warm with no interaction at all.
Wait for a screen that consumes the snapshot before judging that: there is none
yet, and refresh ergonomics guessed at without one are guessed at.

### Cost, stated plainly

One click per refresh, where a userscript could have read on its own. In-season
this is closer to a feature than a cost — a snapshot is taken when the user
wants one, not on Yahoo's schedule or ours — but it is still a click, and it
means the app can never quietly hold a current picture of a league nobody has
opened.

The reader also has to run on a Yahoo page, which the panel did not: the panel
only needed a DOM, and this needs the cookie. So it cannot be clicked from the
app's own tab, and the install page has to say so.

### Rejected

Widening the bridge's page matches. It fails the test the panel entry set: the
bridge would gain a second job on pages it has no other reason to run on, and
the two would share an install, a version and a manager.

State the technical part accurately, because it is weaker than it sounds and a
later reader should not treat it as a wall. The bridge replaces `window.WebSocket`
at `document-start` and listens to every socket a page opens, identifying the
draft socket by frame content rather than by URL — and the queue write targets
whatever that guess landed on. Widening the matches widens that, since one file
has one `@run-at`. But the league pages that were captured opened no socket at
all, so the exposure was never observed, and a single guard on
`location.pathname` would confine the wrapper to `/draftclient/` anyway. The
objection is real and solvable; the shared install fate is the part that is not.

A second userscript, matched to league pages. This is the option worth keeping
warm rather than dismissing: it is properly separate from the bridge, which is
right — different sites, different jobs, different privileges — and it buys the
click back. It loses the bookmarklet's one virtue, which is that it cannot fail
to install without saying so. Revisit it against a real workflow, per above.

Reading the league pages' HTML instead, to avoid the API. Rejected on evidence
rather than taste: the sub-resources answer JSON directly, so the HTML route is
a megabyte of advertising-heavy markup parsed to reach data already available
in a documented envelope. See `docs/yahoo-in-season-data.md`.

## 2026-09-08 In-season advice stays in this repository, Yahoo first

Status: Accepted scope for planning by the user. Implementation is not started;
Yahoo in-season access and analysis sources remain to be demonstrated.

### Decision

Plan weekly lineup, waiver and trade advice as an extension of this local app.
Yahoo is the first in-season league platform because it is the user's current
league. Other league integrations follow later. League platforms and analysis
sources stay separate, so advice for Yahoo may use another provider's data.

Reuse the existing data and identity foundation where it fits, and keep
in-season calculations separate from the draft simulation. Preserve the
existing local operation and platform-write boundaries: the user carries out
lineup changes, waiver claims and trades in Yahoo. PLAN.md describes the
proposed implementation; SPEC.md and ROADMAP.md record requirements and phases.

### Why and alternatives

A separate repository would duplicate player matching, feed maintenance and
league conventions, or require maintaining a shared package before a second
independent product exists. Reconsider that split only if independent releases,
hosting or maintainers create a real need. Starting with Sleeper because its
reads are easier would delay usefulness for the user's actual league.

Draft ADP and the draft room bridge are not proof of weekly value or in-season
data access. Discovery against the real Yahoo league comes before dependent
features. The 2026-09-04 browser-access decision and the 2026-09-05 FantasyPros
exclusion still apply; this plan does not approve server-held credentials,
paid data, automatic transactions or a database.

## 2026-09-07 A shared slot is priced at what a shared slot costs to fill

Status: Accepted, by the user, off a live draft that showed it. Amends
`2026-09-07 A pick is scored on what two turns come to`, which stands: this
changes one of the two numbers that score names, not the scoring.

### Decision

A candidate who would fill a flex or a superflex is priced over that slot's own
bar -- the **highest** replacement level among the positions the slot takes --
instead of over a replacement at his own position. `PositionValue` carries the
replacement level its `now` was taken over, because two bars can only be
subtracted from each other when they come from the same allocation.

A candidate filling no slot at all is left exactly as he was.

### Why

Value over replacement asks how much better your lineup is with him than
without him, so the answer depends on what would otherwise sit in the slot he
takes. For his own position's slot that is a replacement at his own position.
For a flex it is not: a flex takes a back, a receiver or a tight end, so what
you would otherwise put there is the best of those you could pick up free.

Reported live on 2026-09-07. With a tight end already held and the flex open, a
second one was priced against roughly TE12 in a one tight end league, where the
top of that board is steep, and read far better than he was -- against a bar he
was not competing with. The slot he was competing for was the flex.

The direction is not a matter of sampling: the flex bar is a maximum taken over
a set that includes his own replacement level, so a flex filler's worth can only
fall or stay, never rise. Shared-slot candidates therefore move down relative to
candidates filling a slot of their own, and never up.

### What it does not do, deliberately

**The bench case is untouched.** A player who fills no slot is still priced over
a replacement starter he is not replacing, which overstates every backup. That
is the open half of M1 and R6 and it needs expected usable weeks, replacement
access and M4's calibration -- not another bar to swap. Two earlier entries
refused a bench multiplier for the same reason, and this is not one: no
coefficient is introduced, and the number it replaces a bar with is a
replacement level the allocation already computes.

**It does not change the pool's WORTH column.** That is a fact about a player at
his position on this board, the same for every reader, and it does not know
whose roster is asking. Only the recommendation is roster-aware, and only the
recommendation moves.

### What it costs

The printed number changes for a flex filler, so the line says which bar it
stands over: "over a replacement flex" rather than "over a replacement TE". The
two numbers a panel prints still have to be the two the pick was chosen on, and
they are.

## 2026-09-07 The queue this app wrote is the queue it may take back

Status: Accepted, by the user, during the live draft that found it. Applies
`2026-09-06 The bridge writes the queue, and nothing else` to the right list
rather than relaxing it; that entry stands.

### Decision

`queuePlan` subtracts the ids this service has handed the bridge from the queue
Yahoo reports, and merges only what is left underneath the user's stars. So
un-starring a player removes him from the room, while an entry the user made in
Yahoo's own panel still survives every write that does not name him. The room
keeps that record, per league, in memory with the rest of it.

The rule it was written under does not move: **a queue this app never wrote is
never cleared.**

### Why

Found live in league `876392`, by the run that first proved the write works at
all. Nothing distinguishes the two kinds of entry from outside: after any write
Yahoo echoes the app's own list straight back in a `Q|`, so a queue read off
that frame contains the app's own choices wearing the user's clothes. Merging it
whole under the stars therefore made the star one-way -- every player the app
had ever queued was rewritten on every beat, and un-starring him put him back.
A filled star that cannot be emptied is a control that lies about what it is.

The first implementation recorded the whole written list, which was wrong in a
way worth keeping here because it looks right: the merged write contains the
user's entries too, so those became the app's the first time they were merged,
and were dropped the moment nothing was starred. Only the part the app *asked*
for is the app's. Both halves of that are checked.

### What it costs

**A service restarted mid-draft forgets.** `written` is memory, like every other
part of a room, so a queue written before a restart reads as the user's own
afterwards and goes back to being unremovable. The bridge knows what it last
sent and could say so on reconnect; that is the fix if it matters, and it is not
built.

**Down to one, not down to none.** With nothing starred and nothing in the room
but the app's own past writes, the plan is empty -- which this makes reachable
where the old merge always echoed something back. An empty list is still never
sent, on the 2026-09-06 reasoning about what an empty queue may do to a seat, so
the last player the app queued has to be deleted in Yahoo's own panel.

**A player both starred here and queued by hand in Yahoo counts as the app's.**
The two are indistinguishable, and the star is the more recent statement of the
two. Un-starring has to mean something.

## 2026-09-07 A pick is scored on what two turns come to, not on worth counted twice

Status: Accepted. Amends the 2026-09-05 entry "The board names a pick, and
says nothing when there is nothing to say", which stands in every other
respect.

### Decision

`rankCandidates` scores each position's leader by what he is worth over a
replacement starter, plus what your next turn is still expected to bring once he
is taken -- the best expected value at another position you would still have to
start. The score was `now + (now - later)`.

Nothing else about the 2026-09-05 entry moves. Only position leaders are
weighed, a position at its cap is still not a pick, the three point naming gate
still withholds a verdict when there is no decision to report, and the
recommendation still shows its arithmetic so it can be overruled. The field the
panel draws beside worth is now `nextTurn` rather than `urgency`, because the
two numbers it prints have to be the two the pick was chosen on.

### Why

`2 * now - later` counts what a player is worth twice and counts what you would
do instead not at all, so it is a heuristic for scarcity rather than a
comparison of outcomes. The audit in `review/review.md` found a counterexample
inside its own numbers, as finding M1: with both slots open, a receiver worth 100
now and nothing later against a back worth 150 now and 70 later scored RB 230 to
WR 200 and took the back. The back now and the receiver later comes to 150. The
receiver now and the back later comes to 170. It gave up 20 points it had already
measured.

The replacement is the smallest thing that is actually a comparison: the two
turns added up. It agrees with the old heuristic in the ordinary case, because
the position that will not keep is still the one to spend a pick on. It
disagrees exactly where the double count was doing the work.

It also degenerates correctly, which is the strongest argument for it. With
every starting slot filled there is no next turn to price, the second term is
zero for everybody, and worth alone decides -- which is what the 2026-09-05
entry already said was right there, reached now by construction rather than by a
clause. With a pool the room will not touch, `later` equals `now` at every
position and either order comes to the same total, so the board says nothing,
which is true: the order does not matter.

### What was rejected with it

- **Weighting a bench position's contribution by a fraction.** Rejected again,
  for the reason the 2026-09-05 entry rejected it: the coefficient would be a
  fudge nobody could justify. This is why the finding is not fully closed.
- **Scoring the change in your best legal lineup instead of worth over a
  replacement.** It is the more faithful reading of M1 and it fixes the case
  above on its own, but lineup points are not comparable across positions -- an
  empty roster would take a quarterback first every time -- and correcting for
  that reduces to value over replacement again. What is left of it needs the
  bench model below.
- **A deeper continuation than one pick.** The honest version of M1 compares
  candidate-conditioned continuations several picks out. That needs the
  calibration M4 asks for before anybody could say it was better, and a
  one-pick continuation is already a comparison where there was none.

### Consequences

- **The board says nothing more often, and means it.** Over seat 5's fifteen
  turns in a played 12 team half-PPR draft it names a pick at twelve of them,
  where the old score named one at all fifteen. The three it declines are
  margins of 0.2, 1.5 and 1.8 points across two turns. The gate did not move and
  should not: three points is three projected points, and the new score states
  them in those units where the old one roughly doubled them. The old score
  cleared the gate at pick 20 by 0.9 points, so its confidence there was already
  a coin toss.
- The chain of alternatives keeps the behaviour it was built for. It reaches the
  same position twice at twelve of those twelve turns, and never once comes out
  as the position leaders in order, which would make it a second copy of the
  cost of waiting panel beside it.
- `PositionValue.cost` is still what the cost of waiting panel draws and still
  what sorts it. It no longer feeds the recommendation's score.
- **What a bench player is worth is still overstated**, and this does not
  address it. A backup quarterback still carries his full value over a
  replacement starter, so outside the compulsory case in `rankCandidates` he can
  still outrank a receiver filling an empty slot. `review/review.md` keeps that
  open under M1 and R6, and it needs expected usable weeks, replacement access
  and the calibration in M4 rather than a coefficient.

## 2026-09-07 The running bridge reports its own build, and the app says so

Status: Accepted.

### Decision

The service stamps a build into every copy of the userscript it hands out, the
running copy reports that build on every post, and the app shows the version it
is talking to — always, not only when it is wrong. A build that does not match
the file on disk raises a banner naming both.

The build is a hash of the source. The `@version` rides alongside it because
that is what a manager displays and what a human recognises.

### Why

A userscript manager is a place a script can go stale in silence, and this
project has now lost two live drafts to it.

The first was the panel, and `The panel is a bookmarklet` below records it: "the
manager reported the script as up to date, the served file was right, and the
body being executed was not." The panel escaped by leaving the manager entirely.

The bridge cannot take that exit. It has to be injected at `document-start` to
wrap `WebSocket` before Yahoo's bundle builds one, and only a manager can do
that. On 2026-09-07 it failed the same way and cost a session: the service
served 1.3.0, the manager's storage held 1.3.0, the manager's list said 1.3.0,
and the body running in the draft room was 1.0.0 — no queue write, and every
`Q` dropped by a filter three versions old. Three mock drafts were spent
diagnosing a service that was working correctly.

Every account of that script agreed except the only one that mattered. So the
account that matters is the one that now speaks: a script describing itself is
the single claim a stale install cannot fake.

A hash rather than a number, for the reason the panel decision gives — the
version that goes wrong is the one somebody forgot to raise. Hashed before the
stamp is applied so both ends measure the same bytes, and read per request so an
edit needs no restart of a service that may be holding a live draft.

Shown always rather than on mismatch alone, because the failure was never that
nobody was told; it was that there was nothing on screen to contradict. A
version in the masthead is how the next one is caught in seconds.

### What it costs, and what still holds

A copy run straight from the repository leaves the mark unspent. It claims no
build rather than a wrong one, and is never called stale, because that copy is
the current source and cannot be behind it. `npm run bridge:test` runs in
exactly that state and its log says so.

A copy too old to name itself at all is reported as behind by definition rather
than as unknown. That is the case this exists for, and treating silence from
something that is actively posting as "no information" is precisely what went
wrong.

The bridge still decodes nothing and still sends only `S|`. Nothing here widens
what leaves the browser: the identity rides on the post it already makes.

### Rejected

**A version number alone.** It would have caught 2026-09-07, and it would miss
a copy edited without the number being raised — the failure the panel decision
already argued about and settled.

**The bridge hashing its own source at runtime.** No serving needed, but a
manager that wraps or rewrites the body yields a false mismatch on an identical
script, and a banner that cries wolf is worse than no banner.

**Warning in the bridge's own console only.** That is where the evidence was all
along, and nobody was looking at it. The app is where the user is.

## 2026-09-07 Two premises under the first queue write did not survive

Status: Accepted. Corrects the reasoning under
`2026-09-06 The first queue write happens without reading the queue`, which is
left standing: its decision holds and its record is not rewritten.

### Decision

The decision it corrects is unchanged. What changes is what is believed about
why, and how often it applies.

### Why

**A Yahoo queue can be read.** The entry says no frame reports one unprompted.
The connect burst does: a `Q`, arriving bare when the queue is empty, observed
twice in league `10893050` and again in `10900454` by a recorder attached before
the room loaded. Every capture behind the original finding began after the socket
was already open, which is why none of them held one.

So `first` should mean "the bridge attached late" rather than "the queue is
unknowable", and it should be rare. It was not rare in testing because the
browser was running bridge 1.0.0, whose filter drops every `Q` before it leaves
the page — see the entry above this one.

**An empty queue causing autodraft is unsupported** rather than false. Nothing
observed since shows it. Every drop watched has followed a clock expiring
unpicked, which accounts for all of them without the queue coming into it.

### What it costs, and what still holds

The cost the original weighed is unchanged: a first write still replaces a queue
it has not seen. What changed is how often that arises, and with it the weight
of the argument for writing in ignorance. Whether `first` should still write now
that it is the narrow case is open, and deliberately not settled here.

## 2026-09-06 The first queue write happens without reading the queue

Status: Accepted. Reverses "a queue the app has not read is never overwritten"
in the entry below, which is thereby superseded on that one point. Everything
else in it stands, the ban on the pick frame above all.

### Decision

When the app has been asked to write a queue and the room has never reported
one, it writes anyway, and says that it did. A queue is still never replaced by
an empty list, so turning the setting on with nothing starred does nothing.

### Why

The rule it replaces was built on a true premise — `S|` carries the whole list,
so a write made in ignorance of the list deletes the rest of it — and reached a
conclusion that could not work, because nothing can end the ignorance:

- No frame reports a queue unprompted. `Q|` only ever answers a change.
- `6|<league>|<team>`, the one candidate for a request, is answered by `6|<team>`
  and not by a queue.
- No REST endpoint carries one. The captures hold `draftstatus`, `players`,
  `settings` and `teams`, and nothing else.

So "wait until the room reports" resolved only when the user went and queued
somebody by hand — which is the work the setting exists to remove. Watched
live on 2026-09-06 in league `10888301`: order read, seat read, 75 picks
mirrored perfectly, and the queue never written once, because the room never
had cause to mention it.

What turned a wrong default into a harmful one is that an empty Yahoo queue
appears to put a seat straight into autodraft. If that holds, the queue is not
insurance against wandering off; it is what stands between the user and Yahoo's
algorithm from the first pick. A rule that withholds the write until the user
acts withholds it for the whole draft, and does so most firmly in the rooms
where it was most wanted.

### What it costs, and what still holds

A queue built before the bridge attached is replaced, once. That is a real cost
and it is why the app now states it rather than discovering it: the control says
the write replaces whatever is there, and the panel over the room says the same
after the fact.

Everything after that first write is unchanged. Yahoo answers `S|` with `Q|`, so
from then on the room's queue is known, the two lists merge, and neither side
loses a player.

### Rejected

**Provoking a `Q|`.** Would have been the clean answer and there is nothing to
send: see the three findings above.

**Asking the user at the moment of the first write.** A prompt over a live draft
room, on a pick clock, to approve something they turned on deliberately a minute
earlier. The setting is the consent; the sentence next to it is the disclosure.

## 2026-09-06 The bridge writes the queue, and nothing else

Status: Accepted. Widens `The bridge also shows` below, which held that nothing
is ever sent to Yahoo, and narrows the `SPEC.md` non-goal that forbade write
access outright.

### Decision

The app can write the user's Yahoo draft queue, behind a setting that is off
until they turn it on. It writes nothing else. The pick frame Yahoo's own client
sends is decoded, documented and deliberately not sent.

The split of work is the one already in place. The client decides who should be
queued, because that is where the engine is. The service resolves those players
to Yahoo's own IDs, because it holds the pool and `names.js` already does that
join. The bridge sends the frame, because it is the only thing on Yahoo's
origin. Nothing new was invented to carry it: the advice pigeonhole runs in
exactly this direction already.

### Why

Every argument that justified reading applies to writing. Yahoo answers only the
tab the user is sitting in, and that tab is the only place a queue can be set.
The board already knows who is worth taking; making the user retype that into
Yahoo's own list, under a pick clock, is the friction the tool exists to remove.

The queue rather than the pick frame, because they differ in what a bug costs. A
wrong queue is a wrong player taken when a clock expires, which is the same
thing Yahoo's own autopick does badly and the user has already accepted by
leaving the room. A wrong pick frame is a pick taken instantly, out of turn,
that nothing can undo. The first is worth the reach; the second needs a reason
better than convenience, and does not have one yet.

### What it must never cost

The rule the bridge already held for drawing now holds for writing:

- **A queue the app has not read is never overwritten.** `S|` carries the whole
  list, so there is no additive write and a stale idea of the queue deletes
  whatever it has not seen. The bridge writes only after a `Q|` has told it what
  Yahoo holds, and says so on the panel until then.
- **No pick frame, ever.** Not behind a flag, not in a branch. The one place
  that formats an outbound frame formats `S|` and nothing else.
- **Off by default,** and off is the state where the bridge is exactly the
  reader it was before this.
- **Every write is checked.** `Q|` echoes what Yahoo now holds, so a write that
  did not land is visible rather than assumed.

### Rejected

**Sending the pick frame now**, behind its own setting. Not rejected on the
merits — it is wanted, and `docs/yahoo-draft-protocol.md` now records the frame
that would do it. Rejected as one change: it turns the tool into something that
acts in a live draft without a human, and that deserves its own pass with its
own testing rather than riding in on the queue's.

**Merging against an unread queue.** The obvious reading of "never delete what
Yahoo holds" is to union the app's list with Yahoo's. That only works if Yahoo
tells us what it holds, and no capture shows it doing so on connect. Unioning
against an assumed-empty list is a silent delete wearing a merge's clothes.

**Resolving names in the bridge.** Rejected for the reason it was rejected for
picks: it puts fragile code where no test can reach it. The service already
holds the pool and the join.

## 2026-09-05 The lean is measured per round, not per draft

Status: Accepted. Reverses the depth paragraph of the entry below, which left
this alone on reasoning rather than measurement.

### Decision

`observedLean` divides the surplus by a denominator that grows with the rounds
played, calibrated so three rounds reads exactly as it always did. It only ever
slows the reading down: before three rounds the scale is unchanged, so a single
round of picks still cannot be multiplied into a landslide.

### Why

The entry below argued the inflation was harmless because the forecast only runs
to your next pick and roster need already corrects for a filled position. That
was reasoning, and it was wrong.

Measured properly, against a room whose dial was known, comparing the survival
the forecast predicts with what that room actually does over four hundred runs:

    position, dial   3 rounds        5 rounds        8 rounds
    RB +3            .034  .034      .025 → .029     .056 → .015
    WR +3            .028  .028      .050 → .016     .077 → .039
    QB +4            .061  .061      .044 → .039     .052 → .022
    TE +4            .047  .047      .017 → .014     .025 → .011

Mean absolute error in survival, before and after. Better or unchanged in eleven
of twelve, and the one that moved the wrong way, backs at five rounds, moved
four tenths of a point. By the eighth round the error falls from about five
points of survival to about two.

The early draft is untouched by construction, which is why the three-round
column is identical rather than merely close.

### Why not a setting

It was asked for as one. It is not a thing a user knows about their league, in
the way that a roster shape or a keeper is: nobody can be asked to choose
between an absolute and a per-round surplus, and there is no taste involved,
only a right answer that a measurement settles. Offering it would mean shipping
the option now known to be worse and asking somebody to find that out.

### What it costs

Leans past three rounds now read lower, so `describeLean` puts fewer of them
into words late on. That is the point rather than a side effect: the sentences
it stops saying were the ones the old scale inflated into existence.

## 2026-09-05 The room's lean stays an absolute surplus

Status: Accepted on the measure, **superseded on the depth**. The surplus is
still absolute and still not relative, which is what this entry decided. The
paragraph below saying its growth with depth was left alone is reversed by
`The lean is measured per round, not per draft` above.

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
eight, and +3, +4 and +5 are indistinguishable by then. **This was left alone
here and is no longer.** It was worth measuring rather than reasoning about, and
the measurement went the other way. See the entry above.

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
- `GET /api/:platform/room/:id` exists alongside it, offered on the same terms,
  and is the one Yahoo read that reports rather than refusing. A mock hands out
  its league number in the lobby minutes before the draft room tab exists, so
  "nothing posted yet" is a state the app waits through rather than a fault.
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

## 2026-09-05 Light mode turns the metaphor over, and both themes share one contrast floor

### Decision

The app has a light mode. It is not the felt lit brightly: the ground becomes
the sticker paper, and the type goes dark on it. The six position hues stay the
same six hues and are taken down in lightness only.

Both palettes are held to one measurable floor. Every colour used as type
clears 4.5:1 against every surface it can land on, and no two accent hues sit
closer than dE 12, so no pair is confusable at a glance.

The theme follows `prefers-color-scheme` by default. A header button overrides
it, cycling auto, light, dark, and the override persists in `storage.ts`.

### Why

The dark palette was never decoration. Position colour is the densest signal on
a draft board, and the six hues are the palette. Lighting the felt keeps the
metaphor but destroys that: a green ground washed pale goes grey, and every hue
sitting on it goes with it. Turning the metaphor over keeps the signal, because
paper was already what the type was made of.

The floor exists because a colour tuned for green-black does not survive the
move. Untouched, the six hues arrived on paper at about 2:1 and the board went
quiet exactly when it gets busy. Measuring rather than eyeballing also caught
two defects the dark theme had shipped with: muted text at 3.1:1, under the
readable floor, on the survival lines and run counts you read while deciding;
and QB red at 4.1:1.

### Rejected alternatives

- **Lighting the felt.** Rejected: a pale green ground greys out the position
  hues, which are the reason the board is on screen.
- **Reusing the dark hues unchanged.** Rejected: measured at roughly 2:1 on
  paper. The densest signal in the app would be the first thing to go.
- **A media query and no control.** Rejected: it leaves a user who wants one
  app to disagree with their OS no way to say so.
- **A plain two-state toggle.** Rejected: once an override exists, there has to
  be a way back to following the machine, and a two-state button has none.
- **Matching dark's contrast ratios exactly.** Rejected: a dark ground buys
  high ratios cheaply, and forcing gold to 8:1 on paper makes it brown-black.
  WCAG's 4.5:1 is the bar that means something on both grounds.

### Consequences

- `client/src/index.css` carries two palettes and no literal colours outside
  them. A colour added anywhere else is a bug: it will be wrong in one theme.
- Six tokens exist only so both themes can move together: `--gold-hi`,
  `--gold-wash`, `--on-gold`, `--bad-line`, `--shadow-pop`, `--shadow-bar`.
- The four surfaces are a ramp in both directions. `--felt-3` is the darkest
  surface type lands on in light mode, so it binds the floor.
- `npm run shots` photographs light mode through Playwright's `colorScheme`,
  which drives the real `prefers-color-scheme`, and checks the button cycles
  auto, light, dark, auto.
- Changing any palette token means re-checking the floor. Nothing in the repo
  enforces it yet; it was verified by measurement at the time of the change.

## 2026-09-05 The board names a pick, and says nothing when there is nothing to say

### Decision

The pool marks one player as the pick this turn is for, in `recommendPick`
(`client/src/engine/value.ts`). It scores the leader at each position by what he
is worth over a replacement starter plus what waiting one turn would cost at his
position, and counts that second term only where the position still fills a
starting slot you have open.

It returns nothing when the top two are within three points of each other, when
the pick is not yours, or when every position that could be named is filled to
its cap.

Status: the "when the pick is not yours" clause is amended by the 2026-09-05
entry below on saying the same thing in both modes. The rest stands.

### Why

Three readings decide a pick and the app had them in three places: worth in the
pool, scarcity in the cost-of-waiting panel, and roster holes in the panel below
it. Joining them was work the user did every turn, from three panels, on a
clock. Nothing new is computed here — it is the join that was missing.

Only position leaders are weighed because cost of waiting is measured against
the best player left. It is his number, and letting the fourth receiver inherit
the urgency of the first would recommend depth during a run on starters.

Urgency counts only where it is yours because waiting a turn for a bench player
genuinely costs nothing this turn. Dropping it there leaves worth alone to
decide, which is the right answer once the lineup is full.

### Rejected alternatives

- **Weighting a bench position's urgency by a fraction.** Rejected: the fraction
  would be a fudge factor nobody could justify, and the honest coefficient for
  "how much do I care about waiting on a player I cannot start" is zero.
- **Scoring every available player rather than position leaders.** Rejected: it
  needs a per-player scarcity number the engine does not have, and the one it
  does have belongs to the leader.
- **Always naming a leader.** Rejected: with the top two a field goal apart
  there is no decision to report, and naming one invents it. The existing
  cost-of-waiting panel already refuses to draw bars under a point for the same
  reason.
- **Putting it in the cost-of-waiting panel.** Rejected: that panel is
  deliberately position-level and explains its reasoning; a verdict naming a
  player belongs next to the player.

### Consequences

- The marker takes the position colour, not gold. Gold means yours or on the
  clock and means nothing else, and a recommendation is neither.
- It shows its arithmetic rather than only its verdict, because a
  recommendation that cannot be checked cannot be overruled.
- `recommendPick` is pure and covered in the engine self-test: an empty roster,
  a position at its cap, a full lineup adding no urgency, an empty pool, and a
  tie close enough to stay unnamed.
- It inherits the room forecast for free. Once enough real picks exist, the
  cost it reads is the room's rather than ADP's, because `pricedPositions`
  already makes that swap upstream.
- It is also handed to the panel over a Yahoo draft room, through the advice
  pigeonhole in `server/src/platforms/yahoo/room.js`. It is worked out once, in
  the app: the service forms no opinion, and a second copy of the pricing would
  give two answers to one question. Adding a field to that panel means adding it
  in three places — the payload, that whitelist, and the panel itself — and the
  round trip is checked in the engine self-test, because a field that does not
  survive it draws an empty box rather than failing.

## 2026-09-05 Both modes read the same, and the recommendation is worded for the clock

### Decision

The draft screen offers "take best available" on your own turn in either mode,
not only in a mock, and the pool names a pick whether or not the clock is on
you. Off the clock the flag is tagged `Target` rather than `Take` and says what
goes "before your turn" rather than "if you wait". A gold `Your pick` badge sits
in the clock strip on your own turn, in both modes, and the assistant's clock
reads "On the clock" for your own pick rather than "Recording for".

### Why

The recommendation was gated on `canPick`, which is
`yourTurn || (assistant && manual)`. That was the wrong test in both directions
at once. Entering a room's picks by hand makes every seat pickable, so the pool
named a pick for you while you transcribed somebody else's — advice that was
always up and therefore read as decoration. Following a feed, it named none at
all except during your own turn, which in a real draft is a minute in an hour.
The one mode that simulates nothing, and so has the most use for a read, was the
one that showed it least.

Off the clock the number was never about the seat picking. `pricedPositions` is
measured against `oddsTarget`, which out of turn is your own next turn. So the
arithmetic was already answering "who to target", and only the word `Take` was
wrong. Fixing the word is cheaper than withholding the reading.

The badge exists because the two things that said whose turn it was — the gold
wash and the gold seat name — both said it in colour, to somebody already
reading the clock. On a phone the row's labels are stripped out entirely.

### Rejected alternatives

- **Gating the take button on `canPick` for symmetry with the pool rows.**
  Rejected: rows are clickable off the clock so you can record what the room
  did, and "the best available to you" is not what somebody else took. The
  button follows `yourTurn` in both modes instead.
- **Showing the recommendation only on your own turn, in both modes.**
  Rejected: it makes the assistant's most useful screen blank for the eleventh
  of a draft that is not your turn, and the reading is already priced against
  your next pick.
- **Converging the rest of the two screens.** Rejected: the in-draft ADP picker
  and the room forecast are deliberately assistant-only, and both have reasons
  recorded above. This app's own mock draft runs its simulation off the ADP and
  so cannot re-price mid-draft, and forecasting a room whose bias you dialled
  yourself double-counts it. Neither reason reaches a Yahoo mock, which is a
  public room of real people and is followed by the assistant like any other.

### Consequences

- The badge spends the primary button's `--gold` / `--on-gold` pair, already
  held to the contrast floor in both themes, so gold still means one thing.
- The panel over a Yahoo draft room takes the same two wordings from the same
  payload, which already carried `onClock`. The panel and the tab that fed it
  cannot disagree.
- `recommendPick` is unchanged and its self-test coverage still holds. What
  moved is the caller's gate, now the draft being live rather than `canPick`.

## 2026-09-06 A Yahoo mock and this app's mock draft share a word and nothing else

### Decision

The word "mock" names two different things and the UI says which it means. A
**Yahoo mock draft** is a public Yahoo room of real people drafting a team that
is not for their league; it is followed with the **draft assistant**, like any
other real room. **This app's mock draft** simulates a room. The mode switch,
the Yahoo tab and the mock tick all name the distinction where it can be acted
on.

Behaviour follows the naming. Ticking "This is a Yahoo mock draft" holds the
league number and waits for a draft room **only in the assistant**. In the mock
draft it sets Yahoo's roster shape and nothing else, and a pasted number is read
now or refused now. The wait pauses rather than ends when the mode is switched
away from the assistant, because switching back is the one action that says you
still want it.

The Yahoo tab keeps its ID field in the mock draft, with a note saying what that
mode can and cannot do with a number.

### Why

The tick armed a wait with no mode check while the board only ever opened for
the assistant, so in the mock draft the banner said "the board opens by itself
once your Yahoo draft room is up" about a board that never would. The checkbox
one paragraph above already said "**in the draft assistant** it opens by
itself", so the panel contradicted itself on screen.

Hiding the Yahoo ID in the mock draft was tempting, because a fresh Yahoo number
cannot be read without a live room in either mode: `importLeague` refuses when
nothing has been posted. But a league already read is applied from storage
without touching the service, so a Yahoo league can be reloaded to rehearse its
shape as a simulation. Hiding the field would have taken the one Yahoo path that
does belong in the mock draft.

### Rejected alternatives

- **Hiding the Yahoo tab or its ID field in the mock draft.** Rejected: it
  breaks reloading a saved Yahoo league to rehearse it, and the field's own hint
  already says a Yahoo league needs the bridge running in your draft room.
- **Clearing the held league number when the mode is switched.** Rejected:
  switching modes is not a decision to stop waiting. Untick is, and it already
  is. Pausing leaves the wait recoverable by switching back.
- **Leaving the behaviour and fixing only the banner's words.** Rejected: it
  would have to explain that the mock draft waits for a room in order to do
  nothing with it. The wait had no purpose there to word.

### Consequences

- A pasted Yahoo number in the mock draft now takes the same path an unticked
  one always took, refusal included. The browser logs the refusal's 400 exactly
  as it already did for any league the service cannot read.
- `npm run shots` still covers the assistant's wait end to end, including the
  board opening once a room is posted, so the path that kept the behaviour keeps
  its guard.
- The league section is titled "Your leagues" rather than "Your Sleeper
  leagues", and its note no longer promises the roster and scoring that only
  Sleeper publishes.
- `PLATFORM_LABEL` in `client/src/engine/types.ts` is the one place that names a
  platform on screen, next to the `Platform` type it labels. Two panels name one
  and they had drifted: "Follow a real draft" said Sleeper throughout while
  being shown for a Yahoo league. A league saved before the field existed reads
  as Sleeper, the same default `App` applies when it loads one.
- Where a sentence is about how a platform works rather than what it is called,
  it stays a conditional rather than a substitution. "It appears here once
  Sleeper sets it" is not made true by swapping the noun: Yahoo puts the draft
  order in the room, where only the bridge can read it.


## 2026-09-06 A pushed platform is watched, not asked once

### Decision

Two rules follow from a platform being pushed rather than pulled, and both are
about time rather than about data.

**A board's `adpOffered` is a snapshot, so anything that can change it is
watched separately.** The board reports which feeds it could have been priced
on, and that report is true of the moment it was built and of no other. Where a
feed's availability can change under a board that is already on screen, the
client polls the thing that decides it and asks for the board again when the
answer moves. Today that is `roomState.pricesBoard` on the Yahoo platform, asked
on the same five-second beat the app already uses while waiting for a room.

**A pushed platform is polled faster than a pulled one.** `PUSHED_POLL_MS` is
two seconds and `POLL_MS` is eight. A platform that is pushed keeps its picks in
this service's own memory, so a poll costs a local request and nothing else; a
pulled one spends somebody else's bandwidth on every beat.

### Why

The room feed could be offered once or never. A room arrives on its own
schedule and mostly *after* the board that would report it: the bridge is
installed while the app is already open, a restarted service is sent the pool
again mid-draft, a page is reloaded between rounds. None of those move anything
the board fetch is keyed on — not the format, the league size, the year, the
chosen feeds, or even the room's name, which was already set. So "Your draft
room" stayed greyed out for the rest of the session, and its tooltip said it
needed a live draft to follow while a live draft ran behind it. The only way
back was to toggle an unrelated feed off and on, which changes `adpSource` and
so re-asks for the board by accident.

The eight-second beat was Sleeper's rate applied to Yahoo because there was one
constant. It is a fair rate for a public feed nobody is paying for, and an
absurd one for a question already answered: the bridge posts a pick within half
a second of the room sending it, and the picks route answers from memory in
about ten milliseconds. Measured at ten milliseconds a call, a two-second beat
is a half-percent duty cycle on the user's own machine.

### Rejected alternatives

- **Re-asking for the board on a beat until it offers the room.** Rejected: it
  polls an expensive endpoint to discover something a cheap one already knows,
  and it cannot tell "no room" from "a room with no ADP in it", so it would
  re-ask forever for a room that will never price anything.
- **Using the seat or the order as the signal.** Rejected: both are already
  true before the pool lands, and the pool is what carries Yahoo's ADP. A room
  re-posted to a restarted service has a seat immediately and an ADP later, so
  neither would fire at the moment that matters.
- **Reporting it from the picks poll, which already carries `roomAdp`.**
  Rejected: that poll runs only on the draft screen and not while the draft is
  paused or being entered by hand, and the same control is on the setup screen,
  which would go on lying.
- **A single poll rate, tuned between the two.** Rejected: there is no rate that
  is both polite to a public feed and quick on a local one. The platforms differ
  in kind, so the constant does.

### Consequences

- `roomState` is now three answers rather than two, and a platform that keeps a
  room is expected to answer all three. A platform that keeps none still refuses
  the route, and the client's poll ends at the first refusal rather than asking
  again.
- The feed goes away as well as arriving. A service restarted mid-draft drops
  the room, the poll reports it, and the board is re-asked for without it.
  `parseAdpSource` already drops a feed it was not offered, and the saved choice
  still names the room, so it is honoured again when the room comes back.
- `npm run shots` covers the arrival end to end: the Yahoo mock scenario posts a
  room without a pool, checks the control is dead, posts the pool, and waits for
  the control to come alive without a reload. Removing the trigger makes it fail.
- The two poll rates are named for what a platform *is* rather than for a
  platform. A third platform picks its constant by answering whether it is
  pushed or pulled, which is the same question `platforms/index.js` already asks
  to decide whether it has `ingest` and `roomState` at all.
