# Project tasks

The work in flight and the work already validated. A task is one reviewable
outcome: if it cannot be finished and checked in a single pass, it is a phase
and belongs in `ROADMAP.md`.

## Current phase

Phase 4: prove the platform seam against real leagues.

- [x] Say which bridge is running, in the app, before it costs another draft.
  - Scope: the service stamps a build into every copy of the userscript it hands
    out at `/userscript/yahoo-draft-bridge.user.js`; the running copy reports
    that build and its `@version` on every post; the room records it; the app
    shows the version in the masthead always and raises a banner when the build
    does not match the file on disk. New `server/src/bridge.js` holds the
    reading, because what a stale install looks like is not obvious and the
    reasoning belongs next to it.
  - Why: 2026-09-07 cost three mock drafts to a bridge that served, stored and
    listed as 1.3.0 while running 1.0.0 — no queue write, and every `Q` dropped
    by a filter three versions old. The service was working correctly the whole
    time. `DECISIONS.md` records it, and the same failure had already taken a
    live draft from the panel, which is why the panel left the manager entirely.
    The bridge cannot: it needs `document-start` to wrap `WebSocket`.
  - Acceptance criteria: a copy too old to name itself reads as behind rather
    than as unknown; a copy run from the repository is never called stale; a
    matching version with a different build is called stale. All three met.
  - Automated validation: thirteen checks in `npm run server:test` under
    `bridge.test.js`, covering the stamp, that both ends hash the same bytes,
    the mark appearing exactly once, each of the five readings, and the
    service-wide record. Typecheck, lint, `server:test`, `bridge:test`, build
    and `shots` clean, no console errors. `bridge:test` runs unstamped by
    construction and its log now says so, which exercises the escape hatch
    rather than asserting about it.
  - Manual validation: **done, both ways.** The banner appeared against a
    genuinely stale install on 2026-09-07 (league `10901687`, reported
    `tooOld`), and the clean case followed in `10902922`: the room's console
    logged `v1.3.1 loading … build e7a163fa`, the service read
    `stale: false`, and no banner appeared.
    What the failure turned out to be is recorded in `AGENTS.md`: Chromium's
    per-extension "Allow user scripts" control, off while the `userScripts`
    permission itself was granted, so Tampermonkey injected nothing and every
    other account of the script looked correct. The stamp is what made that
    disagreement visible, and it flipped to `stale: false` on its own the
    moment the control was turned on.
  - Also built, after the first outing showed it too narrow: the reading is held
    per service rather than per room and read from `/api/bridge/build`, so it is
    answered whenever Yahoo is the platform on any screen in either mode. It had
    been scoped to an assistant draft in progress, which is after the point
    where the answer is worth having.
  - Dependencies or blockers: none.

- [x] Let the app say when a bridge has stopped, not only when it is behind.
  - Scope: every post is timed, and `bridgeStatus` carries `heardAt` in the
    service-wide reading and the per-room one alike. Fifteen seconds of silence
    reads as a bridge that has stopped: the reassurance goes, a banner naming
    both causes shows on every screen, and the masthead says how long it has
    been. Worded where the reading is taken rather than at render, so nothing
    has to drive a clock for it to age.
  - Why: 2026-09-07 again, the same evening. The install was current and the
    masthead said so, the browser had taken the per-extension "Allow user
    scripts" control back off underneath it, and the app went on saying picks
    would mirror while nothing was being injected at all. None of the four
    readings expires on its own, and a bridge posts only from inside a draft
    room, so "current" is a fact about a copy that was talking then. What was on
    screen was the green banner, over a board with no picks on it, which reads
    as the app being broken rather than as nothing having spoken to it.
  - Acceptance criteria: a bridge nothing has ever heard from is not called
    silent, because a draft room that has not been opened looks exactly like
    that; a silent bridge is complained about instead of a stale one rather than
    as well as; the reading ages on the beat that already polls it. All three
    met.
  - Automated validation: one check in `npm run server:test` (the time is the
    post's, and every post moves it on) and one in `npm run engine:test` (a
    posted room says when the bridge was last heard). Typecheck, lint unchanged
    from baseline, `server:test`, `bridge:test`, `engine:test`, build and
    `shots` clean, no console errors.
  - Manual validation: **done.** Four states photographed in a real browser
    against the running app: nothing ever heard, current, silent at 22 seconds
    and at five minutes, and stale. The reading was served to the page rather
    than posted to the service, because a real bridge was posting to it every
    three seconds at the time and leaving that alone was the point.
  - Dependencies or blockers: none. Found while diagnosing a room that was not
    syncing, which was two faults rather than one. The other — a bridge posting
    to a league the app is not following, which the app also cannot see — is not
    addressed here.
  - Noticed here and acted on since, in the task below: the stale-bridge banner
    said to reload the draft room, and `docs/yahoo-draft-protocol.md` records
    that Yahoo's `auth` is single-use and a reload leaves the draft. The banner
    built here says to re-open from the lobby instead, and the older one now
    says the same rather than giving the advice that costs a seat.

- [x] Build the autodraft queue as a plan, not as four ways to make one pick.
  - Scope: new `recommendSequence` in `client/src/engine/forecast.ts`, which
    advances the roster as it builds so a position reaching its cap drops out of
    everything below it. The autodraft queue is built from that instead of from
    `chain`, and it starts from the counts the starred players would leave,
    because those are written above it. `recommendChain` is untouched: for the
    row on screen, two defenses is the right answer.
  - Why: reported in a live draft as Yahoo taking two defenses, and then two
    kickers. `chain` is a pick and three substitutes, each priced against the
    roster as it stands and with only the named player removed from the pool, so
    the same position stays on top and the next man at it comes up again. That
    is asserted behaviour and correct for advice. Yahoo reads a queue as
    successive picks, so the same list became a plan with a wasted pick in it.
    Late on is where it showed: value over replacement is what puts a position
    on the list at all, and by the end the positions with anything left worth
    having are the ones with a single slot.
  - Acceptance criteria: a queue never holds a position more often than the
    roster can play it, counting what is already held and what the stars add; a
    queue that cannot legally be filled to depth stops rather than repeating;
    the on-screen chain still repeats a position. All three met.
  - Automated validation: four checks in `npm run engine:test`, including the
    contrast — the same board gives four substitutes across two one-slot
    positions and a queue of two. Typecheck, `server:test`, `engine:test`,
    build and `shots` clean, no console errors.
  - Lint: two new `react(preserve-manual-memoization)` warnings in
    `DraftScreen.tsx`, taking it from two to four. Both are on the new memos and
    are the same construct the `chain` memo beside them already carries. The
    pool the board chooses from was hoisted into one memo read by both the
    advice and the queue, which is one of the two: it costs an advisory warning
    and removes the chance of the two lists filtering their pool differently.
  - Manual validation: **outstanding.** The wiring in `DraftScreen.tsx` is not
    covered by a check — no test drives the queue write from the component — so
    what has been proven is the engine function and that the app renders and
    builds. Watching a real autodraft take one defense is still to do.
  - Not addressed: a duplicate already written into Yahoo's queue survives this.
    `queuePlan` merges the room's own queue underneath the app's and drops only
    players already drafted, so a second defense sitting in the room's queue is
    carried on every write until it is deleted in the draft room by hand. The
    app never clears a queue it did not read; see `DECISIONS.md`.
  - Dependencies or blockers: none.

- [x] Say that a pick fills a starting slot, not that you have to start one.
  - Scope: the take line's last sentence, in `PlayerPool.tsx` and in
    `userscript/draft-panel.js`, which print the same string from the same
    `fillsStarter`. "You still have to start one" became "He fills a starting
    slot you have open", and "Your lineup is full, so this is on worth alone"
    became "He fills no starting slot, so this is depth."
  - Why: reported from a live Yahoo draft on 2026-09-07. The user drafted a
    tight end and the board went on saying he still had to start one, which he
    read as being told to take a second. `fillsStarter` knows only that a
    candidate goes into some open slot: a flex takes RB, WR or TE, so with the
    flex empty a second tight end genuinely does fill a starter, and the
    arithmetic was right while the sentence was not. The other branch was wrong
    in the same way -- it claimed the lineup was full, which `fillsStarter` does
    not establish, since a backup quarterback fills no starting slot while a
    receiver slot is still open.
  - Acceptance criteria: both sentences say only what the flag they are printed
    from actually says, and neither names a position or claims anything about
    the rest of the lineup. Met.
  - Automated validation: none added, and none is possible from the flag alone
    -- what changed is a string, and no check can tell a true sentence from a
    misleading one. Typecheck clean, lint unchanged at 43 warnings, build clean.
  - Manual validation: **done.** Photographed in a real browser: "+126 over a
    replacement WR, and 120 more at your next turn. He fills a starting slot you
    have open." `shots` clean, no console errors.
  - Raised, not acted on, and both belong to findings already open. Naming the
    actual slot -- "he fills your flex" -- would be the better sentence, and
    needs the roster and counts the panel is not given. And the number itself
    is still overstated for that tight end: worth is measured against a
    replacement at his own position, about TE12 in a one-TE league, while the
    slot he is competing for is a flex whose bar is the best available RB, WR or
    TE. That is the open half of M1 and R6 in `review/review.md`, which two
    decision entries left for a bench model rather than a coefficient.
  - Also pre-existing, and worth naming: the sentence is one string in two
    files, because the panel is a separate script that cannot import from the
    client. Nothing checks that the two agree.
  - Dependencies or blockers: none.

- [ ] Populate `client/fixtures.local.json` and run the full engine self-test.
  - Scope: copy `client/fixtures.example.json`, fill in real Sleeper league
    IDs, a keeper league, and a finished draft with its pick and keeper counts.
    Run `npm run engine:test` with the data service up.
  - Acceptance criteria: no suite reports "skipped". "Following a real draft"
    and "Reading a real league" both run and pass.
  - Automated validation: the self-test itself.
  - Manual validation: none required.
  - Dependencies or blockers: needs real Sleeper league IDs from the repository
    owner. Nothing else blocks it.

- [ ] Phase 5: follow a Yahoo draft through the browser. **Proven against a live
      public mock 2026-09-04, real people drafting. A configured league is what
      is left.**
  - Built: `main` merged into `yahoo-platform`; the frame decoder, the room
    store and the `yahoo` platform behind the seam; the ingestion route; the
    bridge userscript; the platform selector in the client; a Yahoo block in
    `engine:test`.
  - Acceptance criteria: every pick in a live Yahoo room appears on the board,
    in the right slot, against the right seat, with none unmatched. **Met in a
    mock, start to finish.** League 10720547, 14 teams, 15 rounds, followed from
    the first pick to the last: 210 picks, 210 joined, none unmatched, none off
    the board, pool falling 625 to 415. Checked rather than counted — overalls 1
    to 210 each present exactly once, all 14 seats holding exactly 15, no player
    taken twice, and every slot agreeing with a 14 team snake. The reader's own
    seat, 12, was taken from the room URL without being asked for, and the
    results screen graded all 14 rosters off those picks.
  - Two things the run proved that only a live room could. Round 8 put slot 14
    on pick 99 and slot 13 on pick 100, which is the reversal the 2026-09-04
    decision predicted from mock frames. And every position joined, defences
    included: Yahoo writes `Rams` against team `LA`, no name match could work,
    and `joinKey` resolved it on the abbreviation exactly as designed.
  - Automated validation: run and passing. `engine:test` replays the four real
    captures in `tools/yahoo/` plus a synthetic set that runs anywhere;
    typecheck, lint and build all clean. What this does *not* cover is the
    userscript, which no check touches — the live mock above is the only thing
    that has ever exercised it.
  - Manual validation: **the public mock is done; a configured league is not.**
    The mock was real people drafting, about half the seats live, so human pick
    timing, autopick on inactivity and reconnect replay are all observed. What
    is unseen is a league someone set up: keepers, traded picks, a
    commissioner's roster and scoring, any format but 14-team snake. Those move
    the draft order off a plain snake, which is the part most likely to break.
    Recheck before draft day.
  - Dependencies or blockers: none. Phase 4 is worth closing first rather than
    required.
  - Known gap, now closed: `tools/yahoo/dump/pool-10720547.json` holds a real
    `players/nfl/<league>` response, 1195 entries, so a Yahoo player ID can be
    joined to a real person offline.
  - Found while validating, and fixed: eight rows in that pool carry two
    positions in one field — `WR,RB`, `WR,TE`, `RB,TE` — which `normPos` passed
    through whole, so `joinKey` built `name|WR,RB` and matched nothing. All eight
    are fringe players with no ADP and none is reachable in a 14 team, 15 round
    draft, so it never fired in the live run; it would have put a stranger on the
    board the first time one went late in a deeper league. `normPos` now takes
    the first position of a pair, and the Yahoo self-test gives one pooled player
    a dual label so the case is covered — checked by reverting the fix and
    watching the check fail. Defences were never affected: Yahoo writes `DEF` and
    a team abbreviation, which is what `joinKey` already wanted.

- [x] Write the Yahoo draft queue from the board.
  - Scope: the app can set your queue in a Yahoo draft room, behind a setting
    that is off. `Mirror` sends the players you starred; `Autodraft` tops those
    up from the board's own chain. The client decides who, the service resolves
    them to Yahoo's player ids, and the bridge sends the `S|` frame. No pick
    frame is sent, and none is written. `SPEC.md`'s blanket non-goal narrowed to
    match; `DECISIONS.md` carries why the queue was reached for and the pick
    frame was not.
  - Found first, and what made it cheap: `tools/yahoo/` already held every
    outbound frame needed. `S|<league>|<team>|<ids…>` sets the whole queue and
    `Q|` echoes it back, across 32 writes in three sessions, and neither was in
    `docs/yahoo-draft-protocol.md` — which listed `Q` as unknown and the client
    as sending one frame. Also observed there: Yahoo prunes a drafted player
    from a queue and never says so, so the pruning is ours to do.
  - **Built once, watched failing, and rebuilt.** The first version declined to
    write a queue it had not read, on the reasoning that `S|` replaces the whole
    list. Live in league `10888301` on 2026-09-06 that produced a perfect draft
    and no queue at all: 210 picks mirrored, 210 matched, nothing unknown, and
    `Q` never sent once, because Yahoo only sends one when a queue changes. Two
    findings from that run killed the rule — nothing can read a Yahoo queue
    (`6|` answers `6|`, no REST endpoint carries one), and an empty queue
    appears to put a seat straight into autodraft, so the refusal held its fire
    exactly where firing was the point. The first write now happens and says so.
    See `DECISIONS.md`, both entries dated 2026-09-06.
  - Acceptance criteria: a queue set from the app appears in the room; the
    user's own Yahoo entries survive every write after the first; an empty queue
    is never written; no pick is ever sent. **All four now met**, the first of
    them live on 2026-09-07 — see manual validation.
  - Automated validation: run and passing. Fifteen checks in `engine:test` under
    "Writing a Yahoo draft queue" covering the first write and what it reports,
    the refusal to write an empty one, both merge orders, the pruning of a
    drafted player, an unresolvable player being named rather than guessed, and
    a platform with no room being refused the route. Seven more in the new
    `npm run bridge:test`, which runs the userscript itself against a fake room
    and asserts the exact frame it puts on the wire, including that it never
    formats anything but `S|` however the reply is shaped. Typecheck, build,
    `server:test` and `shots` clean, no console errors; lint up two warnings on
    the two new `useState(saved.…)` lines, the pattern every other setting in
    `App.tsx` already uses.
  - Manual validation: **done, live, 2026-09-07 in league `876392`.** A queue
    set from the app appeared in Yahoo's own queue panel: the user cleared the
    room's queue by hand, turned Autodraft on and watched it fill, then switched
    to Mirror, starred a few players and watched those written too. That is the
    criterion this task had never met, and the two mocks earlier the same day
    that got no further were the browser running bridge **1.0.0** throughout —
    it logs no version banner, its filter drops every `Q` before it leaves the
    page, and it has no write path at all.
  - **Found by the same run, and it is a defect rather than a limitation:**
    un-starring a player does not remove him from the Yahoo queue. `queuePlan`
    merges `theirs` — the queue Yahoo last reported — underneath `mine`, and
    after any write Yahoo echoes the app's own list straight back, so every
    player the app has ever queued returns as though the user had put him there.
    The star control can add and can never remove. This task recorded the
    symptom as "a duplicate already written into Yahoo's queue survives this",
    which undersells it: it is every removal, not only a duplicate.
    The fix is knowable — have the room remember the ids it wrote and treat
    Yahoo's reported queue minus those as the user's own — and it is not taken
    here, because it changes the one path that writes to a league platform and
    `DECISIONS.md` constrains it. **Raised with the user, awaiting a decision.**
    Until then the workaround is ordered: un-star in the app first, then delete
    in Yahoo's panel, because deleting while starred writes him back.
  - Not explained, and not chased mid-draft: the capture running throughout
    recorded 113 frames on the watched tab and not one `S|`, on a tab whose
    `window.WebSocket` is `Bridged`. The likeliest reading is that the watched
    tab's socket was displaced when a second connection took the seat, so its
    own bridge returns early at the `readyState !== OPEN` guard while still
    recording what arrives. A hypothesis, recorded as one.
  - Dependencies or blockers: none.
  - Still unverified, and cheap to settle in the same mock:
    - Whether Yahoo's own draft room redraws its queue from a `Q|` it did not
      provoke. If not, a queue set from the app is live but invisible in Yahoo's
      list until a reload, which would look exactly like a failure.
    - Whether Yahoo hands back an existing queue on connect. No longer blocking,
      since the first write no longer waits for one, but it decides whether the
      first write can stop replacing anything.

- [x] Let the app take a player out of the Yahoo queue, not only put one in.
  - Scope: the room remembers the ids it asked for and `queuePlan` subtracts
    them from the queue Yahoo reports, merging only what is left underneath the
    stars. Un-starring removes; an entry made in Yahoo's own panel still
    survives every write that does not name him. The disclosure under the
    control said "merges and loses nothing" and now says what it does.
  - Why: found live on 2026-09-07 in league `876392`, by the run that first
    proved the write works. Yahoo echoes the app's own list back in a `Q|`, so
    the merge read the app's own choices as the user's and rewrote them on every
    beat; un-starring put a player straight back. A filled star that cannot be
    emptied is a control that lies about what it is.
  - Acceptance criteria: un-starring a player the app queued removes him from
    the room; an entry the user made in Yahoo's own panel survives a write that
    does not name him; nothing the app never wrote is ever cleared. All three
    met and all three checked.
  - **The first attempt was wrong in a way that looks right, and the checks
    caught it.** Recording the whole written list marked the user's own entries
    as the app's the first time they were merged into one, so they were dropped
    as soon as nothing was starred -- the same defect, one write later. Two
    existing checks went red on it. Only the part the app *asked* for is the
    app's, and `queuePlan` now returns that separately from what it sends.
  - Automated validation: five checks in `npm run engine:test` under "Writing a
    Yahoo draft queue", in a room of their own so the existing sequence is
    untouched. Three of the five confirmed by failing against the pre-fix
    service, and the failure is the reported symptom exactly: un-starring one of
    two wrote `["8002","8003"]` back. The other two are the rule-does-not-move
    guards, which the old merge satisfied trivially. 369 passing. Typecheck
    clean, lint unchanged at 43 warnings, `server:test` 26/26, `bridge:test`
    7/7, build clean, `shots` clean with no console errors.
  - Manual validation: **done, live, and it is a natural experiment.** Yahoo
    mock `10977360`, seat 11, 2026-09-07. The service was restarted onto this
    fix in the middle of the same draft, so the room, the draft, the bridge
    build and the recorder are all held constant and only the service changes.
    Read off the capture, by taking each `S|` against the one before it and
    asking of every id that left whether a pick frame had taken him: before the
    restart, 25 removals and every one of them a drafted player, which is the
    pruning the old code could already do. After it, 13 more of those and
    **seven removals with no pick behind them** -- 30977 at 20:03:40, 31002 and
    40881 at 20:05:10, 33989 at 20:05:41, 40901 at 20:05:53, and 40063 twice, at
    20:06:27 and again at 20:06:39 after being re-starred in between. Times are
    UTC, as the dump's own filename is, because the capture stamps epochs and
    this machine reads them four hours behind. Yahoo
    echoed each write back with the shorter list. The disclosure was
    photographed separately.
  - Recorded: `DECISIONS.md`, 2026-09-07, "The queue this app wrote is the queue
    it may take back", with the two costs -- a service restarted mid-draft
    forgets whose entries were whose, and the last player the app queued still
    has to be deleted in Yahoo's own panel, because an empty list is never sent.
  - Dependencies or blockers: none. The user agreed the reading of the rule.

- [x] Say which starting slot a pick fills, since "a slot" was not enough.
  - Scope: new `starterSlot` in `client/src/engine/roster.ts` answers `own`,
    `flex`, `superflex` or null, reading the same order `startersFilled` spends
    slots in. `Recommendation.fillsStarter` becomes `slot` -- the boolean is
    `slot != null`, so keeping both would have been two fields for one fact --
    and it carries through the advice payload, the whitelist in `room.js`, the
    pool's take line and the panel's.
  - Why: the wording fix earlier the same day stopped the sentence claiming a
    need at the player's own position, but left it unable to say which slot it
    meant. The user asked for the slot by name, and it is worth more than
    politeness: "he fills your flex" names the bar he should be judged against,
    which for a flex is a back or a receiver rather than the next man at his own
    position. The pool now says exactly that.
  - Acceptance criteria: the first tight end reads `own` and the second reads
    `flex` with the flex open and null once it is spent; a quarterback skips the
    flex, which does not take him, and lands in a superflex where there is one;
    a kicker fills his own slot and then nothing. All met.
  - Automated validation: six checks in `npm run engine:test`, in the pure
    "Roster maths" block, plus the two existing advice checks repointed at
    `slot`. 375 passing. Typecheck clean, lint unchanged at 43 warnings,
    `server:test` 26/26, `bridge:test` 7/7, build clean, `shots` clean with no
    console errors.
  - Manual validation: the `own` case photographed -- "+126 over a replacement
    WR, and 119 more at your next turn. He fills your open WR slot." **The flex
    wording is not photographed**: reaching it needs a roster whose own slots
    at the recommended position are full, which no `shots` scenario drives to,
    and building one for a sentence is not worth a scenario. The reading behind
    it is checked and the render is a ternary over it.
  - A stale panel degrades honestly. An absent `slot` means a service older than
    the panel, and the clause is dropped rather than guessed -- saying he fills
    nothing would be a false statement where the boolean it replaced said the
    opposite. The whitelist takes one of three words or nothing, so the page
    cannot put arbitrary text on the panel over a draft.
  - Not touched: the valuation half. He is still priced against a replacement at
    his own position while filling a flex, so the number is overstated even
    where the sentence is now honest about which slot he takes. That is the open
    half of M1 and R6.
  - Dependencies or blockers: none.

- [x] Price a flex filler at what a flex costs to fill.
  - Scope: `PositionValue` carries the replacement level its `now` was taken
    over, and `rankCandidates` re-prices a candidate whose slot is `flex` or
    `superflex` over that slot's bar -- the highest replacement among the
    positions the slot takes. The `nextTurn` term is re-based the same way,
    which only bites on a roster with more than one flex. The take line says
    which bar it stands over, in the pool and on the panel.
  - Why: reported live 2026-09-07 and approved as its own change. With a tight
    end held and the flex open, a second one was priced against roughly TE12 in
    a one tight end league -- a soft bar the top of that board is steep above --
    while the slot he was competing for was the flex, whose bar is a back or a
    receiver. Value over replacement asks what the slot would otherwise hold.
  - Acceptance criteria: a flex filler is priced over the flex bar and an own
    slot filler is unchanged; between two flex candidates the one with more
    points wins rather than the one with the softer bar; nothing about the
    pool's WORTH column moves, since that is a fact about a player at his
    position and not about a roster. All met.
  - Automated validation: four checks in `npm run engine:test`, 379 passing.
    **Three of the four confirmed by failing** with the re-pricing neutered in
    place, and the failure is the report itself -- "TE worth 60", the tight end
    taking the flex on the soft bar. The fourth is the control and passes both
    ways, because an own-slot filler is what does not change. Typecheck clean,
    lint unchanged at 43 warnings, `server:test` 26/26, `bridge:test` 7/7, build
    clean, `shots` clean with no console errors.
  - Manual validation: the own-slot line photographed -- "+112 over a
    replacement RB, and 87 more at your next turn. He fills your open RB slot."
    The flex line is still not photographed, for the reason recorded in the task
    above it: no `shots` scenario reaches a roster with its own slots full.
  - The direction is proved rather than sampled, which is worth more than a
    measurement here: the flex bar is a maximum over a set that includes the
    candidate's own replacement level, so a flex filler's worth can only fall or
    stay. Shared-slot candidates move down relative to own-slot ones and never
    up. No draft was replayed to count how often it fires.
  - Not touched, and the reason is unchanged: the bench case. A player filling
    no slot is still priced over a replacement starter he is not replacing. That
    is the open half of M1 and R6 and it needs expected usable weeks,
    replacement access and M4's calibration.
  - Recorded: `DECISIONS.md`, 2026-09-07, "A shared slot is priced at what a
    shared slot costs to fill", amending the scoring entry from earlier the same
    day, which stands.
  - Dependencies or blockers: none.

- [x] Re-post what the app wants queued when the service has forgotten it.
  - Scope: the app posts its wanted list only when the list changes, guarded by
    `lastQueueSent` in `DraftScreen.tsx`. A service restarted mid-draft has
    forgotten `wanted`, the app's guard still holds the same string, and no
    write happens again until a star is touched. Nothing says so on either side.
  - Why: found on 2026-09-07 while restarting onto the queue-removal fix during
    mock `10977360`. The room came back whole -- picks, pool, seats and the last
    `Q|` all restored -- and queue writing alone stayed dormant. It did not cost
    anything there because the test being run was starring a player, which is
    exactly what lifts it, and that is the trap: it hides behind any use.
  - Acceptance criteria: a service that has forgotten a room's wanted list is
    told it again without the user touching a star; nothing is written more
    often than now while the service does remember. Both met.
  - Built: the picks read now carries `queueState`, the same `off`/`first`/
    `ready` the advice route names `queue.state`, on the beat the app already
    listens to rather than a second poll of its own. `DraftScreen` keeps it, and
    `off` while the setting is on lifts the guard for exactly one post: the next
    poll reads `ready`, and a React state set to the value it already holds
    re-runs nothing, so a service that goes on remembering is written to no more
    often than before. It is the app's half of the bridge's `needQueue`, which
    already restores the room's own queue after the same restart.
  - Automated validation: two checks in `engine:test` under "Writing a Yahoo
    draft queue" -- a wanted list the service is not holding reads as `off` with
    the picks, and one it is holding reads as the write it would make. Full
    `engine:test` green, `server:test` 26 passing, `bridge:test` 7 passing,
    typecheck and build clean, lint unchanged with nothing in the lines touched.
  - Manual validation: `npm run shots` clean, no console error, the queue
    control photographed. The three fixture suites skipped as ever.
  - What the checks do not reach: the client half is three lines and was read
    rather than driven, since nothing here can restart a service under a live
    draft in a browser. Worth watching once on the next mock.
  - How the run was ordered, since the failure under test is a restart: the
    service on 5178 had been up nineteen hours and nothing from outside says
    whether it is holding a room, so `engine:test` first ran against a second
    service started on 5179 from the new code, leaving the running one alone.
    The whole gate was then re-run against 5178 once restarting it was asked
    for -- `engine:test` green and `shots` clean with no console error against a
    service the status check calls current.

- [x] Stop the stale-bridge banner giving advice that costs a draft seat.
  - Scope: one sentence in `App.tsx`. "Reinstall from the service, then reload
    the draft room" became "then re-open the draft room from the lobby rather
    than reloading the tab", with the reason after it -- which is the wording
    the silence banner immediately above it already carried.
  - Why: recorded as noticed and not acted on when that silence banner was
    built. `docs/yahoo-draft-protocol.md` has it observed: Yahoo's `auth` is
    single use, reloading the URL does not reconnect, it leaves the draft. So
    the one banner that fires mid-draft against a bridge that is still
    mirroring picks correctly was telling the user to do the thing that ends
    their draft, to fix a fault whose entire cost is an unwritten queue. Taking
    the advice was worse than the defect it was advice about.
  - Acceptance criteria: no user-facing string in the client tells anyone to
    reload a Yahoo draft room; the sentence carries its reason rather than
    being a rule to take on trust; the reinstall-then-re-open order survives,
    since a manager still holding the old copy would only re-inject the old
    copy. All three met.
  - Automated validation: none added, and none is possible -- what changed is a
    string, and no check can tell safe advice from advice that costs a seat.
    The same reasoning as the wording fix earlier in this phase. Typecheck
    clean, lint unchanged at 43 warnings, `server:test` 26/26, `bridge:test`
    7/7, `engine:test` green with the three fixture suites skipped as ever,
    build clean, `shots` clean with no console errors.
  - Manual validation: **done.** The banner photographed in a real browser
    reading the new sentence end to end, with the reading served to the page
    rather than posted to the service, so a bridge that might have been posting
    for real was left alone. No console error on that page either. `shots` does
    not reach this banner and was not made to: driving it needs a bridge report
    the service will not produce on demand.
  - Left alone deliberately: `tools/yahoo/draft-room-probe.js` also says to
    reload the room, and there it is right -- it is a developer probe whose
    whole purpose is catching a socket as it opens.
  - Dependencies or blockers: none.

- [ ] Keep a seat off Yahoo's autodraft.
  - Scope: not started, and deliberately not started. Reading the captures for
    the queue turned up `5|<seat>` and `6|<seat>`, autopick going on and coming
    off, and one outbound `6|<league>|<team>` sent by Yahoo's own client. So a
    seat can take itself off autodraft.
  - No longer blocked on the experiment: it was run, against mock `10892178`,
    and the direction is confirmed rather than inferred. `5|` is autopick going
    on and `6|` is it coming off, established from a seat whose state was known
    on both sides — it had picked by hand, its clock expired, `5|3` landed and
    it was picked for 30 ms later; it then sent `6|10892178|3` and got its own
    clock back. `docs/yahoo-draft-protocol.md` carries the frames. So sending
    `6|` to escape autodraft cannot switch it on.
  - What the same capture sharpened: the trigger is a clock that expires
    unpicked, not a vaguer inactivity rule, and `5|` marks the transition rather
    than each autopicked pick. The seat was named three times in eleven rounds
    and took two picks under autopick with no `5|` between them.
  - Then a product question worth its own decision rather than an
    implementation: one `6|` buys one clock. Keeping a seat off autodraft means
    answering every `5|<your seat>` with a `6|`, for the whole draft — the app
    persistently fighting Yahoo's inactivity rule on the user's behalf, and
    doing it within the ~30 ms between the flip and the pick if it is to save
    the pick at all. That is a larger claim on a live draft than writing a
    queue, and it should be decided rather than assumed.

- [x] Choose which sources price the board, and say what the numbers imply.
  - Scope: `adpSource` became `<rule>:<feed>,<feed>` — a tick per feed plus
    averaged or in-order — with the four older namings normalised on the way in
    so a saved league opens on the board it opened on. Yahoo's own room ADP
    became a fourth feed, offered only while a draft is being followed, since
    only the bridge can reach it. The pool's projected-points column became
    points over a replacement starter, and a key above the pool says what each
    number implies.
  - Acceptance criteria: every older naming produces the board it always did;
    no choice of feeds can empty a position; an average is of the feeds named
    and no others; a room nobody posted is dropped rather than refused. All met
    and all checked.
  - Automated validation: eleven new checks in `engine:test` under "Choosing
    which sources price the board", plus four in the Yahoo suite that price a
    board off the posted room. Full run green with the service restarted first.
    Typecheck, build and `server:test` clean; lint unchanged at 36 warnings,
    none in the files touched.
  - Manual validation: `npm run shots` clean with no console error, and the
    control, the key and the new column photographed open in a real browser.
  - **Found while building, and fixed before it shipped.** Making ESPN
    independently selectable took all 45 kickers and all 32 defences off the
    board, because ESPN abstains on both and nothing else was left to price
    them. A league starting one of each could not have filled a roster. The
    chosen feeds now decide who is asked first rather than who may answer.
  - Behaviour that did change, deliberately: `consensus` past pick 240 in a 12
    team league. It used to fall back to the first feed holding a number and now
    takes their mean, which is what `blend` always did. Measured: 295 players
    moved, none of them inside any draft, and the draftable board is identical
    in content and order.

- [x] The board's reading, shown over the Yahoo draft room.
  - Scope: the app posts what it has worked out to the service, the service
    holds it, and a panel over the draft room collects and paints it. The engine
    stays in the client; the service forms no opinion. `DECISIONS.md` carries
    both the amendment that allowed the bridge to show and the later one that
    moved the panel out of it.
  - Acceptance criteria: the panel shows the current pick, the room's lean and
    the positions worth spending on, and cannot interfere with the draft under
    it. Met.
  - Automated validation: `engine:test` covers the advice endpoint — refused for
    a room nobody posted, not creating one by being asked, round-tripping what
    the app sent, and keeping nothing it was not asked to keep. Sleeper is
    refused a room to advise on, as it is refused ingestion.
  - Manual validation: driven in a real browser against a stand-in draft room.
    Mounts, renders live advice, survives the page re-rendering over it, stays
    inside the viewport, and hit-testing at its own coordinates returns the draft
    underneath rather than the panel. Confirmed working in a live Yahoo draft.
  - **Learned the hard way, and worth not repeating.** The panel began inside the
    bridge userscript and spent a whole live draft invisible while the bridge in
    the same file posted every pick correctly: the manager reported the script as
    current, the served file was right, and the body executing was neither. Two
    faults of mine made that undiagnosable — every error path was silenced, and
    the only line naming the running version was at the end of the file, so it
    printed only when nothing had gone wrong. Both are fixed, and the panel is a
    bookmarklet that no manager stands in front of.

- [x] Point what the service hands out at the port the service is on.
  - Scope: `atServiceOrigin` in `server/src/bridge.js` rewrites
    `http://127.0.0.1:5178` to the port this process bound, and every copy the
    service hands out goes through it -- the bridge userscript, `/panel.js` and
    the bookmarklet `/panel` builds. `/api/bridge/build` gained `installUrl`,
    and the app's stale-bridge banner links to that instead of to a literal.
  - Why: `PORT` is a documented setting and nothing downstream of it moved.
    Set it and the bridge posts to a port nothing is listening on, so it reaches
    the service never; the manager checks a closed port for updates, so the copy
    can never refresh itself; the panel reads nothing; and the app's "reinstall
    from the service" link is dead at the moment the user has just been told to
    click it. That last one is this repository's own recurring failure -- a copy
    going stale in silence -- arriving by the one route the build stamp cannot
    see, because a bridge that never reaches the service reports no build to
    compare.
  - The approach, and why not a placeholder: the file keeps a working default
    and the service rewrites on the way out. So a copy run straight from the
    repository still works unmodified, which is a supported way to run this and
    is what `bridge:test` loads; and a copy served on the default port is byte
    for byte the file on disk, so the common case cannot be broken by this.
  - Acceptance criteria: a copy served on the default port is unchanged; a copy
    served on another port names it in `@downloadURL`, `@updateURL` and
    `SERVICE` alike; the build is unaffected, so a moved port never reads as a
    stale install; the app's install link follows the service. All four met.
  - Automated validation: four checks in `npm run server:test` under
    `bridge.test.js`, 14 passing, and one in `npm run engine:test`. **Two of the
    four confirmed by failing** -- neutering the rewrite reddens the moved-port
    check, and hashing the served bytes instead of the source reddens the
    staleness guard, which is the regression that guard is for. One is a drift
    guard rather than a behaviour check: the rewrite matches one literal, so a
    file that came to spell its origin any other way would go on being served
    pointing at 5178 with nothing to say so.
  - **The whole self-test was run against a service on 5179**, which is worth
    more than the single check: every Yahoo suite passed end to end against a
    service on a port nothing was written for. Typecheck clean, lint unchanged
    at 43 warnings, `bridge:test` 7/7, build clean, `shots` clean with no
    console errors against 5178 restarted onto this code.
  - Manual validation: **done.** The served bridge on 5179 names 5179 on all
    three lines and reports build `e7a163fa`, the same as the file on disk, so
    it is not called stale. `/panel.js` on 5179 names 5179 and on 5178 diffs
    clean against `userscript/draft-panel.js`. The banner was photographed in a
    real browser twice, reading its link from the real service each time: 5178
    gives a 5178 link and 5179 gives a 5179 one.
  - Left where it was: the README documents 5178 throughout, which is the
    default and is what a reader following the instructions will be on. The
    `PORT` row now says what follows it rather than every mention being hedged.
  - Dependencies or blockers: none. This was the concrete half of the release
    question below, taken on its own because it is a defect either way.

- [x] Write the CHANGELOG the last 41 commits never got.
  - Scope: `CHANGELOG.md` only. Everything since `c0ddb69` -- the bridge build
    stamp and the silence reading, the slot a pick fills, `PORT` reaching what
    the service hands out, the per-feed age, and thirteen fixes from the queue
    removal and the audit passes through to the key that could not be scrolled.
    Prepended as `Added` then `Fixed`, which is the order a release section here
    already uses.
  - Why: 41 commits of user-visible behaviour had landed on this branch and not
    one touched the file. `ROADMAP.md` names the entry as Phase 6 work, and it
    is cheaper to write while the reasoning is still in `TASKS.md` than to
    reconstruct at release.
  - **One existing entry was wrong rather than missing, and is corrected.** The
    queue entry explained the first write with "nothing can read a Yahoo queue
    before writing one -- no frame reports one unprompted and no endpoint
    carries one". `e019eec` established that as false: the connect burst carries
    a `Q`, arriving bare when the queue is empty. The behaviour it describes has
    not moved -- a write before the room has reported a queue still replaces it
    unseen -- so the sentence now gives the real reason, that the bridge
    attached late. `room.js` had carried the correction in a comment since;
    Phase 6's exit criterion is that no documented promise goes unkept, and this
    was one.
  - Acceptance criteria: every claim traceable to a commit or to the code, no
    entry for a change a user cannot see, and the file's own conventions held --
    80 column wrap, British spelling, LF endings. All met.
  - Automated validation: none applies, and none is possible; the change is
    prose. Verified instead by reading the claims back against the source rather
    than against the task notes: `BRIDGE_QUIET_MS = 15000` for the fifteen
    seconds, `STARTER_SLOTS` for the three words the panel accepts, `FeedAges`
    on the draft screen for the per-feed age, and `queuePlan`'s three states for
    the corrected sentence. `typecheck`, `server:test` 30/30 and `bridge:test`
    7/7 were green on this tree; a markdown file cannot move them, and no code
    gate was re-run after the edit for that reason.
  - Manual validation: not applicable -- nothing rendered by the app changed.
    Line endings checked deliberately, because the rewrap went through Python
    and `.gitattributes` sets `eol=lf`: still 0 CRLF, and the diff stayed local
    at 203 insertions and 4 deletions rather than reflowing the file.
  - Found and not acted on, since it predates this and belongs to no request
    here: the panel entry in the released-pending section reads "A small panel
    over the draft page A small panel over the page carries the pick you are",
    a duplicated clause from an earlier edit. Worth a one-line fix at release.
  - Dependencies or blockers: none. This is the documentation half of Phase 6;
    the product questions in it are untouched and still open below.

- [ ] Decide whether the service should serve the userscript in a release.
  - Now serves three things, not one: the bridge userscript, `/panel.js`, and
    `/panel`, the page that installs the panel as a bookmarklet.
  - Added while validating: `GET /userscript/yahoo-draft-bridge.user.js`, so a
    manager installs from an address and can pick up later versions instead of
    the user re-pasting a file. It is the install path the README now documents.
  - Worth a second look before release: it is the first static asset the service
    serves. The hard-coded `127.0.0.1:5178` part of this is now fixed -- see the
    task above -- so what is left is the product question of whether serving
    them at all is right for a release, not a defect.

- [x] Offer Yahoo's ADP whenever the room has one, follow a Yahoo room at its
      own pace, and settle where the player pool opens.
  - Scope: three faults reported from a live Yahoo mock run through the
    assistant. `roomState` gained `pricesBoard` and the client watches it, so a
    room arriving after the board was built still lights the "Your draft room"
    feed. The picks poll split into `PUSHED_POLL_MS` and `POLL_MS`, two seconds
    for Yahoo and eight for Sleeper. The pool's opening order became a saved
    setting, "Open the pool on", with the shipped default matching what it
    always did. `SortKey` and the four offered orders moved to
    `engine/types.ts`, so the setting and the pool's own narrow select read one
    list. See the 2026-09-06 decision "A pushed platform is watched, not asked
    once".
  - Acceptance criteria: the room feed goes from dead to live without a reload
    when a pool lands; it goes dead again if the room does; a Yahoo pick reaches
    the board in about two seconds and a Sleeper poll is unchanged; the pool
    opens on the saved order, falling back to ADP where "My rank" is asked for
    with no file loaded. All met and all checked.
  - Automated validation: two new checks in the Yahoo suite of `engine:test` —
    a room posted without its pool prices no board, and says it can once the
    pool lands. `npm run engine:test` all pass with the service restarted first;
    `server:test` 4/4; typecheck and build clean; lint 38 warnings against a
    baseline of 37, the one addition being the same `react(refs)` pattern the
    file already carries fifteen of.
  - Manual validation: `npm run shots` clean, no console error. Its Yahoo mock
    scenario was extended to post the room and the pool separately and assert
    the control comes alive between them — **checked by removing the trigger and
    watching it time out**, then restored. The setting was driven in a real
    browser: default reads "My rank", choosing "Worth" opens the pool with the
    Worth chip pressed, and the field was photographed in place.
  - Validation not run: the two fixtures-dependent suites, plus a third, all
    skipped for want of `client/fixtures.local.json`. They are the only checks
    over league and draft code in `server/src/platforms/`, so the Yahoo change
    here rests on the synthetic-frame suite alone. The first task in this phase
    is what closes that.
  - Raised, not acted on: `refreshToken > 0` in `App.tsx` latches, so once
    "Refresh ADP" is pressed every later board fetch that session forces the
    upstream feeds. Pre-existing, and this change makes board refetches somewhat
    more frequent. The `split` sort key is unreachable — no control sets it —
    and was left in place.

- [x] Repair the seven correctness defects the value and forecast audit found.
  - Scope: the audit in `review/review.md`, worked in its own order of expected
    impact on Yahoo pick accuracy, taking only the findings that are defects
    with one right answer. R8, the survival tail read in logs so a player far
    past his ADP stops reading as certain to last. R7, replacement starters
    allocated inside the slots the league actually has. R4, the best survivor
    measured by what he is worth rather than by ADP order, so both sides of the
    waiting-cost subtraction mean the same "best". R5, an explicit zero for a
    player no run leaves on the board, which three consumers had been reading
    two different ways. R3, one `decisionHorizon` for the screen and the
    forecast, so the room is still read while the pick is being made, with your
    own turn stepped over rather than played by the CPU. R9, a corrected live
    pick read as a change rather than as the same room, plus out-of-order poll
    answers dropped. R2, a position the engine cannot start kept off the board.
  - Why: the audit reproduced each one against the real modules. The two with
    the widest reach were silent: the live 12 team half-PPR board allocated 131
    starters against 108 slots, inflating RB and WR worth against QB and TE for
    every player on it; and the forecast returned null whenever the user was on
    the clock, so every measurement of the actual room was dropped for generic
    ADP at the one moment the pick had to be made.
  - Acceptance criteria: each finding's own acceptance check from the audit.
    Replacement allocation sums to the league total and respects eligibility; a
    one-QB no-flex league starts twelve on a board that takes 24 first; the
    on-clock forecast reaches pick 20 from pick 5; waiting for a player the room
    never takes costs nothing; a player taken in every run reads as zero
    everywhere; extreme tails stay probabilities; `[A, B]` then `[A, C]` puts B
    back and takes C; every board position is supported and every count finite.
    All met.
  - Automated validation: 31 new checks in `npm run engine:test`, and one
    existing check repointed at the horizon the forecast actually uses rather
    than the one it happened to agree with. Typecheck, lint, `engine:test`,
    `server:test`, `bridge:test`, build and `shots` all clean, no console
    errors, lint warnings unchanged at 43 against a stashed baseline. Two of the
    new checks were confirmed by failing: the R2 board checks fail against the
    pre-fix service and pass against the fixed one, and the extreme-tail check
    caught a genuine underflow boundary while being written, which corrected the
    assertion rather than the code.
  - Manual validation: `npm run shots` clean. The on-clock mock screen shows all
    of it working together: the cost-of-waiting panel headed "to 2.07 #19" and
    populated rather than empty, explicit "0% he lasts" and "100% he lasts"
    rows, and worth over replacement that no longer counts phantom starters.
  - Validation not run: the two fixtures-dependent suites, still skipped for
    want of `client/fixtures.local.json`. The R2 board change was checked
    against a second service on port 5179 rather than by restarting the one on
    5178, which had been heard from by a bridge three minutes earlier. 5178 was
    then restarted with the user's agreement and reports current; the four R2
    board checks pass against it.
  - Found, pre-existing, not acted on: `engine:test` fails one check against
    today's refreshed feeds -- "an ordinary room reads as no lean", reading WR
    1.9 against a threshold of 1.5. It is not from this work. The pre-fix commit
    was checked out into a worktree and run against the same board, and it fails
    with the same four numbers; separately, `observedLean` computes bit-identical
    readings on both versions, and it depends on nothing this change touched.
    The lean tolerance is calibrated against upstream ADP that moves daily, so
    the check is data-sensitive by construction. Left alone as an unrelated
    defect rather than retuned to make a run go green.
  - Raised, not acted on: Travis Hunter's WR row still has no projection.
    Attaching Sleeper's DB total would assert that 83.1 points filed under DB is
    a receiving projection and not an IDP one, and if it is IDP that silently
    corrupts his worth, which is worse than the missing value the board already
    shows honestly. A data question about the feed, left for a decision.
    `nextUserPick` and `picksUntilUserTurn` now have no production caller; both
    left as pre-existing surface. The eight findings the audit ranks that this
    does not touch are listed at the end of `review/review.md`: R1 needs the
    real Yahoo scoring, and M1, M2, M4, M5, R6, R10 and M3 change accepted
    product decisions.
  - Dependencies or blockers: none.

- [x] Take the last two audit findings that are defects rather than decisions.
  - Scope: R2's missing projection and M5's bye coverage. `projectionMap` reads
    the first `fantasy_positions` entry a roster can hold when the position a
    player is filed at is not one, so a two-way player's projection reaches the
    board row the market already holds. `buildBoard` reads a bye off the team,
    because that is whose week off it is, and carries it to every row Fantasy
    Football Calculator does not cover.
  - Why: both were left in the first pass, and neither needed a decision after
    all. R2's projection was held back on the grounds that attaching 83.1 points
    filed under DB might assert a receiving projection where an IDP one would
    silently corrupt his worth. The payload answers it: the three points columns
    are 65.6, 83.1 and 100.6, each exactly 17.5 apart, which is 35 catches at
    half a point. An IDP total is the same number in all three, and 83.1
    reconciles to 415 receiving yards and 3 touchdowns rather than to 31
    tackles. `fantasy_positions` is `["DB", "WR"]`; only `player.position` says
    DB. M5's byes were never a judgment about grades: 399 of 626 rows carried no
    bye while the board already knew all 32 teams' weeks, so a roster of
    starters who all sit in week 7 showed an empty column, no clash highlight
    and no clash in the grade -- a missing field reading as a covered roster.
  - Acceptance criteria: Hunter's projection lands on one WR row rather than
    creating a second person, and every board position stays one a roster can
    hold; a record with no draftable fantasy position is still dropped; every
    row on a team has that team's bye, and the rows left without one are exactly
    the rows with no team. All met. Row count, duplicate names and unsupported
    positions are unchanged at 626, none and none.
  - Automated validation: four checks in `npm run server:test` on hand-written
    records, because the rule is what needs checking and not this season's
    example -- next year's feed may file Hunter anywhere. One check in
    `npm run engine:test` for the byes. Both confirmed by failing: the fantasy
    position check fails against a stashed pre-fix source, and the bye check
    fails against the service on 5178 before the restart, naming three of the
    339 rows. Typecheck, lint unchanged at 43 warnings, `server:test` 18/18,
    `bridge:test` 7/7, `engine:test` 348 passing against its one pre-existing
    failure, build and `shots` clean, no console errors.
  - Manual validation: **done.** Photographed in a real browser: Oronde Gadsden,
    a Sleeper-only row, reads "LAC - BYE 7"; the Indianapolis Colts defence,
    which joins on team rather than name, reads "IND - BYE 13"; and Travis
    Hunter appears once as a WR with a worth rather than a blank. No console
    errors on any of the three.
  - Found while measuring: `normPos` already maps FB to RB, so the two fullbacks
    that first looked affected never were. Travis Hunter is the only record in
    the 2026 feed the position fix reaches.
  - Not acted on: the rest of M5. What the letter grade means, what coverage it
    exposes, and whether a static season total is the right thing to rank are
    decisions, and they stay open with the other seven findings.
  - Dependencies or blockers: none.

- [x] Read the lean check on an average, since one room was never a reading.
  - Scope: `engine:test`'s "Reading the room" block plays each CPU preset over
    eight seeds and reads `observedLean` on the mean rather than on one room.
    `play` takes league overrides so the seed can vary; `leanOf` averages. The
    dialled rooms are averaged too, so every comparison in the block is between
    two means.
  - Why: "an ordinary room reads as no lean" had been failing for two sessions,
    correctly diagnosed both times as not caused by the work in hand and left
    alone rather than retuned. Measuring it said why. The `market` preset has
    zero position bias, and `baseline` in `forecast.ts` rebuilds that identical
    model to subtract, so the reading is sampling noise whose expected value is
    zero -- and `baseline` already averages three runs for its half of the
    subtraction while the played half was a single run. Over sixteen seeds every
    position averaged within 0.33 of zero, and the only reading anywhere outside
    the 1.5 band was WR 1.9 on seed 12345, the seed the file fixes. The check
    was red on a true statement, so no tolerance would have repaired it: any
    band is a coin toss the board's own drift re-flips. This is not the retune
    that was refused; it changes what the check measures to the quantity its own
    name claims.
  - Acceptance criteria: the suite is green on its merits, not by widening a
    band -- the 1.5 threshold is untouched and every other margin in the block
    holds or improves. Met: forcing backs 4.7 (was 4.2), fading backs -3.8 (was
    -4.2), the two rooms 8.5 apart (was 8.4), a receiver room 2.9 clear of
    market (was 2.5), the quarterback run 2.9 clear (was 2.5), and the no-lean
    reading worst at WR 0.6 against the same 1.5. The band still discriminates:
    the same `leanOf` reads a dialled room at 3.5 and -3.8.
  - Automated validation: `engine:test` all 349 checks passing, no failures, in
    5.8s -- the averaging costs under a second for all five readings. Typecheck,
    lint unchanged at 43 warnings, `server:test` 18/18, `bridge:test` 7/7, build
    and `shots` clean, no console errors.
  - Manual validation: not applicable; no product code changed. The block now
    prints its readings labelled "mean of 8 rooms" so a run says what the
    numbers are.
  - Not acted on: `QB_PICKS` stays at 48. Averaging is a second answer to the
    one-seed-in-eight the comment there records, but not a replacement for the
    depth -- it steadies a reading and cannot put quarterbacks on the board that
    three rounds never took. The comment says so now.
  - Dependencies or blockers: none.

- [x] Take the advice model: the audit's R6 and the scoring half of M1.
  - Scope: two commits. `rankCandidates` takes `picksLeft` and follows the two
    rules `chooseCpuPick` already did -- once your picks left equal your open
    starting slots only a candidate that fills a starter is weighed, and beating
    a replacement starter orders the list rather than qualifying for it. Then
    the score itself: what two turns come to together, his worth plus the best
    expected value at another position you would still have to start, in place
    of `now + (now - later)`. `Recommendation.urgency` becomes `nextTurn`
    through the payload and both panels, because the two numbers a panel prints
    have to be the two the pick was chosen on.
  - Why: the user chose this finding and agreed to reopen the 2026-09-05
    recommendation decision, which is what M1 needed. R6 turned out to need no
    decision at all: both rules were already in `cpu.ts`, described there as
    hard rules, so the app was holding its own opponents to a standard it did
    not hold its own advice to. It named a backup quarterback worth 100 over the
    receiver worth 30 who would have filled the last empty slot, and returned no
    queue at all from a pool of thirty sub-replacement backs. M1 was a
    counterexample the audit had already worked out in the app's own numbers:
    `2 * now - later` counts what a player is worth twice and what you would do
    instead not at all, and gave up 20 measured points on the audit's table.
  - Acceptance criteria: both of R6's own acceptance checks, and M1's. The last
    picks that can fill a lineup are not spent on a backup, and the backup is
    allowed back with a bench still to come; a queue keeps legal depth when
    every remaining worth is nonpositive, led by the one man worth having; the
    audit's table names the receiver for 170 rather than the back for 150; the
    scarce position is still the one to spend on; a full lineup is decided on
    worth alone. All met.
  - Automated validation: ten checks in `npm run engine:test`, 359 passing.
    Seven confirmed by failing first rather than assumed. Against the unchanged
    engine: the backup named on the last useful pick, the barren queue coming
    back empty, that same queue stopping at one entry, the audit's table taking
    the back for 150, the two turns not being the score, and a full lineup still
    carrying a second term. Against the service still running the old
    whitelist: the pick reaching the panel, which read `urgency: 0`. Typecheck
    clean, lint unchanged at 43 warnings, `server:test` 18/18, `bridge:test`
    7/7, build and `shots` clean, no console errors. Recorded as a 2026-09-07
    entry in `DECISIONS.md`, amending the 2026-09-05 one.
  - Manual validation: **done.** Photographed in a real browser, dark and light:
    the take line reads "+126 over a replacement WR, and 87 more at your next
    turn. You still have to start one", and those two numbers are the score.
    The live chain repeats both WR and RB rather than listing one leader per
    position, which is the behaviour the chain exists for.
  - Found while measuring, and it changed the work: two fixtures in
    `engine:test` were asserting data coincidences rather than code. The chain
    block read its advice off `byAdp.slice(19)`, a pool no draft produces --
    the first nineteen by ADP and nobody else, so the best tight end on the
    board is still sitting there -- and on the live board that state is a
    genuine tie. The old score cleared the three point gate there by 0.9 points,
    so the check was already one ADP refresh from red, exactly the trap the lean
    check was caught in twice. It now plays a room and stops at the first of
    your turns with a pick to name, asserting that precondition rather than
    assuming it. The one-slot fixture priced a pool of kickers and defences at
    pick 20, where neither will be taken and either order comes to the same two
    turns; it now prices them at the last-rounds turns such a pool occurs at.
  - Measured consequence, reported rather than hidden: over seat 5's fifteen
    turns in a played 12 team half-PPR draft the board names a pick at twelve of
    them, against fifteen before. The three it declines are margins of 0.2, 1.5
    and 1.8 points across two turns. The gate did not move and should not --
    three points is three projected points, and the new score states them in
    those units where the old one roughly doubled them.
  - Not acted on: bench valuation, which is what is left of both findings. A
    backup still carries his full value over a replacement starter, so outside
    the compulsory case he can still outrank a player filling an empty slot.
    That needs expected usable weeks, replacement access and M4's calibration,
    not the coefficient two decision entries have now rejected. Also raised: the
    service on 5178 is stale against this change and needs a restart before it
    is trusted; the payload check was run against a second service on 5179
    instead, and fails against 5178 with `urgency: 0`, which is what confirmed
    the rename.
  - Dependencies or blockers: none.

- [x] Repair feed degradation, the audit's R10, to the policy the user chose.
  - Scope, settled 2026-09-07 and built: a response that parses cleanly but
    carries no players, or none at a position the board expects, is treated as a
    failed fetch, so `cached` keeps the prior disk snapshot and marks it stale
    rather than overwriting it with an empty one. Plus a per-feed
    `AbortSignal` timeout on all three feeds, ESPN awaited only where it prices
    the board, and a per-feed age in `meta.feeds` that the draft screen prints.
  - Why: measured, not assumed. There was no timeout anywhere in `server/src`,
    so a hung ESPN could hold the whole board behind `Promise.all`; ESPN's
    `stale` was left out of the combined flag; and Sleeper's `fetchedAt` was a
    `Math.max` across positions, so a stale position hid behind a fresh one.
    `cached` already fell back to a stale disk copy when a fetch threw -- the
    gap was that a valid-but-empty response does not throw.
  - Acceptance criteria: the finding's own. Empty or malformed-success responses
    preserve a usable prior snapshot or fail clearly; a hung optional source
    does not block draft availability; stale selected sources stay visible
    during the draft. All three met and all three checked.
  - How each feed decides it has been answered badly, and why they differ: FFC
    sends every position in one payload, so its rule is that the payload names
    somebody. Sleeper is one request per position, so "none at a position the
    board expects" lands there exactly -- a position with no projected player in
    it is a failed fetch. **FFC is deliberately not held to position coverage:**
    dynasty is cached nowhere here, so requiring six positions of it would be
    asserting today's shape of a feed, which is the trap the lean check was
    caught in twice.
  - Automated validation: eight checks in the new `server/src/degradation.test.js`,
    taking `npm run server:test` to 26. **All eight confirmed by failing**
    against the pre-fix source, stashed and re-run: the empty market payload
    overwrote the good copy, the unprojected positions reported themselves
    fresh, no request carried a signal, the hung ESPN hit the test's own
    fifteen second deadline, and the oldest-position reading and `meta.feeds`
    did not exist. Five more in `npm run engine:test`, 364 passing, three of
    them confirmed by failing against a pre-fix service on 5179; the other two
    guard the shape and are vacuous on an absent reading, which the first check
    in the same block catches. Typecheck clean, lint unchanged at 43 warnings,
    `bridge:test` 7/7, build clean, `shots` clean with no console errors.
  - What the new checks cost: 3.5 seconds, and it is unavoidable. Two of them
    wait out a real bound -- one that the board gives up on a feed that is not
    pricing it, one that it does not give up on a feed that is. The timeout
    durations themselves are not exercised, and saying so is better than a stub
    that ignores a signal and proves nothing.
  - Manual validation: **done.** The per-feed line photographed in a real
    browser, dark and light: "Sleeper 6h · FFC 6h · ESPN 6h", with ESPN greyed
    where the choice is Sleeper then FFC, which is the reading for a feed whose
    age is not the board's. Driven against an isolated pair -- a service on 5179
    and a client on 5180 pointed at it -- rather than by restarting 5178, which
    a live Yahoo draft was mirroring through at the time.
  - Not photographed: a stale feed in red. Forcing one needs a feed that fails
    while a copy sits on disk, which is a network to block rather than a fixture
    to write. The path itself is covered by four of the server checks.
  - Measured while building: ESPN answers in 0.36s with 0.7MB, against the
    "about forty megabytes" its own file header claims. The bound was chosen
    from the measurement; the header was left alone as an unrelated staleness.
  - Not acted on, and not in the settled scope: the finding's other note, that
    an uncached FFC failure rejects the whole board even where Sleeper could
    price it. Also left: `ADP_FEEDS`'s labels are not sent in `meta.feeds`,
    because the client already holds its own and two naming authorities for one
    feed is how they drift apart.
  - Dependencies or blockers: none.

## Planned next: Yahoo-first in-season advice

Requested 2026-09-08. Planning only; all implementation tasks below are unstarted.
The current draft tasks above remain open with their recorded validation gaps.
See [PLAN.md](PLAN.md) for the approach and ROADMAP.md Phases 7-11 for outcomes.

### Phase 7 tasks, in order

- [ ] Y7.1: Establish read access to the user's Yahoo league after the draft.
  - Scope: observe ordinary league-page data requests in the user's signed-in
    browser; identify season/league/team keys and a reproducible read path.
    Check the recorded API application's status without exposing credentials.
  - Acceptance: demonstrate a league/settings and roster read outside the
    draft room, or document the concrete blocker. Record permission needs and
    whether the access model fits the existing no-server-credentials rule.
  - Validation: compare the reading to Yahoo and repeat it after normal page
    navigation; retain only sanitized examples. No platform writes.
  - Dependency: implementation authorization and access to the real league.
  - Progress, 2026-09-08, authorized and part done. The route is established
    and written up in `docs/yahoo-in-season-data.md`, sanitized: the league
    pages call `pub-api*.fantasysports.yahoo.com` and answer under the same
    `fantasy_content` envelope the official API documents, on the browser's own
    cookie and with no OAuth. Observed against the owner's real 8-team league.
    Keys are `<game>.l.<league>` and `<game>.l.<league>.t.<team>`, with the game
    code read from the league rather than assumed, since it changes yearly.
  - What that settles: the league object, all teams with standings and waiver
    priority, and — the one that matters — own-team identity, because
    `users;use_login=1/profile` returns a `guid` and every team carries
    `managers[].manager.guid`. Y7.2's requirement that the own team be
    established rather than inferred from a seat number is answered by that
    pair, which is something the draft adapter cannot do. The access model fits
    the no-server-credentials rule unchanged: transport stays in the browser.
  - The pages themselves stop short: settings, team and players fetch no JSON
    at all and arrive as server-rendered HTML. The same API answers its own
    sub-resources anyway, which those pages simply do not call. Asked once each,
    read-only, on the user's say-so: `/league/<key>/settings`,
    `/team/<key>/roster` and `/league/<key>/players;count=<n>` all returned 200.
    XML by default, JSON with `?format=json`, same `fantasy_content` envelope.
    So no HTML parsing is needed anywhere and none should be built.
  - Which ends the unknown `importLeague` has carried since the seam went in.
    Settings gave the roster slots — `QB:1 RB:2 WR:2 TE:1 W/R/T:1 K:1 DEF:1
    BN:8 IR:2`, flex as a composite position — and the scoring itself as 38
    `stat_categories` with 35 `stat_modifiers`, plus `waiver_type`,
    `waiver_rule`, `uses_faab`, `trade_end_date` and the playoff fields. The
    roster gave 17 players carrying `eligible_positions` and
    `selected_position`, which is precisely the pair a legal-lineup check
    needs, with `bye_weeks`, `is_keeper` and `editorial_team_abbr` alongside —
    the same abbreviation `names.js` already joins defences on.
  - One shape quirk a reader must know: a resource comes back as a two-element
    array, `league[0]` metadata and `league[1].settings`, `team[0]` metadata and
    `team[1].roster`. That is the API's own JSON translation of its XML.
  - Left for Y7.4, and it is a product decision rather than a gap in the data:
    every read above worked because the browser attached its own cookie, so
    something must run on a Yahoo page. It does not follow that it is a second
    always-on userscript — the draft bridge has to be one only because it wraps
    `WebSocket` at `document-start`, and in-season reading is three ordinary
    fetches wanted when asked. Bookmarklet, second userscript, or widening the
    draft script's matches, which `PLAN.md` already warns against. Decide it
    before building it.
  - Not done: the API application's status is unchecked. Only the account
    holder can read it. Worth closing out either way now the browser route
    reaches everything the application asked for.
  - Tooling fixed while doing this, in git-ignored `tools/`, so it appears in
    no diff: `cdp-watch.mjs` held HTTP response bodies in memory and wrote them
    only from an exit handler that a killed process on Windows never runs.
    Frames were already appended live; responses were not, so all six earlier
    captures hold frames and no responses. Checked by capturing a real league
    page and killing the watcher with `Stop-Process -Force`: 4.7 MB of bodies
    survived where the old tool saved nothing.

- [ ] Y7.2: Audit league fields and completeness through the observed route.
  - Scope: every roster, own lineup, scoring, all position eligibility, locks,
    player availability, waiver/FAAB rules, trade restrictions and pagination.
  - Acceptance: a field coverage table in `docs/yahoo-in-season-data.md`,
    with observed source, timing, missing fields and affected features. Own
    team selection is established, not inferred from a draft seat number.
  - Validation: compare all rosters and settings against Yahoo; demonstrate
    the last page, a waiver player, and a free agent where present. Record
    unobserved cases honestly for later synthetic/manual checks.
  - Dependency: Y7.1. Do not assume an unowned player is immediately addable.

- [ ] Y7.3: Establish weekly and remaining-season analysis coverage.
  - Scope: assess usable Yahoo, Sleeper and ESPN data independently of league
    integration, including raw stats versus point totals, scoring, player
    identity, injuries, byes, kickoff times, usage, freshness and access terms.
  - Acceptance: name the proposed sources and supported horizons, with
    coverage and missing-data behavior. Keep FantasyPros excluded unless the
    paid-key condition in DECISIONS.md changes. No purchases in this task.
  - Validation: sample multiple positions and missing/injured/bye players;
    verify week/season and scoring basis. Do not substitute draft rankings
    or annual projections for unobserved weekly data.
  - Dependency: Y7.2's actual league scoring and eligibility requirements.

- [ ] Y7.4: Close discovery with a concrete implementation design.
  - Scope: update PLAN.md with the observed reader approach, minimum snapshot
    contract, refresh/stale policy, identity mapping and source selection;
    create small Phase 8 tasks with automated and manual checks.
  - Acceptance: every dependent requirement is supported or explicitly held;
    explain any access, cost or scope decision still needed. Record the chosen
    technical approach in DECISIONS.md once settled, without claiming a
    working in-season feature exists.
  - Validation: trace the contract to Y7.1-Y7.3 evidence, check no credentials
    enter service payloads, and reconcile SPEC/ROADMAP/PLAN/TASKS. Document
    rollback and the outstanding real-league checks for implementation.
  - Dependency: Y7.1-Y7.3. Stop for a decision if the demonstrated approach
    requires changing an existing product or architecture boundary.

### Subsequent task planning

Phases 8-11 remain roadmap outcomes until their input contracts are established.
Before implementing each phase, split it into reviewable tasks with explicit
acceptance and validation, then record actual results rather than marking the
phase done from a build alone. Order: league view, weekly lineup advice,
waiver add/drop comparisons, trade evaluation, then trade targets and comparison
with waivers. Other league platforms remain deferred.

## Blocked

- [ ] Yahoo's own Fantasy Sports API, if the application is ever approved.
  - Applied 2026-09-01, no published turnaround. Parked rather than pursued:
    the browser route needs none of it. Worth comparing for pre-draft league
    import if a key arrives, and worth closing out if it does not.

- [ ] Ask the upstream maintainer whether Yahoo support is wanted at all.
  - Not blocked by anything, and it decides where both branches land. See the
    2026-09-01 entry in `DECISIONS.md`.

## Completed

- [x] Phase 3: extract a platform seam, with Sleeper behind it.
  - Delivered on branch `yahoo-platform`, commit `9aa1d4b`. The two Sleeper
    modules moved to `server/src/platforms/sleeper/` at 98% and 99% rename
    similarity; routes take the platform as a path segment; ID validation moved
    onto the platform.
  - Validation run: `npm run typecheck` clean, `npm --prefix client run lint`
    unchanged from baseline, `npm run engine:test` all checks passed. Routes
    checked by hand for a malformed ID, an unknown platform, an encoded-slash
    traversal attempt, a well-formed unknown league, and the untouched board
    route.
  - **Validation skipped, and the risk it leaves:** the two self-test suites
    that call the moved code did not run, because `client/fixtures.local.json`
    does not exist. The evidence that the move is behaviour-preserving is
    therefore the rename similarity, the typecheck, and the by-hand route
    checks — not a test that exercised `leagueSetup`, `draftPicks`,
    `draftState` or `importLeague` against a real league. A regression in those
    four functions would not have been caught. The current-phase task above is
    what closes this.

- [x] Draft and submit the Yahoo API access application.
  - Submitted 2026-09-01. Draft kept at `tools/yahoo/access-application.md`,
    which git ignores.
