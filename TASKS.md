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

Requested 2026-09-08, and no longer planning only: Phases 7 and 8 are built and
Phase 9 is part built, each task carrying its own recorded result. Read the
checkboxes rather than this line for what is done.
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

- [x] Y7.1b: Settle how a league is read, and prove the chain end to end.
  - Scope: the transport question Y7.1 left open, decided and built. A
    bookmarklet, `userscript/league-reader.js`, installed from `/league-reader`
    on the pattern the panel already set; `server/src/platforms/yahoo/league.js`
    to read Yahoo's JSON into a snapshot; `POST` and `GET
    /api/:platform/league/:id/snapshot`, offered only to platforms that can take
    one, exactly as the room routes are.
  - Decision: `DECISIONS.md`, 2026-09-08, applying the accepted panel entry
    rather than settling anything new. The bridge must be a userscript because
    it wraps `WebSocket` at `document-start`; this is four fetches when asked,
    so it inherits none of that. Widening the bridge's matches was rejected,
    as `PLAN.md` already warned, and so was a second userscript.
  - Simplified while building, and it removed the only discovery step: the API
    wants `470.l.<league>` and that leading number is the season's game code,
    which is nowhere in a league address. `nfl.l.<league>` reaches the same
    league in the current season and the numeric key comes back on the
    response, so nothing has to know what season it is. Checked against the real
    league. The endpoint that would have discovered it properly hung every time
    it was tried, which is worth knowing before reaching for it.
  - Automated validation: eighteen checks in `npm run server:test` under
    `league.test.js`, on a synthetic fixture that copies the shape and none of
    the people — the two-element resource, the index-keyed list, the metadata
    split into single-key objects padded with empties, the composite `W/R/T`
    slot, a scoring category with no modifier against it, and the refusals. The
    suite bites: reverting the `flatten` fix fails exactly one check and no
    others. Typecheck, lint, `server:test` 48, `bridge:test` 7, `engine:test`,
    build and `shots` all clean, no console errors.
  - Manual validation: **done, against the real league.** The bookmarklet as the
    service hands it out, run in the league page, reported "8 teams, 9 starting
    slots, 38 scoring rules, 17 on your roster" and the stored snapshot changed
    to match. Nine starting slots is the arithmetic of the slot list, which is
    the check worth having. The refusals were exercised too: a snapshot posted
    under the wrong league ID, a malformed envelope and an empty body all give
    400 and say which.
  - Worth knowing for the next run: a tab left open through repeated navigation
    freezes, and a frozen renderer runs synchronous JavaScript while never
    firing a timer or settling a fetch. That reads exactly like a hung request
    and is not one. A fresh tab fixes it; check liveness with a timer before
    concluding anything about Yahoo.
  - Left open on purpose, and cheap to reopen: whether this should become a
    userscript of its own, separate from the bridge, so a league reads itself
    without a click. Converting it is a metadata header and a match on the same
    file; nothing service-side moves. The case for it is a league tab left open
    all season, which a userscript could poll. Judge it against a screen that
    consumes the snapshot rather than before one exists. `DECISIONS.md` carries
    the reasoning, including the correction that the first version of that entry
    overstated: a missing snapshot is perfectly visible, more so than an empty
    draft board, because nothing is on a clock.
  - Deliberately not built: any in-season screen. There is no such surface in
    the app and inventing one is Phase 8's product question, not this slice's.
    So `shots` says nothing about this work, and the chain ends at the service
    handing the snapshot back.
  - Dependencies or blockers: none.

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
  - Already answered by Y7.1 and Y7.1b, so what is left is narrower than the
    scope above reads: the roster slots, the scoring as categories joined to
    modifiers, all rosters, own-team identity by guid, waiver method and trade
    dates are read and parsed. What is genuinely open is player availability
    and ownership, the FAAB balance where a league has one, pagination on any
    list, lock rules against kickoff times, and how any of it differs in a
    keeper league or a past season.
  - Progress, 2026-09-08, and the acceptance artifact is written. The coverage
    table is in `docs/yahoo-in-season-data.md`, grouped by the feature that
    fails without each field rather than by endpoint, every row marked with its
    scope and whether a response actually carried it. Each observed row traces
    to a capture under `tools/yahoo/dump` or to a request made while writing it.
  - The finding that reshapes Phase 7, and it was not expected: **the API has
    two scopes and only one needs the cookie.** Every `/league/...` path answers
    `401 "You must be logged in to view this league."` with no cookie, and every
    `/game/nfl/...` path answers `200`. Checked against the same league in the
    same minute, so it is the scope and not a fluke. So the browser is needed
    for the league and for nothing else: the pool, injuries, byes, ownership
    percentages with a weekly `delta`, ADP, the stat vocabulary and the week
    dates are all public, and the service could fetch them exactly as it
    already fetches Fantasy Football Calculator and Sleeper. **Recorded, not
    acted on** — whether it should is Y7.4's, and it moves an architecture
    boundary.
  - Closed by direct reading, all without an account: pagination, including the
    shape trap at the end of a list — a full page reads `count: 25`, the last
    page `count: 13`, and past the end `players` is a bare `[]` rather than the
    index-keyed object every other list is, so a pager reading `.count` gets
    `undefined` instead of zero. The pool was 2888 players, and `count=500`
    answered in one response despite the documented cap of 25. Injury fields
    are conditional, not empty: `status` and `status_full` were on 60 of 300
    players scanned and `injury_note` on 58, so absence means healthy and has
    to be written down as meaning that. Stats arrive as raw `stat_id` values,
    never as points, which is why the league's `stat_modifiers` are load-bearing
    and why points need both scopes at once.
  - Corrected a claim this repository had recorded as fact: the flex vocabulary
    **is** published. `/game/nfl/roster_positions` enumerates all 21 slots, the
    composites among them being `W/T`, `W/R`, `W/R/T` and `Q/W/R/T`. The comment
    in `server/src/platforms/yahoo/league.js` said that was a vocabulary Yahoo
    had not published and now says what is actually true. Its decision does not
    change: what starts still comes from the league's `is_starting_position`,
    which stays the sturdier reading either way.
  - Automated validation: none, and none is appropriate — nothing was built.
    The four game-scope reads are in the document as runnable `curl` lines and
    all four were re-run exactly as written, answering `200` under a
    `fantasy_content` envelope, so the document does not ship a broken command.
  - Not done, and why it cannot be here: the validation asks for a waiver player
    and a free agent, and both are league-scoped, so they need a signed-in
    browser run. Also outstanding are the other seven rosters, the FAAB balance
    — the available league uses waiver priority, so no league on hand can answer
    it — a set `weekly_deadline`, per-game kickoff times, which were found at no
    scope, and any keeper or past-season league. Every stat value read was zero
    because nothing had kicked off, so stat shape is observed and stat values
    are not. All of it is listed under "Still open" in the document rather than
    left implied.

- [x] Y7.3: Establish weekly and remaining-season analysis coverage.
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
  - Progress, 2026-09-08, and the assessment is written up in
    `docs/in-season-data-sources.md`. Read from a shell, no account and no key,
    so all of it is reproducible: the document ends with the five commands and
    each was re-run exactly as written. Fantasy Football Calculator was assessed
    alongside the three the scope named, on the grounds that the project already
    depends on it and omitting it would have read as a judgement.
  - Sources and horizons: **weekly projections come from Sleeper or ESPN, and
    from nowhere else.** Both cover the full regular season — Sleeper weeks 1
    to 18 sampled at 1, 4, 8, 14 and 18; ESPN weeks 0 to 18, where 0 is the
    season total and so answers rest-of-season directly. Neither projects the
    playoffs: Sleeper returns week 19 records with no points in any of them,
    ESPN stops at 18. Yahoo projects nothing at any public path. Fantasy
    Football Calculator has nothing weekly at all — `weekly-rankings` and
    `projections` are both 404 — so it stays a draft-ADP source, which is a
    property of the feed rather than a preference.
  - The structural finding, and it agrees with Y7.2 from the other direction:
    **a custom league's points cannot be fetched from anywhere and have to be
    computed.** Sleeper publishes `pts_std`, `pts_half_ppr` and `pts_ppr`; ESPN
    publishes an `appliedTotal` under its own default league; a Yahoo league has
    38 categories against 35 modifiers and no preset reproduces it. What makes
    it workable is that both sources also publish the raw components underneath
    — receptions, targets, rushing yards, touchdowns — so the join is components
    from a source against modifiers from the league. A scoring join is therefore
    unavoidable work rather than a later refinement.
  - Only-source rows, which are the ones a design cannot trade away: a league's
    scoring and roster slots come from Yahoo alone, and **kickoff times come from
    ESPN alone**, to the minute with live clock and period. That also closes the
    item Y7.2 left open as found at no scope — it was not in Yahoo, and
    `game_weeks` is not a substitute, because it dates a week rather than a
    kickoff. Sleeper's schedule carries a date with no time.
  - Missing-data behaviour, all observed rather than reasoned: only 463 of 3304
    Sleeper weekly records carry points, so an unprojected player must be
    dropped rather than scored zero, as the season code already does. **A bye is
    invisible in the projection feed** — 109 players on the four teams idle in
    week 8, not one with a projection, which is the same absence as a player
    nobody rated, so telling them apart needs the schedule. An absent injury
    field means healthy on both Yahoo and ESPN. An absent weekly actual may be a
    bye rather than a zero. The two injury vocabularies differ and need mapping.
  - A negative result worth more than a positive one, because it stops a future
    mistake: Sleeper's `/v1/players/nfl` carries `yahoo_id` on 6750 players and
    `espn_id` on 6736, which looks exactly like the authoritative join the
    2026-09-05 FantasyPros decision wished for. **It is legacy and inverted
    against need.** Coverage by `years_exp` over active QB/RB/WR/TE/K runs 0 of
    317 rookies, 13 of 726 at one year, 35% at two, ~100% at six and up.
    Ja'Marr Chase, Jahmyr Gibbs, Bijan Robinson, Puka Nacua, Amon-Ra St. Brown
    and De'Von Achane are all present, all active, all `yahoo_id: null`.
    Matching Yahoo's top 300 by id found 75, all veterans. So that decision
    stands with numbers behind it, and an attempt to fix `names.js` with these
    ids would pass a spot check on a veteran and fail every rookie. The 75 that
    did match yielded one useful thing: all four name disagreements were
    generational suffixes, Yahoo's "Chris Godwin Jr." against Sleeper's "Chris
    Godwin".
  - Checked and found accurate rather than corrected: `espnRanks.js` says ESPN
    ignores the filter. It does, on the path that file calls — 11617 players and
    39.6 MB whether the limit is 3 or 1000. A different path,
    `/segments/0/leaguedefaults/3`, honours it, though a limit alone is refused
    with "Filter: Limit request must be accompanied by a sort". Recorded because
    weekly projections need no forty megabyte download; nothing was changed.
  - FantasyPros stayed excluded and nothing was purchased, per the acceptance.
  - Automated validation: none, and none is appropriate — nothing was built. The
    document's five commands were each re-run as written and all answered 200
    with parseable JSON.
  - Not done, and listed in the document rather than left implied: **every
    actual stat value read was zero or empty**, because nothing had kicked off,
    so actuals are observed for shape and not for content and no claim about
    live scoring rests on this. Whether Sleeper's `{}` actuals path fills in
    once games are played is untested. No source was compared against another,
    so nothing here says which projection is better — only which exist. Rate
    limits were not found, which is not the same as absent.

- [x] Y7.4: Close discovery with a concrete implementation design.
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
  - Done, 2026-09-08. It did require a boundary decision, so it stopped and
    asked rather than choosing: the two questions were where the public game
    scope is fetched from, and which projection source the design names. Both
    were answered by the repository owner and are recorded in `DECISIONS.md`
    under this date.
  - Decided: **the service fetches Yahoo's public half directly**, as an
    ordinary source module cached on disk like Fantasy Football Calculator,
    Sleeper and ESPN, while the league half stays in the browser and in bounded
    memory. That sharpens the privacy boundary rather than blurring it — the
    service fetches what needs no credentials and touches nothing that does,
    which is what `SPEC.md` already asked for. And **weekly projections come
    from both Sleeper and ESPN with the disagreement shown**, on the same
    argument `espnRanks.js` already makes about draft ranks: two independent
    desks disagreeing is information, and a mean destroys it.
  - Written: `PLAN.md` gains "What discovery settled", which replaces the
    guesses the plan had to make with the observed reader, the minimum snapshot
    contract, the refresh and stale policy, the identity mapping and the source
    selection — each traced to one of the two documents rather than asserted.
    Phase 8 is split into four reviewable tasks above, Y8.1 to Y8.4, each with
    its own automated and manual checks, ordered so the first needs neither a
    league nor a browser.
  - Held explicitly, with the dependent feature named rather than left implied:
    availability blocks waiver advice, the FAAB balance blocks bid suggestions,
    actual stat values block any comparison of advice to results, and the
    unmeasured spread between the two projection sources blocks deciding how to
    combine them. **None of them blocks Phase 8**, which displays a league
    rather than advising on one. Availability is the one to close first, and it
    needs a browser run.
  - No credentials enter any service payload, which is unchanged and now
    load-bearing in two directions: the league half posts Yahoo's JSON with no
    cookie, token or crumb, and the game half needs none to begin with.
  - Rollback: this task changed only documentation, so reverting it is reverting
    three files. The Phase 8 tasks it wrote are unstarted, so nothing depends on
    them yet.
  - Reconciled: `SPEC.md` needed no change — its in-season requirements are
    satisfied by this contract, including keeping private snapshots out of the
    disk cache, which the two-scope split now enforces structurally.
    `ROADMAP.md` Phase 7's exit asks for a reviewable minimum data contract and
    access approach, which is what `PLAN.md` now carries. **Phase 7 is not
    complete**: Y7.1's API application status and Y7.2's league-scope reads are
    still open, and neither is closed by this task.
  - Automated validation: none, and none is appropriate — documentation only.
    Typecheck, lint, `server:test` and build were run anyway and are clean.

### Phase 8 tasks, in order

Split from the contract in `PLAN.md`, "What discovery settled". **Phase 8 was
authorized 2026-09-08 and every task in it is built, with Y8.5 and Y8.6 added
from what the owner found testing it. **Phase 8's exit criteria are now met on
the reading side**: the owner confirmed against their real league that all
rosters match and the own-team mark is on their team. Still open: the scoring
was called "ok" rather than checked rule by rule, and no second real league has
been tried, so switching between two of them is unexercised outside the
harness.** Each is
one reviewable outcome. They deliberately stop short of advice: Phase 8 shows a
league, and nothing in it recommends anything.

- [x] Y8.1: Fetch Yahoo's public game scope as an ordinary source module.
  - Scope: `server/src/sources/yahooPlayers.js` reads
    `/fantasy/v2/game/nfl/players` with `;out=percent_owned`, plus the three
    reference lists — `stat_categories`, `roster_positions`, `game_weeks` —
    each cached on disk through `server/src/cache.js` under its own key, on the
    pattern the other three feeds use. No browser, no cookie, no UI.
  - Extracted while building, because the second caller made it necessary
    rather than tidy: the shape readers were private to
    `platforms/yahoo/league.js`, and the game scope answers in the same dialect.
    They are now `server/src/yahooJson.js`, moved byte-for-byte with nothing but
    an `export` added — checked by diffing the extracted block against the same
    lines at `HEAD`. `league.js` imports them and its own 18 checks pass
    untouched, which is what makes the move provably behaviour-preserving.
    A `sources/` module importing from `platforms/` would have inverted the
    layers, so the dialect went to `server/src/` beside `names.js` and `cache.js`.
  - Acceptance criteria: all three met. The pool pages to the end and stops; a
    status absent reads as nothing reported rather than as a shape fault; the
    stat and slot vocabularies are read and available to join a league's
    settings against.
  - Automated validation: 22 checks in `npm run server:test` under
    `yahooPlayers.test.js`, on synthetic fixtures copying the shape and none of
    the people. **The suite bites, and was checked by breaking it on purpose:**
    reverting the end condition to read the list's own `count` fails exactly the
    two past-the-end checks and no others. The short-final-page check still
    passes under that revert, which is precisely why the empty-array case needed
    a check of its own. `server:test` 70, up from 48.
  - Verified live against the real feed, which no fixture can prove: the pool
    came back **2888 players in six pages of 500** — matching the count Y7.2
    recorded — with 2888 distinct `player_key`s, so the paging neither skipped
    nor double-counted. A bye week on all 2888. `roster_positions` gave 21 slots
    including the four composites `W/T W/R W/R/T Q/W/R/T`, `stat_categories` 108
    stats with ids 0-107, and `game_weeks` 18 weeks with week 1 at 2026-09-09
    and week 18 at 2027-01-05. All four cache files landed, the pool at 888 KB.
  - **Found while building, and it would have been a real defect.** The reader
    first carried an `injured` boolean derived from `status`. Across the whole
    pool that is wrong for nearly half of it: nine codes appear and three are
    nothing to do with fitness — `NA` "Inactive: Coach's Decision or Not on
    Roster" on **1280 players, 44%**, plus `SUSP` and `CEL`. Y7.2 read 60 of 300
    and saw seven codes, because the top 300 are the owned ones; `NFI-R` and
    `SUSP` only appear deeper. The flag is gone rather than fixed: which codes
    make a player unstartable is a question about a league's rules, so the code
    is carried through and nothing is derived from it here. The vocabulary and
    the counts are recorded next to the reader.
  - A smaller one the checks caught: `status` used `??` while the flag tested
    for `''` as well, so one player could read as both flagged and unflagged.
    The three status fields now use `||`, since an empty string is the same
    absence as a missing key.
  - Corrected in `league.js`'s header, both now false and both about this
    task's own boundary: "every Yahoo endpoint worth reading authenticates on
    the browser's session cookie" — true of the league scope only — and "every
    reading of it happens in this file", which the extraction ended.
  - Manual validation: none required and none possible; nothing is visible yet,
    so `shots` says nothing about this work beyond confirming no regression.
  - Local gate: typecheck, `server:test` 70, `bridge:test` 7, `engine:test`,
    build and `shots` all clean with no console error. Lint 43 warnings, every
    one pre-existing in client files this task never opened — oxlint runs on
    `client/` and this work is entirely under `server/`.
  - Validation not run, and unchanged by this task: `engine:test` still skips
    "Following a real draft", "Reading a real league" and one more for want of
    `client/fixtures.local.json`. They are the only checks over
    `server/src/platforms/`, so they say nothing about this module either way.
  - Deliberately not built: no endpoint and no client code. Nothing calls this
    module yet, which is Y8.2's job. Nothing was wired up to make it look used.
  - Dependencies or blockers: none.

- [x] Y8.2: Join a league snapshot to the pool, keeping every eligibility.
  - Scope: new `server/src/platforms/yahoo/inSeason.js`, pure and reaching no
    network. `slotAcceptance` reads what each published slot takes,
    `resolveSlots` puts that against the league's own slot list, and
    `joinLeague` joins the snapshot's roster twice — exactly to Yahoo's own pool
    and, through `names.js`, to the cross-source board.
  - **The task's premise was wrong and was corrected before building on it.**
    It read as one join through `names.js`. All three Yahoo surfaces write a
    player as `470.p.<id>` — the draft room, the league scope and the game scope
    alike — so the Yahoo half needs no matching at all, and asking a fuzzy rule
    to do an identifier's work could only lose. Raised with the user, who chose
    both joins: the exact one for what Y8.3 shows, and the `names.js` one so
    Phase 9 inherits it rather than writing it. `DECISIONS.md` carries it.
  - Sharpened rather than corrected, and it is what makes the acceptance
    criterion reachable: `/game/nfl/roster_positions` publishes the 21 slots and
    **carries no eligible-set field**. Re-fetched to check — `position`,
    `abbreviation`, `display_name`, `position_type`, nothing else. Four places
    said the set "can be read from a list rather than parsed", which is true of
    the outcome and silent on the mechanism, so a reader reaching for it would
    look for a field that is not there. What is actually true: a composite's
    display name is the singles' display names joined by a slash, so each part
    is looked up in the same list and the vocabulary explains itself. No letter
    table, and a composite Yahoo adds later resolves unedited. All four now say
    which, and point at `slotAcceptance`.
  - Acceptance criteria: both met. A player who matches nothing keeps his place
    with `pool: null` or `board: null` and is *named* in `unmatched`, not
    counted — the two joins are nested rather than spread precisely so that
    "healthy" and "never found" cannot both read as `status: null`. And a flex
    resolves from the vocabulary: `W/R/T` to `WR+RB+TE` and `Q/W/R/T` to
    `QB+WR+RB+TE`.
  - Found while building, and it would have been a silent defect: bench and IR
    sit in the same 21 as the real positions, so a bench slot came out accepting
    a position called `BN`. Yahoo separates them itself — a position carries a
    `position_type` and `BN` and `IR` do not — so that is read rather than
    special-cased. Bench takes anybody, which is a different answer from an
    empty eligible set and now reads as one.
  - Automated validation: 20 checks in `npm run server:test` under
    `inSeason.test.js`, on synthetic fixtures copying the shapes and none of the
    people, except where a real disagreement is the thing under test. All three
    the task asked for are there: the suffix mismatch, a defence joining on team
    abbreviation with a different name each side, and a player eligible at two
    positions. `server:test` 90, up from 70.
  - **The suite bites, and was checked by breaking four rules on purpose.**
    Joining on the bare player id reddens the season guard and one more, and
    nothing else; trying only the first eligibility reddens the dual-position
    check alone; dropping the `position_type` test reddens the two bench checks;
    and a letter table in place of the vocabulary reddens the `X/Y` check and
    the no-display-name one. Each break hit exactly its intended checks.
  - Manual validation: **measured against the real feeds at full scale, which is
    more than the task asked for on the board half and less on the league
    half.** The whole real Yahoo pool — 2888 players, 1195 of them eligible at a
    position the board covers — put through the join against a real 12-team
    half-PPR board of 626 rows:
    - pool join **1195 of 1195**, exact, as it must be;
    - board join **100% of every player owned in a tenth of leagues or more**
      (221 of 221), 96.5% from one to ten percent, 33% below one percent, and
      **not one miss at five percent ownership or above**;
    - **all 32 defences** joined on their team abbreviation;
    - the `W/R/T` slot accepted 967 players, the 8 dual-eligible among them;
    - and the retry rule earned itself on real data: Riley Nowakowski is
      `RB,TE` to Yahoo and a **TE** on the board, so a first-only join misses
      him.
    The 33% below one percent ownership is right rather than a fault: the board
    holds only players Fantasy Football Calculator or Sleeper actually price, and
    859 of the pool are rated by neither.
  - **Not done, and it needs Y8.3 rather than more work here:** comparing a
    real league's own roster player by player against Yahoo. That needs the
    bookmarklet run in a signed-in browser and a screen to read it on, and there
    is no such screen yet. What can be said without one is that the pool join is
    exact by construction and a league can only roster players from Yahoo's own
    pool, so a real roster joins fully unless the pool fetch was partial — which
    is Y8.4's case, not this one.
  - Recorded as a limit rather than fixed: the board covers six positions and
    Yahoo's pool covers 21, so an `OFF` whole-offence entry or any individual
    defensive player has no board row by construction. Every board miss above
    five percent ownership is one of those. An IDP league will show its
    defensive starters unmatched; their slots still resolve and their eligibility
    still carries. Saying so on screen is Y8.4's.
  - Local gate: typecheck clean, `server:test` 90, `bridge:test` 7,
    `engine:test` green, build clean, `shots` clean with no console errors. Lint
    43 warnings, unchanged and every one pre-existing in client files this task
    never opened. `engine:test` was run against a **second service on 5179**
    started from this code rather than restarting 5178, which had been up 46
    minutes and could have been mirroring a draft; nothing here is reachable
    through an endpoint, so the two services answer identically anyway.
  - `engine:test` still skips "Sleeper leagues", "Following a real draft" and
    "Reading a real league" for want of `client/fixtures.local.json`, unchanged
    by this task and unaffected either way — nothing calls this module yet.
  - Deliberately not built: no endpoint, no client code, no scoring and no
    projection, on Y8.1's precedent. Nothing was wired up to make it look used.
  - Dependencies: Y8.1.

**Y8.3 was split in two while starting it, and the outcome is unchanged.** As
written it needed the reader, the snapshot shape, the join, an endpoint, a new
screen and `shots` — more than one reviewable pass, which this file's own rule
makes two tasks rather than one. Y8.3a is everything up to the service handing
back a joined league; Y8.3b is the screen that shows it. The acceptance criteria
are divided between them and none was dropped.

- [x] Y8.3a: Read every roster, and serve the league joined.
  - Scope: the reader fetches every team's roster rather than only yours;
    `readSnapshot` carries `rosters` instead of one `roster`; `joinLeague` joins
    all of them and marks which is the user's own; new `GET
    /api/:platform/league/:id/season` hands back the joined league with the age
    of each feed behind it.
  - Why every roster, since the old reader deliberately read one: a weekly
    decision is about the whole league — what a trade costs the other side, who
    is startable on somebody else's bench, which teams need what. Y8.3's
    acceptance asks for every roster and Phase 11 cannot exist without them.
  - Acceptance criteria met here, out of Y8.3's four: the own team is the one
    the `guid` matched and never a position in a list, each feed reports its own
    age, and a league nobody has read answers "not yet" rather than refusing.
    The fourth — every roster agreeing with Yahoo — needs a real league in a
    browser and is Y8.3b's, where there is a screen to compare on.
  - **A stale bookmarklet is the real risk here, and it is now handled rather
    than noted.** A bookmarklet carries its whole source in the address it was
    dragged from, so it cannot ever update itself: a stale reader is likelier
    than a stale userscript, not less. An old copy posts the singular `roster`,
    which is read, turned into a one-element list, and reported as
    `readerBehind` — because one roster in an eight-team league otherwise looks
    exactly like Yahoo having failed. The shape it posted is the signal, and it
    is a better one than a build hash: it is the capability itself rather than a
    proxy for it. Noted where the code is: if the reader ever goes stale without
    changing shape, it needs a hash like the bridge's.
  - Built to fail per feed rather than together. The league is already in hand —
    it came from the browser, not a feed — so a pool that will not come costs
    the injuries and ownership percentages and nothing else. Each of the four
    reports its own `fetchedAt`, `stale` and `error`.
  - Automated validation: 5 new checks in `server:test`, taking it to 95, and
    **14 in `engine:test`** under "Reading a Yahoo league in season" — the
    endpoint-visible half, where the real pool, the real slot vocabulary and the
    real board meet a posted snapshot. The self-test's snapshot is synthetic
    Yahoo envelope with real names taken off the live board, so the cross-source
    join has a real row to find; that is the point of checking it there rather
    than on a fixture.
  - **The suite bites, checked by breaking both new rules.** Deriving the own
    team from anything but the guid reddens exactly that check; refusing the old
    reader's singular roster reddens exactly the stale-reader check. One each,
    nothing else.
  - Manual validation: **the endpoint driven by hand against the real feeds**,
    since there is no screen yet and an endpoint nobody can see is worth looking
    at once. Two real players posted under their real Yahoo keys plus one
    invented: pool join 2 of 2 with ownership, bye week and status coming
    through, board join 2 of 2, and the invented player visible on both rosters
    with `pool: null`, `board: null` and his name in `unmatched` — which is the
    acceptance criterion demonstrated rather than asserted. `W/R/T` resolved to
    `WR+RB+TE` off the vocabulary the service fetched for itself, no unresolved
    slot, the own roster marked on the second team, and four feeds each dated
    separately.
  - Removed what this orphaned: the reader's `ownTeamId`, which existed only to
    choose which single roster to fetch, and the team id in its URL match. Which
    team is yours was already the service's answer from the guid.
  - Local gate: typecheck clean, `server:test` 95, `bridge:test` 7,
    `engine:test` green, build clean, `shots` clean with no console errors. Lint
    43 warnings, unchanged. `engine:test` ran against a second service on 5179
    rather than restarting 5178.
  - Deliberately not built: the screen. `shots` therefore says nothing about
    this work beyond confirming no regression, exactly as Y8.1 and Y8.2.
  - Dependencies: Y8.2.

- [x] Y8.3b: The in-season screen.
  - Scope: new `client/src/components/SeasonScreen.tsx` and a fourth screen —
    `season`, alongside `setup`, `draft` and `results` — reached from a masthead
    button offered only on the setup screen and only for Yahoo. Shows the
    league, the own team, every roster, the roster slots, the scoring rules and
    the age of each feed. Read only. No projections and no advice.
  - Decided with the user rather than assumed: a fourth screen and not a third
    mode. The mode badge distinguishes how a *draft* runs, mock against
    assistant, which an in-season view is not, so the draft flow is untouched
    and `SPEC.md`'s two-mode framing stands. The button is kept off the draft
    screen deliberately — a draft under way is when a navigation button is a
    hazard rather than a convenience.
  - The design rule the whole screen is built on: **every absence says which
    absence it is.** A player the pool never matched reads "not in the pool"
    rather than showing a blank ownership column, a feed that failed says
    "failed" rather than the age of its last good copy, and a league nobody has
    read is offered the bookmarklet rather than rendered as a league with no
    teams in it.
  - Acceptance criteria met: a missing snapshot reads as "not read yet" with
    the install link, and a reader reported as behind says so with the fix. The
    fourth — every roster and setting agreeing with Yahoo — needs the owner's
    own league in a signed-in browser and is **outstanding**, below.
  - Built while doing it, since the route had nowhere to say it: the season
    response carries `readerUrl`, from `serviceOrigin(PORT)` in the route rather
    than a literal in the client, on the same reasoning as the bridge's
    `installUrl` — the client knows the service only as a proxied `/api` and
    cannot name the port it is really on, and `PORT` is a documented setting. A
    dead install link offered at the moment the user has just been told to click
    it is this repository's own recurring failure.
  - Automated validation: `shots` extended with a `yahoo-season` scenario
    photographing both states — `season-unread.png`, `season-full.png` and
    `season-roster.png` — while keeping both draft modes and every existing
    shot. It posts a snapshot the way the bookmarklet does, then presses Read
    again, which is the real user journey rather than a reload. Two checks
    inside it beyond the pictures: the post asserts the service read all eight
    rosters, and exactly one roster must carry the own-team mark. Typecheck,
    `server:test` 95, `bridge:test` 7, `engine:test` green, build clean, `shots`
    clean with no console errors. Lint unchanged at 43.
  - **Three faults found by running it, all fixed.** `addInitScript` re-runs on
    every navigation, so the first scenario's `page.reload()` put the seeded
    league id back and silently undid the one it had just set — the screen then
    correctly said "nothing read yet" about a league nothing had been posted
    for, which looked like the feature being broken. The scenario now uses one
    league and no reload. An unconsumed response body tripped Node's own HTTP
    parser, `assert(!this.paused)` out of undici on socket close, which looks
    like nothing to do with this code; the reply is now read, and read for its
    contents rather than only to drain it. And `.banner` is a flex row, so every
    child gets a gap: the inline install link came out spaced away from the
    comma after it until the sentence became one child, which is the shape the
    bridge banners already used.
  - Manual validation: **the pool-matched render path photographed by hand,
    because `shots` cannot reach it.** The harness talks to the app and no
    endpoint hands out Yahoo's own player ids, so its fixture invents them and
    every row honestly reads "not in the pool" — which is correct and is a poor
    illustration. Driven separately against the real pool with real player keys:
    9 of 9 in the pool, 9 of 9 on the board, ownership at 100% on every row and
    Yahoo's own codes spelt out, "Questionable" against three of them. The
    stale-reader banner was photographed the same way, since forcing it needs a
    snapshot posted in the old shape. Both runs clean of console errors.
  - Also confirmed in the browser: the composite flex reads
    `W/R/T (WR, RB or TE)` off the vocabulary the service fetched, the four feed
    ages are separate with the league dated "read in your browser", bench rows
    dim rather than vanish, and the own-team mark lands on the second roster
    because the guid says so rather than the position in the list.
  - **Now done, by the owner, and it is the criterion this task existed to
    meet.** Read through the bookmarklet against their real league on
    2026-09-08: **all rosters match Yahoo**, and the "yours" mark is on their
    own team. That is the first confirmation the multi-roster read works at all
    — the reader only ever fetched one roster before Y8.3a, so seven of the
    eight had never been read by anything. Everything before this was synthetic
    or public data.
  - Still not confirmed rule by rule: the scoring was called "ok" rather than
    checked against Yahoo line by line. The one number queried in it turned out
    to be correct and unreadable, which is Y8.6.
  - Driven throughout against an isolated pair, a service on 5179 and a client
    on 5180 pointed at it, rather than restarting 5178, which had been up for
    hours and could have been mirroring a draft.
  - Not built, and it belongs to Y8.4: `shots` coverage of the failure states.
    The stale-reader banner and a failed feed are photographed by hand here and
    are Y8.4's to make routine, along with a league switch and a restart.
  - Dependencies: Y8.3a.

- [x] Y8.4: Make the failure states of the view honest.
  - Scope: three real conflations found by reading the code against the exit
    criteria, not a screenshot pass. Each had a wrong answer that looked right.
  - **A feed that failed read as a feed that answered with nothing.**
    `readSeason` passed `?? []` for a failure, so an empty pool joined to nobody
    and every rostered player came back reported as one Yahoo has never heard
    of — which reads as a finding about the league rather than as a fetch that
    failed. `joinLeague` now takes `null` for "did not answer" and reports
    `matched` and `unmatched` as **null rather than zero or a list of
    everybody**: null is neither a number nor a list, so a caller that prints it
    without checking prints something visibly wrong instead of quietly wrong.
    `joined` says which joins ran.
  - The same fault on the slot list, where it blamed the league: an absent
    vocabulary marked every starting slot `unresolved`, so an ordinary league
    read as one this app cannot understand. `unresolved` is now null where
    nothing is known, `unresolvedSlots` is null rather than a list of every
    slot, and the screen says the feed failed instead.
  - **A league switch left the last league's rosters on screen.** The reading
    and the league it is for are now one piece of state, so they cannot
    disagree; a switch drops what is held before the fetch rather than after,
    which also fixes the worse case — a *failed* fetch left the previous
    league's rosters up for good, since a failure sets the error and does not
    clear the reading. A ticket counter drops a slow answer that a faster switch
    has overtaken, and the answer's own league id is checked against the one
    asked for. That last one should be unreachable, which is the reason to check
    it rather than not to.
  - **A forgotten snapshot read as one never taken.** The service cannot tell
    the two apart — snapshots are memory only, and memory is memory — but the
    app can, because it was holding the reading. So a league that was read and
    now is not says "The reading is gone", names a restart as the cause and says
    running the bookmarklet again is the whole fix, rather than "nothing has
    been read yet" about a league read five minutes ago.
  - Already met by Y8.3b and left alone: a stale feed is displayed with its age.
  - Automated validation: **12 new checks in `server:test`, taking it to 107** —
    seven on the absent-feed distinction, each paired with its `[]` contrast so
    the two answers are checked against each other rather than in isolation, and
    five on snapshot storage, which had none: the read-back, the wrong-league
    refusal, the bound at eight, and that reading a league again moves it out of
    the way of the bound so the one you are looking at cannot be evicted from
    under you. **Five new in `engine:test`**, taking that block to 19: what a
    caller sees for a league the service has forgotten, which is the
    endpoint-visible form of the restart case, and that a cross-filed snapshot
    is refused and leaves the target league still unread.
  - **The suite bites, checked by breaking both new rules.** Treating an absent
    pool or board as an empty one reddens exactly the four absent-feed checks;
    treating an absent vocabulary as an empty one reddens exactly two. Nothing
    else moved either time.
  - `shots` gains a `yahoo-season-failures` scenario photographing three states:
    `season-reader-behind.png`, `season-forgotten.png` and
    `season-switched.png`. The switch is driven through the real controls, and
    it asserts the negatives that matter — the previous league's name must be
    absent, and a league never read must not be called one the service forgot.
  - **Two things that scenario cost a run each to learn, both now written down
    where they bit.** A Yahoo league becomes the active one only when its
    settings import, and importing needs a room the bridge has posted; and the
    platform has to be Yahoo first, because a Sleeper league id is eighteen
    digits and a nine-digit one is refused. Neither failure looks like a
    failure: the active league simply does not move, which reads as the switch
    working and the screen being wrong.
  - Manual validation: **the failed-feed state photographed for real**, which
    `shots` cannot force. Produced by pointing the game-scope base URL at a dead
    address and at cache keys with no file behind them, on a service of its own:
    the pool and slot list both read `failed` with `fetch failed` under them in
    red, the banner said Yahoo's slot list could not be read and that the league
    and its rosters are unaffected, the summary said how many players the pool
    holds is *unknown* rather than zero, the roster line said "pool not read ·
    5/5 on the board", and **the status column was blank rather than "not in the
    pool"** — which is the whole point. The board still joined 5 of 5, so one
    feed failing did not take the others.
  - Fixed by looking at that photograph: with the slot list absent, every slot
    printed "(this app cannot say what it takes)", which is noise after the
    banner and, against `QB`, reads as this app not knowing what a quarterback
    slot takes. The clause is now kept for the case it is about — a slot the
    list did arrive and could not explain.
  - **Not done, and it needs the owner:** switching between two *real* leagues,
    and restarting the service under a live view. The second is deliberately not
    attempted here — 5178 had been up for hours and restarting it wipes any
    Yahoo draft room it is holding, which is a recorded rule. The eviction path
    exercises the same code the restart does, from the same side, so what is
    untested is the restart itself rather than the answer it produces.
  - Local gate: typecheck clean, `server:test` 107, `bridge:test` 7,
    `engine:test` green, build clean, `shots` clean with no console errors, lint
    unchanged at 43. Driven against an isolated service and client on 5179 and
    5180, and the broken-feed run on 5181 and 5182, never by restarting 5178.
  - Dependencies: Y8.3b.

- [x] Y8.5: Let the in-season screen reach a league at all.
  - **Reported from the app, and it made the whole of Phase 8 unusable.** The
    repository owner restarted the service to test and could find no way to
    select a league. The screen was reachable in `shots` and by hand and not in
    the app, which is the gap between driving a fixture and driving the thing.
  - The fault: the screen borrowed `activeLeagueId`, and the masthead button
    required it. That is a **draft** setting — it is set only by `applyImport`,
    which runs only when `pullLeague` succeeds, and Yahoo's `importLeague`
    refuses unless the bridge has posted a **draft room**. In season there is no
    room. So the one case the screen exists for was the one case it could not
    reach, and a Sleeper-shaped assumption had been carried into an in-season
    feature without being noticed.
  - **I had already been told this and read it as something else.** Writing the
    `shots` scenario, the switch case would not work until a room was posted,
    and I recorded that as a harness quirk — "a Yahoo league becomes active only
    when its settings import, and importing needs a posted room". It was the
    defect describing itself.
  - Scope, and the owner chose both halves: a league ID that can be typed, and
    a league that can be clicked. `seasonLeagueId` is now its own saved setting
    rather than the draft's; new `listSnapshots` and `GET
    /api/:platform/leagues` say which leagues the service is holding, so after
    one read the league is a button rather than a number; the masthead button is
    offered unconditionally on the setup screen, since anything narrower is
    what hid the feature; and the read always asks Yahoo, because the platform
    a *draft* is configured for has nothing to do with which league is being
    looked at.
  - What the list deliberately does not carry: rosters, scoring, teams. Enough
    to name a league on a button and no more — a menu that carried the contents
    would answer every held league in full to anyone who asked for the menu.
  - Automated validation: five checks in `server:test` under `league.test.js`
    (empty rather than a refusal, the fields it carries, the fields it does not,
    newest first, bounded with the store), taking it to 112. Five in
    `engine:test`, taking that block to 24, including that a Sleeper caller has
    no list either. `shots` reseeded to drive the screen from `seasonLeagueId`
    with **no saved league and no active league at all**, which is the state
    that was broken, plus a check that a league once read is offered in the
    picker.
  - **The suite bites:** reversing the newest-first order reddens exactly two
    checks and nothing else.
  - Simplified by the fix, which is a good sign: the `shots` switch case no
    longer needs a posted draft room or the Yahoo platform chosen first. It
    types a number into the screen's own field. Both of those workarounds
    existed only because of the defect.
  - Also fixed while running it: the league name now appears twice, in the
    header and on a picker chip, so `getByText` matched both. A `shownLeague`
    helper targets the header, which matters beyond tidiness — waiting on the
    chip would pass while the screen showed nothing, which is the exact failure
    the switch check exists to catch.
  - Manual validation: **done, by the owner, against their real league.** The
    chain worked end to end after installing the current bookmarklet: reader to
    service to screen. Verified by me in a browser first, from the broken state
    exactly — no saved league, no active league — that the button appears, the
    picker shows, typing an ID gives the reader instructions, and the ID is
    written to storage so it is typed once.
  - **My own mistake, and it cost the owner a step mid-test:** I ran
    `engine:test` against the service they were using. Its eviction check posts
    nine snapshots on purpose to prove the bound at eight, so it filled all
    eight slots with `Spare League` fixtures and threw away the league they had
    just read. Restarting cleared the fixtures. Now recorded in `AGENTS.md` and
    in the self-test's own header: point it at a second service, which was
    already the habit because 5178 may be mirroring a live draft.
  - Local gate: typecheck clean, `server:test` 112, `bridge:test` 7,
    `engine:test` green, build clean, `shots` clean with no console errors.
    Lint 44, **up one**: `useState(saved.seasonLeagueId)` carries the same
    `react(refs)` advisory as the twenty-one other saved settings in `App.tsx`,
    and doing it differently for one of twenty-two would be the worse choice.
  - Dependencies: Y8.4.

- [x] Y8.6: Two rendering faults the owner found in their own league.
  - Both reported from the real league on screen, and both were the screen
    rather than the reading: the parsed snapshot was correct in each case.
  - **"Passing yards says 9.94."** It says `0.04`, and the reading was right
    about the screen being wrong. Two causes compounded. `.mono` is IBM Plex
    Mono, which sets a **dotted zero**; at 12px bold the dot fills in and `0`
    reads as `9`, which is harmless for the whole numbers the rest of the app
    puts in mono and not for a two-decimal scoring rate. And thirty-five
    value-and-name pairs wrapped inline were separated by an 18px gap, less than
    the eye needs, so which number belonged to which rule was a guess. Fixed
    both: each rule is its own cell in a grid, so the pairing is structural
    rather than spatial, and the value is set in the body face, whose zero
    cannot be read as anything else.
  - **The started kicker and defence sat below the bench.** Yahoo returns a
    roster in its own order, and for this league that order is `QB RB RB WR WR
    TE W/R/T` then eight bench players and *then* the started `K` and `DEF`.
    So the starting lineup was not contiguous and the two slots hardest to guess
    at were furthest from the top. New `inSlotOrder` sorts by the league's own
    slot list rather than a table of positions written into the client, so a
    league that starts things in another order reads in that order; `sort` is
    stable, so players within a slot keep Yahoo's order, and a slot the list
    does not mention sorts last rather than throwing the roster away.
  - Diagnosed from the owner's own held snapshot rather than guessed at: the
    service was still holding league `876392`, so the parsed scoring was read
    back — 35 valued rules, `Passing Yards` at `0.04`, every value right — and
    the parsed slots too, `K` and `DEF` both `STARTING` and both ahead of `BN`.
    That is what established the fault was rendering. The glyph was then
    confirmed by photographing the value at four times scale.
  - Automated validation: **a `shots` check that reproduces the reported bug.**
    The fixture used to bench its last three players, so the bench came last and
    a screen that happened to look right would have passed. It now benches two
    in the *middle*, mirroring Yahoo, and the check asserts no started player
    appears below the bench. **Confirmed by rendering Yahoo's order instead:**
    the check fails with `RB RB WR WR RB WR BN BN RB`, naming the offender.
  - Manual validation: **done against the real league**, before and after. The
    scoring panel now reads as four columns of right-aligned values against
    their rules, `0.04 Passing Yards` unmistakable, and the roster reads
    `QB RB RB WR WR TE W/R/T K DEF` then the bench.
  - Not done: grouping the scoring by the `group` Yahoo supplies — `passing`,
    `fgs`, `pts_allow` and ten more. It would cluster 38 rules into something
    even easier to scan, and it needs a readable label per slug, which is a
    vocabulary to invent rather than read. Left because the complaint was a
    misread number and that is fixed; worth doing if the panel is still a wall.
  - Local gate: typecheck clean, `server:test` 112, `bridge:test` 7,
    `engine:test` green, build clean, `shots` clean with no console errors, lint
    unchanged at 44. Driven against an isolated service and client on 5179 and
    5180; the real-league checks read the snapshot 5178 was already holding and
    posted nothing to it.
  - Dependencies: Y8.5.

- [x] Y8.7: Let the reader keep the league current on its own.
  - **Asked for by the owner on 2026-09-09, from using the screen Y9.3 built.**
    The click was in the way twice over: a service restart drops the snapshot,
    so the advice screen answered "nothing read yet" until the bookmarklet was
    clicked again, and a lineup changed in Yahoo did not reach the app at all
    until it was.
  - Not a new decision so much as a deferred one coming due. The 2026-09-08
    entry did not reject a userscript; it named the condition -- "a screen that
    consumes the snapshot" -- and Y9.3 is that screen. Recorded as
    `DECISIONS.md`, 2026-09-09, which narrows the earlier entry rather than
    superseding it: the bookmarklet is kept.
  - Scope, and the owner set the shape: one file served two ways. The
    bookmarklet is unchanged. The userscript reads on page load and then every
    N minutes, N in `localStorage` on Yahoo's origin, default 10, zero meaning
    read on load only. The panel it draws carries the control and stays visible
    while a beat runs. The service stamps which mode a served copy is, because
    nothing inside a script can tell how it was invoked.
  - The check is `npm run reader:test`, five cases against the real file: it
    reads on load without being clicked, it comes back on the beat, zero never
    comes back, and a bookmarklet copy starts no beat **whatever the setting
    says** -- that last one set to the short beat, so a copy that read the
    setting and ignored its own mode fails rather than passes slowly. The fifth
    reads the panel.
  - **It found a defect while being written, which is the reason it exists.**
    `minutes()` read an unset value through `Number(null)`, which is `0`, so
    every fresh install would have polled never while the panel lit `never` --
    the exact failure the file's own comment warned about, arrived at from the
    other side. Nothing but asking "what is the default" would have shown it.
  - A second one the harness forced: `__READER_MODE__` was written in the file's
    own comment as well as in the constant, and `String.replace` takes the first
    occurrence, so the service stamped the comment and every copy ran as a
    bookmarklet. The existing build mark carries a note saying it appears
    exactly once for this reason; the new mark now carries the same note.
  - Deliberately not built, and it is the one thing that leaves the userscript
    weaker than the bridge: **the reader does not report its build back.** The
    bridge stamps a build and the running copy reports it, so the masthead can
    say when an install is behind. The reader stamps it and nothing reads it
    back, which means a stale reader polls perfectly while posting a shape the
    service has moved on from -- 2026-09-07 with a slower fuse. Next piece of
    work, named in `DECISIONS.md` under what this costs, and the reason the
    bookmarklet is kept in the meantime.
  - Also rejected rather than overlooked: gating the beat on tab visibility,
    which would break the case the feature is for, since the league page is in
    the background tab nearly always. And persisting the snapshot to disk, which
    would have solved the restart complaint more cheaply and is refused by
    `SPEC.md` rather than by preference.
  - Local gate: `reader:test` 5, `bridge:test` 7, `server:test` 185, typecheck
    clean, `engine:test` green, build clean, `shots` clean with no console
    errors, lint unchanged. Both served copies were checked for real against a
    spare service on 5179: the userscript stamps `MODE = 'userscript'`, the
    bookmarklet stamps `'bookmarklet'`, both carry the same build and both had
    their service origin rewritten to the running port. The install page was
    photographed.
  - Manual validation outstanding, and it is the half no check reaches: install
    it into a real userscript manager, on a real league page, and confirm the
    panel appears and the beat runs. `reader:test` cannot see the manager, and
    the "Allow user scripts" control that cost three mock drafts is exactly what
    it cannot see.
  - Dependencies: Y8.5, and Y9.3 for the condition that reopened the decision.

### Phase 9 tasks, in order

Split from `PLAN.md` and from Y9.0's measurement, which released the hold Phase
9 was carrying. The split was written on 2026-09-08 and stopped at, on the
owner's instruction; **implementation resumed on 2026-09-09 and Y9.0 to Y9.4
are built**, with Y9.3a and Y9.3b two rounds of one defect the owner reported
from a real board. Each is one reviewable outcome.

The one thing that did not go as split: Y9.4's panel is the league reader's own
rather than a second install, because Y8.7 made the reader a userscript on the
same day and put something on that page already. See `DECISIONS.md`.

Two surfaces, in the order the 2026-09-08 decision set: the app's screen first,
a panel over Yahoo's league pages second. The first two tasks are pure
calculation and need neither a browser nor a real league.

- [x] Y9.0: Measure how far apart the two projection sources run.
  - Scope: the one thing `PLAN.md` held as "unmeasured, and Phase 9's to
    measure", because how Sleeper and ESPN are combined could not be decided
    without it. Read-only, no account, nothing built.
  - Why it had to come first: the 2026-09-08 decision to show both sources with
    their spread visible was taken on an argument -- two desks disagreeing is
    information -- with no idea whether the disagreement was half a point or
    ten. A range is the right presentation only if there is a range.
  - Method, and it is the part worth keeping: **one ruleset over both sources'
    raw components**, not Sleeper's `pts_ppr` against ESPN's `appliedTotal`.
    Comparing published totals measures the two presets disagreeing as well as
    the two desks, and they do disagree, so the desks could not be seen through
    it. Each source's components were then scored under that source's own
    preset and checked against the points it publishes -- 98.0% and 99.8% of
    players within 0.05 -- which is what makes the basis established rather
    than asserted.
  - Answered: the two run a median **1.22 points apart** on the 208 players
    either would start in week 1, about 10% of the projection, with a mean
    signed difference of +0.26, so there is no level bias to correct. Flat
    across positions and stable across weeks 1, 4, 8 and 14 at 1.21-1.22.
  - The number that actually decides the question, because start/sit advice
    consumes ordering rather than points: over pairs of players at one
    position, the two **reverse the ordering in 8.0% of pairs one desk
    separates by a point, 4.0% at two points and 1.7% at three.** So the
    decision to show both stands and now has the threshold it lacked -- they
    disagree in a way that changes advice below about three points of
    separation and rarely above it. A mean is ruled out by the measurement
    rather than by preference: it would have put Tua Tagovailoa at 13.0 where
    the desks said 15.29 and 10.75, a start against a sit.
  - Two traps found while measuring, both of which would otherwise have
    shipped. **Sleeper refreshes the current week and leaves later weeks
    stale** -- week 1 modified 2026-09-09, weeks 4, 8 and 14 all on
    2026-08-29 -- and inside that older vintage the published points contradict
    the record's own components, quarterbacks by about 2.2 points, where the
    current week agrees to 0.02. And **ESPN returns last season's weekly
    projection beside this one under the same week number**, on 896 of 1036
    players, separated only by `seasonId`: Jahmyr Gibbs answers 18.42 and 22.50
    for the same week 1 query.
  - Established for free, and it de-risks Y9.1: **components times modifiers
    reproduces a real scoring system**, on both feeds, which was the
    load-bearing operation Phase 9 was going to have to take on trust. ESPN's
    stat-id vocabulary came off its own `scoringItems` rather than a guess.
  - Acceptance criteria: a reproducible figure with its join coverage stated,
    so the spread is not measured on a biased subset. Met -- 436 of 461
    Sleeper-projected players joined, and the 25 that did not are named as
    unmatched rather than dropped silently.
  - Automated validation: none, and none is appropriate -- nothing was built.
    The probe's own two mapping checks are what stand behind the numbers, and
    they bite: both preset differences were found by watching them fail.
  - Manual validation: none required. No surface.
  - Written up in `docs/in-season-data-sources.md`, which also lost a claim
    this measurement falsified: it had recorded that no comparison had been
    made. `PLAN.md`'s held row is struck through and the hold released there.
  - Not done, and listed in the document rather than implied: **which desk is
    better**, which needs actual results and the season starts 2026-09-09;
    kickers and defences, whose components this ruleset has no terms for;
    rest-of-season spread, since summing a stale Sleeper vintage against ESPN's
    period 0 would measure the vintages. All four readings were taken on one
    day, before any football.
  - The probe is `tools/inseason-spread.mjs`, which git ignores with the rest
    of `tools/`, so it appears in no diff.
  - Dependencies or blockers: none.

- [x] Y9.1: Score a projection under the league's own rules.
  - Scope: a weekly projection feed for both sources, and the scoring join that
    turns raw components into that league's points. Built as
    `server/src/sources/sleeperProjections.js`,
    `server/src/sources/espnProjections.js`,
    `server/src/sources/components.js` and
    `server/src/platforms/yahoo/scoring.js`. No endpoint and no screen: Y9.2
    and Y9.3 own those.
  - **The seam question is settled, by the owner rather than silently.** It goes
    service-side, as proposed. The argument that decided it was not the one in
    the proposal: Y9.4 needs the Yahoo-page panel to read one advice endpoint,
    and a client-side join would have needed the draft path's `putAdvice`
    pigeonhole, which leaves the panel blank whenever the app screen is closed.
    Recorded in `DECISIONS.md`, 2026-09-09.
  - Acceptance criteria, all met. Each source's own preset reproduces that
    source's published points to 0.05 -- checked on fixtures for a quarterback,
    a back, a receiver and a tight end on both desks, and once against the live
    feeds at 246/252 and 243/244. A rule the league scores that the source does
    not project is reported, never zeroed, and reported per source rather than
    per player. A player nobody projected is dropped. ESPN's prior-season row
    cannot be read as this season's. Sleeper's `pts_ppr` never appears in the
    output at all, which one check asserts by serialising a row and looking.
  - **The reproduction check was proved able to fail** before being trusted:
    swapping Yahoo's rushing-yards id to receiving yards put Josh Allen at
    18.45 against a published 21.11 and failed three checks.
  - What this cost, and it is a real reduction in Phase 9: **kickers and team
    defences get no projection from either desk, so a K or DEF slot cannot be
    advised on.** Their components exist in both feeds and could not be
    verified. Solving for Sleeper's kicker ruleset by least squares fitted all
    32 kickers to within 0.008 while returning a 30-39 yard field goal at -0.29
    points, and the control -- the same method on running backs, whose scoring
    is known -- recovered a lost fumble at -0.68 against its true -2. An
    underdetermined system fits whatever it is given. Eleven of Yahoo's 108
    categories are scored; the rest report as unsupported.
  - A defect found by looking at the live feed rather than by reasoning, and
    fixed here rather than left for Y9.3: ESPN files a return-touchdown
    projection against all 32 team defences, so the first reader put every
    defence on the board at about 0.14 points under a league scoring return
    touchdowns -- ranked against the other 31 and looking exactly like advice.
    `SCOREABLE_POSITIONS` is the rule that stops it: the test is not whether any
    component is present but whether the position's scoring can be represented.
    ESPN's projected count fell 462 to 430, which is the 32.
  - Also confirmed rather than re-derived, since Y9.1 said not to re-derive it:
    Y9.0's twelve ESPN stat ids, by a second method. The median ratio between
    ESPN's value and the Sleeper component naming the same quantity, over
    players both desks project -- passing yards 0.986, receiving yards 0.991,
    receptions 0.980. Correlation cannot do this, and that is worth keeping:
    inside a position group every stat correlates above 0.95 with every other,
    because they all scale with volume, so a correlation test matches a
    quarterback's interceptions to his completions.
  - Automated validation: 41 new checks in `npm run server:test`, taking it from
    112 to 153, across `scoring.test.js`, `sleeperProjections.test.js`,
    `espnProjections.test.js` and `components.test.js`. The `seasonId` filter is
    checked in both directions, because a reader that just took the newest row
    would pass a one-directional check.
  - Local gate: typecheck clean, `server:test` 153, `bridge:test` 7,
    `engine:test` green against an isolated service on 5179, build clean,
    `shots` clean with no console errors, lint unchanged at 44. Three
    `engine:test` suites skipped for want of `client/fixtures.local.json`, which
    is the open task above and not this change.
  - Manual validation: none required, and none possible -- nothing renders.
    Both fetch paths were exercised against the live feeds once, since every
    check is on a pure reader and a wrong URL or cache key would pass all of
    them.
  - One thing deliberately not built: a `scoreProjection` wrapper taking a feed
    row, which had no caller. Y9.2 should add it when it has one.
  - Dependencies or blockers: none.

- [x] Y9.2: The best legal lineup, and the swaps that reach it.
  - Scope: a pure calculation over a scored snapshot, built as
    `server/src/lineup.js`. Eligibility from each player's `eligible_positions`
    and the composite slots the 2026-09-08 join decision already resolves; the
    best legal lineup by projected points; the swaps from the current lineup to
    it and the projected difference; locked players fixed; byes, IR and missing
    projections handled as data rather than as zeros. No endpoint and no
    screen: Y9.3 owns those.
  - Acceptance criteria, all met. The greedy-flex trap is beaten and the wrong
    algorithm is written out in the test rather than described, so it can be
    run: best-first scores 30 where the optimum is 38. A locked player never
    moves, starting or benched, and is never named in a move either way. A
    player with no projection is never seated. Two desks that fill a seat
    differently report the disagreement carrying each desk's view of both
    players, and nothing picks a side.
  - **The algorithm earns its place, which took a second wrong algorithm to
    establish.** A player is worth the same points in every seat he can fill,
    so this is not the assignment problem: the seatable sets form a transversal
    matroid and greedy by points is optimal, provided "still fits" is answered
    by an augmenting path rather than by looking for a free seat. That is the
    whole difference between this and best-first.
  - Why `client/src/engine/roster.ts`'s `bestLineup` could not simply be reused,
    found by looking rather than assumed: **it is exact there and its comment is
    right.** In the draft engine a player has exactly one position, so each
    dedicated slot's candidates are a subset of the flex's, the slot family is
    laminar, and dedicated-first is optimal. Yahoo's `eligible_positions` breaks
    that -- it really lists players as `WR,TE` -- and the family stops being
    laminar. A check was added for exactly this: the dedicated-first greedy
    scores 44 where the optimum is 57. Without it nothing justified the harder
    algorithm over the one already in the repository. No defect in the draft
    path; its shortcut simply does not transfer.
  - Two bugs the checks caught rather than review. Preferring "any seat of the
    slot a player is in" instead of the seat he actually occupies made two backs
    in `RB` swap places: the total was right to the penny and the advice was two
    moves that change nothing, which is exactly the zero-point swap the criteria
    forbid. And each desk's lineup holds its own seat objects, so comparing
    seats across desks by identity matched nothing and reported every seat as
    disputed, including the agreed ones. Seats now carry an `id`.
  - Automated validation: 22 checks in `npm run server:test`, taking it from
    153 to 175, in `lineup.test.js`. The enumeration is a brute force written
    from the rules and sharing no code with the implementation, over six roster
    shapes including a dual-eligible player, a superflex, two flexes and more
    seats than players -- so the two agreeing is evidence rather than a
    tautology. **The suite bites:** removing the augmenting path leaves
    best-first and fails exactly two checks, the trap and the enumeration, and
    no others.
  - Not `engine:test` as this task first said, and the reason is Y9.1's own
    decision. That entry moved the seam service-side on 2026-09-09, after this
    task was written; there is no endpoint in this slice, and AGENTS.md routes
    what no caller can see to `server:test`. Y9.3 adds the endpoint and its
    checks go to `engine:test` with the rest. The substance is unchanged: the
    enumeration is the check either way.
  - Locks are an **input**, not something this slice can discover. Yahoo
    publishes no kickoff time at any scope and ESPN is the only source that has
    one, so `locked` is a Set of player keys or null, and null is carried out as
    `locksKnown: false` rather than read as "nothing is locked" -- the second is
    a claim, and it is the claim that produces advice to make moves the user can
    no longer make. Reading kickoff times is not built and is not Y9.2.
  - Deliberately not built, on Y9.1's own reasoning: the `scoreProjection`
    wrapper it deferred. `lineupAdvice` takes points as a Map per desk, so the
    wrapper still has no caller, and adding it now would be Y9.3's endpoint
    plumbing written before the endpoint that shapes it exists.
  - Local gate: typecheck clean, `server:test` 175, `bridge:test` 7,
    `engine:test` green against an isolated service on 5179, build clean,
    `shots` clean with no console errors, lint unchanged at 44 warnings. Three
    `engine:test` suites skipped for want of `client/fixtures.local.json`, which
    is the open task above and not this change.
  - Manual validation: none required and none possible -- nothing renders, and
    no endpoint reaches it. The surface is Y9.3.
  - Worth knowing: 5178 read STALE throughout, truthfully, because a new file
    under `server/src` changed after that process started. It was not restarted,
    since nothing imports `lineup.js` -- checked, not assumed -- so every route
    the client touches behaves identically, and a restart would have cost
    whatever that service was holding.
  - Dependencies or blockers: none.

- [x] Y9.3: The weekly advice screen.
  - Scope: the advice on the app's own in-season surface. Built as a `This week`
    section in `SeasonScreen.tsx`, `readLineup` in
    `server/src/platforms/yahoo/index.js`, `GET
    /api/:platform/league/:id/lineup`, `fetchLineup` in `client/src/api.ts` and
    the `LineupRead` types beside the season ones. The current lineup against
    the best legal one, the swaps, the projected difference, both desks with
    their spread shown rather than averaged, per-feed age, and every limit
    stated where it applies.
  - **A section on the existing screen rather than a fifth screen**, which
    `SeasonScreen.tsx` had already reserved: its own header says "Phase 9 owns
    the advice", and the advice is about the roster that screen already shows.
    The banners stay above it, because a stale reader or a slot list that never
    arrived both change what the advice is worth.
  - Acceptance criteria, both met and **demonstrated against the live desks
    rather than a fixture**. The beneficial move: Ja'Marr Chase in for Malik
    Washington, +12.72 Sleeper and +12.35 ESPN. The superficially attractive
    move correctly rejected: Josh Allen at 15.52 and 17.34, outprojecting the
    started receiver by about ten points, refused because the roster has no
    quarterback slot and nothing else he can fill. That rejection is why the
    endpoint returns the whole roster with both desks' numbers and a `fills`
    column -- a screen showing only the recommended starters cannot answer the
    question a user actually asks, which is why not the obvious one.
  - Also carried, each beside what it limits rather than in a footnote: a K or
    DEF slot as one no desk projects, a league rule no desk publishes reported
    instead of counted as zero, a player nobody projected named, a stale feed
    read as stale, and `locksKnown: false` said in words -- Yahoo publishes no
    kickoff time at any scope, so that is the ordinary case and the screen says
    to check each move is still allowed.
  - Sleeper's oldest record is shown beside its fetch age, and it earned its
    place immediately: a fresh fetch of week 3 carried records **11 days old**,
    which is exactly the stale vintage inside a fresh fetch Y9.0 measured. A
    fetch age alone would have read as current.
  - **Four defects the rendered screen caught that review had not.** The first
    is a Y9.2 bug: `lineupMoves` compared seats individually, so a receiver the
    matching seated in the other of two interchangeable `WR` seats came out as
    "bench CeeDee Lamb" and "start CeeDee Lamb" in the same table -- a correct
    total and advice that reads as a bug, in the one place that tells the user
    what to do. It now groups by slot, and two checks pin it. The second: the
    advice's roster table was in Yahoo's own order, which repeats the
    non-contiguous-lineup defect this screen had already fixed once for rosters;
    it now orders by the seats the league starts. The third: the desk blocks
    first reused `.season-roster`, which would have broken two existing `shots`
    checks that count `.season-roster-head .chip` and read the first
    `.season-roster`; they have their own classes and a note saying why. The
    fourth: Sleeper's `last_modified` is milliseconds, not seconds, and the
    first version aged it to the year 58629.
  - The `scoreProjection` wrapper Y9.1 deferred is added here, where it finally
    has a caller, together with `scoreRoster` -- the join from a Yahoo roster to
    a desk's week, which tries every eligible position because Yahoo lists
    players as `WR,TE` where a desk files them under one. **A player no desk
    projected is absent from the map rather than zero**, and that absence is
    load-bearing: `lineup.js` reads a missing key as unprojected and refuses to
    seat him.
  - Automated validation: 30 checks in `npm run engine:test` under `Advising a
    lineup`, and 8 more in `npm run server:test`, taking it from 175 to 183.
    The engine suite **re-derives the optimum from the service's own answer** by
    brute force, on live projections, for both desks -- so the claim checked is
    that the number is the maximum and not that it looks plausible. It also
    checks the trap is still a trap: the quarterback must actually outproject
    the started receiver, or the rejection would prove nothing.
  - **Both layers bite, and each with exactly one check.** Scoring an unmatched
    player zero instead of leaving him absent fails `a rostered player no desk
    projected is absent from the map, never zero` in `server:test` and `a kicker
    gets no projection from either desk, rather than a small one` in
    `engine:test`, and nothing else in either.
  - `npm run shots` extended: `season-advice.png`, plus assertions that the K
    and DEF limit, the unsupported rule and the lock warning are all on the
    page. The fixture now prices its `Targets` category on purpose -- left
    unpriced it is a rule the league counts at nothing, which cannot make a
    total wrong and is correctly not reported, so it demonstrated nothing.
    What `shots` cannot check is whether the advice is *right*, only that it
    renders and states its limits.
  - Local gate: typecheck clean, `server:test` 183, `bridge:test` 7,
    `engine:test` green against an isolated service on 5179, build clean,
    `shots` clean with no console errors, lint unchanged at 44 warnings. Three
    `engine:test` suites still skip for want of `client/fixtures.local.json`,
    which is the open task above.
  - **Manual validation is NOT done, and it is the acceptance criterion this
    task cannot close by itself.** Everything above ran against synthetic
    snapshots carrying real players and live projections; none of it compared a
    total against Yahoo's own page for the owner's real league, which needs
    their signed-in browser. Y9.1 kept `terms` per player precisely so a total
    can be taken apart and the disagreeing line found. Until that is done, the
    scoring join is proven against each desk's published points and not against
    Yahoo's arithmetic for a real roster. A normal week and a constrained
    lineup, submitting nothing, is what remains.
  - Worth knowing for the next run: the isolated service was restarted twice
    mid-task, and the first `shots` run photographed advice from code one fix
    behind -- the Lamb defect was still on screen after being fixed. The
    staleness `serve -- status` warns about applies to a service an agent
    started itself. 5178 was left alone throughout, since nothing imports the
    new modules into any route it serves.
  - Dependencies or blockers: none. Y9.4 can start; it reads this endpoint.

- [x] Y9.3a: A player both desks start is agreement, not two disagreements.
  - **Partial, and superseded by Y9.3b the same day.** It settled two seats of
    one slot and left the same player double-named across two *different* slots,
    because the unit was still narrower than the thing the desks disagree about.
    Kept rather than rewritten: the report and the evidence below are real, and
    the second report is what identified the unit.
  - **Reported from a real board on 2026-09-09, with a screenshot.** A lineup
    with two `RB` seats showed Christian McCaffrey started by Sleeper in one and
    by ESPN in the other, and the disputed table named him on both sides while
    reporting nothing as agreed. One disagreement about the other back, shown as
    two about him -- and it hid the one seat that is actually in dispute.
  - The fault is the one Y9.3 already found and fixed in `lineupMoves`, one
    level up and left there: `lineupAdvice` compared the desks by `seat.id`.
    Each desk sorts its candidates by its own points, so the two hand out the
    seats of a slot in different orders, and the shuffle read as a difference of
    opinion. Y9.2's own note on the seat `id` says what it was for -- comparing
    two desks seat by seat -- so the field went with the comparison. Nothing
    else read it.
  - `agreed` and `disputed` are now settled per slot, on `lineupMoves`'
    reasoning. Whoever is left in a slot after the players every desk starts
    pairs up by each desk's own ranking rather than by the order the matching
    seated them, which would set a desk's 20-point pick against the other's
    5-point one and report a spread that is an artifact of the matching.
  - The check that fails on the old code: `a player both desks start in the same
    slot is agreement, not two disputes` in `server/src/lineup.test.js`, three
    backs on the bench and two `RB` seats, with the desks ordering them
    differently. It asserts one agreed player and one disputed seat.
  - **The `shots` fixture was already triggering it, which is the demonstration
    rather than an assertion.** Photographed either side of the fix on the same
    fixture: before, `2 seats the two desks fill differently` with Chase Brown
    on both sides of the table; after, `One seat`, Omarion Hampton against
    Ashton Jeanty, and Chase Brown reported as agreed. So the screen the owner
    reported was reproducible without a real league.
  - Local gate: `server:test` 184, typecheck clean, `bridge:test` 7,
    `engine:test` green, build clean, `shots` clean with no console errors, lint
    unchanged. Driven against an isolated service and client on 5179 and 5180,
    restarted between the before and after runs; 5178 was never touched.
  - Manual validation outstanding: the owner's own board, which is where it was
    reported. `engine:test`'s two fixture suites skipped, since
    `client/fixtures.local.json` is absent here.
  - Dependencies or blockers: none.

- [x] Y9.3b: The desks disagree about players, not about seats.
  - **Y9.3a was a partial fix, and the owner reported it as one the same day.**
    Grouping by slot stopped a player being double-named across two `RB` seats
    and left the same defect across slots: McCaffrey started at `RB` by one desk
    and in the flex by the other came out as an argument about two seats, when
    both desks want him on the field. Three disputed seats, two of them naming
    the same player, where the board held one decision.
  - The unit was wrong both times, so this fixes the unit rather than the case.
    A player is worth the same points in every seat he can fill -- the premise
    `bestLineup` is built on -- so a **set** of startable players scores the same
    however it is seated, and two desks recommending the same set agree whatever
    slots their matchings used. What they can differ about is who starts.
    `lineupAdvice` now compares the sets. Seats and slots are both covered by
    that, and it is less code than the per-slot version it replaces.
  - The screen changed with it, and the owner chose the shape: a row is a player
    against a player, so `slot` moved from the row onto each pick and says where
    that desk would put him. The heading counts players. `agreed` is rendered for
    the first time -- it was computed and thrown away since Y9.2 -- because
    without it a player who vanished from the disputed table looks dropped rather
    than agreed.
  - The checks that fail on Y9.3a's code, both in `server/src/lineup.test.js`:
    `a player both desks start in different slots is agreement too`, which is the
    reported board in miniature, and the slot assertions on the two existing
    dispute tests. The first also pins the spread at 13 where one desk separates
    the players by 13 and the other by 2, since the widest view is the one
    reported.
  - **Three checks were added to `engine:test` and they do not bite, which is
    said here rather than left to look like coverage.** They assert the invariant
    over the real endpoint -- a player both desks start is agreed, never
    disputed, never named twice -- but whether the fixture produces a shared
    starter in two slots depends on live projections, and today it does not: run
    against the pre-fix service all three passed. They guard the joined-up route;
    the unit tests are the demonstration. Recorded in the file too.
  - Rendered evidence: the advice panel photographed against the fixture, which
    reads `One player the two desks disagree about`, `Omarion Hampton RB` against
    `Ashton Jeanty RB`, and `Both desks start Chase Brown, A.J. Brown, CeeDee
    Lamb, Justin Jefferson`. `shots` cannot see that paragraph on its own --
    it is below the viewport it photographs -- so it was driven separately
    against the same spare pair.
  - Local gate: `server:test` 185, typecheck clean, `bridge:test` 7,
    `engine:test` green, build clean, `shots` clean with no console errors, lint
    unchanged and none of it in the files touched. Isolated service and client on
    5179 and 5180, restarted between every code change; 5178 was never touched
    and is still holding the owner's league.
  - Manual validation outstanding: the owner's own board. 5178 has not been
    restarted, so nothing reported here has been seen against a real league yet.
    `engine:test`'s two fixture suites skipped, since `client/fixtures.local.json`
    is absent here.
  - Dependencies or blockers: none.

- [x] Y9.3c: A player the answer moves is moved, not benched and started.
  - **The third report of one defect, and the second fix that had not gone far
    enough.** Reported from the owner's board with a screenshot: ESPN's swap
    table read "bench Travis Etienne Jr." on the `RB` row and "start Travis
    Etienne Jr." on the `W/R/T` row. Y9.3a grouped `lineupMoves` by slot, which
    settled two seats of one slot; a player whose *slot* changes was still
    reported as leaving the lineup and entering it.
  - The correction is the same one Y9.3b made to the disputed table, applied to
    the swaps: **whether a player starts and which seat he sits in are two
    questions.** `moves` now answers the first, computed over the whole lineup,
    so it names only players entering or leaving it. `moved` answers the second,
    for a player the answer keeps and reseats. `slot` on a swap is where the
    incoming player goes, which is the seat the user opens.
  - Both surfaces report the relocation rather than dropping it: the app's
    screen as its own line under the swap table, deliberately not a
    `.season-table` so the `shots` check below cannot read it as a swap, and the
    Yahoo panel as a `move X RB → W/R/T` line. A desk with a relocation and no
    swap is no longer described as leaving the lineup alone.
  - `nobody` replaces `empty` in the bench column. Null there used to mean the
    seat was empty; it now also means a relocation freed one, and both are a
    lineup that gains a starter rather than exchanging one.
  - **The check that catches it is in `shots`, and it bites.** Run against the
    pre-fix service it fails with `a desk benches and starts the same player:
    Justin Jefferson` -- read off the rendered rows, because this defect has
    twice been visible on screen while every check passed. That fixture starts a
    receiver at `WR` the best lineup wants in the flex, so it is real on live
    projections.
    - **The same assertion in `engine:test` does not bite**, and is kept anyway
      as an invariant on the endpoint. Its fixture produces no relocation, so it
      passed against the pre-fix code. Said here rather than left to look like
      coverage, as with Y9.3b's three.
    - Two unit checks in `server/src/lineup.test.js` do bite: the relocation
      with a swap, and a relocation with nothing coming in or out at all.
  - **The first version of the unit check was wrong and the code told me.** With
    one `RB` seat the matching seats the incoming back in the flex and leaves the
    incumbent alone, because a back fills either and `seat`'s current-seat
    preference declines to invent motion -- so there was no relocation to check.
    It takes a second `RB` seat to force one. That preference is Y9.2's and is
    working; the test was asserting against advice that was already right.
  - Rendered evidence on both surfaces, from the same live payload: the app's
    screen shows three swaps and `Move Justin Jefferson from WR to W/R/T`, and
    the panel shows the same. Neither names anybody twice.
  - Local gate: `server:test` 187, `reader:test` 11, `bridge:test` 7, typecheck
    clean, `engine:test` green, build clean, `shots` clean with no console
    errors, lint unchanged. Isolated service and client on 5179 and 5180.
  - Manual validation outstanding: the owner's own board and their own Yahoo
    page. The reader needs its `@version` raised again for an installed copy to
    pick the panel change up.
  - Dependencies or blockers: none.

- [x] Y9.4: The same reading over Yahoo's own league pages.
  - **Delivered in the reader's own panel rather than a panel of its own**, on
    the owner's decision, which is the one thing below that does not match the
    scope as written. Recorded as `DECISIONS.md`, 2026-09-09, "The week's advice
    goes in the reader's panel": the scope was written on 2026-09-08 when the
    reader ran only when clicked, so a panel had to be its own install because
    nothing was already on the page. Y8.7 changed that the same day the panel
    was asked for.
  - Scope as built: `userscript/league-reader.js` fetches
    `GET /api/yahoo/league/<id>/lineup` on the loopback straight after each
    post, and paints it under the reading in the panel it already draws. One
    element holding a shadow root, no key handler, no focus. It never asks
    Yahoo for anything and never writes a lineup. Only the userscript copy asks
    for it -- the bookmarklet's panel fades after nine seconds, so advice under
    it would be gone before it was read.
  - What the arrangement buys over a separate panel, and it is the reason rather
    than the tidiness: **it knows when a fresh reading landed.** The advice is
    read immediately after the post that produced it, so what is on screen is
    always the reading above it. A separate panel would have polled a timer and
    shown advice from a snapshot it could not date.
  - Acceptance criteria, all met:
    - **The panel's swaps and numbers are the screen's, from the same
      endpoint.** Demonstrated rather than asserted: the panel was rendered
      against a live payload from a spare service holding the same fixture the
      app's screen was photographed from, and the two agree line for line --
      `Sleeper 8.9 now · 12.5 best · +3.6`, `ESPN 9.5 now · 12.8 best · +3.3`,
      the same four moves each, the same four agreed players, and the same one
      disagreement.
    - **It says when it cannot reach the service** instead of showing nothing,
      and repeats the service's own refusal where the league was read but cannot
      be advised on. Both are checked, and the first showed up for real during
      the render: the harness pointed at 5178 while the fixture was on 5179, and
      the panel said so.
    - A click where it sits still reaches the page underneath **except on the
      beat control and the advice block**, which is a departure worth naming:
      the panel takes the mouse in userscript mode because it now has a control
      and can scroll. The bookmarklet's panel is still pointer-transparent.
    - Its build stamp is the one Y8.7 added. **It still does not report back**,
      so a stale copy is not detected -- carried from Y8.7 rather than fixed
      here, and named in both decisions.
  - Automated validation: `npm run reader:test`, now 11 cases. Six are new and
    cover this: the panel paints the advice off the endpoint, a gain of null
    reads as unknown rather than as nothing, an unreachable service is said out
    loud, a refusal is repeated rather than painted as no advice, **a player
    name out of Yahoo cannot put markup in the panel**, and the bookmarklet copy
    asks for no advice at all.
    - The escaping check earned its place: these names go into `innerHTML` on
      the user's own signed-in Yahoo page, which is the last place to be relaxed
      about it. The league name on the reading line was already interpolated
      unescaped and now is not.
    - **A harness defect the tests found first.** The fake `fetch` matched the
      snapshot address before the advice address, and both start
      `/api/yahoo/league/<id>`. The advice read landed on the snapshot branch,
      `opts` came back undefined, and the reader's own catch turned the type
      error into a panel reporting the service unreachable -- a green run
      testing nothing. The ordering now carries a note.
  - Manual validation: **required and outstanding.** The rendering was
    photographed out of the real markup with real data, which is more than Y9.4
    expected to be possible, but not on a Yahoo page. The owner has the
    userscript installed and the panel appearing; what is unconfirmed is the
    advice block on their own league beside the app.
  - Known cost, accepted in advance and unchanged: the advice sentences are a
    second copy with nothing checking they agree with the app's, exactly as the
    draft take line already is. `reader.test.mjs` pins the panel against the
    endpoint's shape, not against the screen.
  - **Narrowed the same day, on the owner's request:** the panel no longer names
    who both desks start. Only the disagreement is a decision, and the agreement
    line was most of the roster in a panel 380px wide. It stays on the app's
    screen where there is room for it, and the endpoint still returns it, so
    nothing below this changes but the one line. `@version` moved to 1.4.1,
    because an installed copy updates on that alone.
  - Dependencies or blockers: Y9.3 for the endpoint, Y8.7 for the panel that
    holds this.

### Subsequent task planning

Phase 9 is split above. Phases 10 and 11 remain roadmap outcomes until their
input contracts are established. Before implementing each, split it into
reviewable tasks with explicit acceptance and validation, then record actual
results rather than marking the phase done from a build alone. Order: waiver
add/drop comparisons, trade evaluation, then trade targets and comparison with
waivers. Other league platforms remain deferred.

**Both things Phase 9 inherited are now settled, and neither had to be
assumed.** How the two projection sources are combined was open on purpose -- a
range, a primary, or a refusal past some spread -- and Y9.0 measured the spread
and answered it: show both, and the disagreement stops mattering above about
three points of separation. Computing points from raw components against a
league's 35 modifiers was called the load-bearing work of the phase, and it is,
but it is no longer a risk: Y9.0 proved the operation against both feeds' own
published points before anything was built on it.

Phase 10 inherits one hold that a browser run closes and nothing else does:
**availability -- free agent against waiver against taken -- is league-scoped
and unread.** It blocks waiver advice entirely, and `PLAN.md` names it as the
one to close first.

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
