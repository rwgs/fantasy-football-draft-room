# Project tasks

The work in flight and the work already validated. A task is one reviewable
outcome: if it cannot be finished and checked in a single pass, it is a phase
and belongs in `ROADMAP.md`.

## Current phase

Phase 4: prove the platform seam against real leagues.

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

- [ ] Write the Yahoo draft queue from the board.
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
    is never written; no pick is ever sent. The last three are met and checked.
    **The first is still not met** — see manual validation.
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
  - Manual validation: **still not done — no real queue has ever been written.**
    Two more mocks on 2026-09-07 got no further, and the reason is now confirmed
    rather than suspected: the browser was running bridge **1.0.0** throughout.
    It logs no version banner, its filter is `/^(?:0|H|R|P)(?:\||$)/` so every
    `Q` is dropped before it leaves the page, and it has no write path at all.
    That accounts for all three symptoms seen, and for the `10888301` run above.
    The manager's own stored source reads 1.3.0, so what is saved and what is
    injected disagree: it is a real reinstall that is untested, not the code.
    Next mock: confirm `v1.3.0 loading` in the room's console **first**, and only
    then turn the setting on, star a player, and watch for the `S|` and the `Q|`
    that answers it.
  - Dependencies or blockers: none.
  - Still unverified, and cheap to settle in the same mock:
    - Whether Yahoo's own draft room redraws its queue from a `Q|` it did not
      provoke. If not, a queue set from the app is live but invisible in Yahoo's
      list until a reload, which would look exactly like a failure.
    - Whether Yahoo hands back an existing queue on connect. No longer blocking,
      since the first write no longer waits for one, but it decides whether the
      first write can stop replacing anything.

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

- [ ] Decide whether the service should serve the userscript in a release.
  - Now serves three things, not one: the bridge userscript, `/panel.js`, and
    `/panel`, the page that installs the panel as a bookmarklet. The same
    hard-coded `127.0.0.1:5178` question applies to all three.
  - Added while validating: `GET /userscript/yahoo-draft-bridge.user.js`, so a
    manager installs from an address and can pick up later versions instead of
    the user re-pasting a file. It is the install path the README now documents.
  - Worth a second look before release: it is the first static asset the service
    serves, and `@downloadURL` in the script hard-codes `127.0.0.1:5178`, which
    is wrong for anyone who moves the port.

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
