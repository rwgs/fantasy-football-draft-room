# Repository review: draft advice, player value and data quality

Reviewed: 2026-09-07. Branch: `yahoo-platform`.
HEAD at review time: `d4d71f7fbd053594ad2e2560d0b7537b5b9e6c42`.
The working tree was clean before this review.

**Status, updated 2026-09-07 after the first pass of fixes.** Seven findings are
fixed and committed: R8, R7, R4, R5, R3, R9 and R2. Those were the findings that
are defects with one right answer, so none of them needed a product decision
first. See "What has been fixed" below for what changed and what each fix is
checked by. The other eight findings are open and each is annotated in place.
The description of current behaviour in every fixed section is kept as written,
because it is what the defect was; the FIXED note says what it is now.

## Assessment

The app has useful foundations: a fast local draft engine, transparent player values, imported rankings, several market feeds, and awareness of roster needs. However, I would not yet rely on its recommended pick or automatic queue as the primary decision maker for building a winning team. There are reproducible defects in scoring, player identity, and forecasting, followed by limitations in what the recommendation formula optimizes.

The most important distinction is between **when somebody else will draft a player** and **how much that player improves your team**. The code partially separates these questions, but mixes them again through replacement levels, the combined ADP, and the recommendation score. More ADP sources alone will not solve that.

The existing checks mostly demonstrate that drafts execute and that the heuristics behave as designed. They do not establish that those heuristics improve actual team performance. A passing build and an A+ draft grade are not evidence of better championship odds.

Scope: source adapters, board construction and joins, league settings, roster allocation, CPU picks, player worth, survival, room forecasts, recommendations and queue generation, grades, relevant UI wiring, and test coverage. This is a single-agent repository audit, not a security audit or a claim of release readiness. Recommendations that change accepted product decisions are identified below.

## Current scope: Yahoo draft assistant only

Per the user's follow-up, work needed only for **Sleeper league support** or this app's **Mock draft option** is **DEFERRABLE**. The applicability table and detailed findings are now in the same order of expected improvement to Yahoo pick accuracy. Finding IDs are retained for reference; their numbers no longer indicate priority.

Sleeper as a **data source** remains in scope: Yahoo's board still uses its player records and projected points. Likewise, the assistant uses the shared CPU model internally to forecast opponents' future picks. A simulation-based reproduction does not make a finding mock-only. Following a Yahoo-hosted mock through Draft assistant exercises the Yahoo path and remains a useful check; that is separate from selecting this app's Mock draft option.

The ranking is an engineering judgment about likely breadth and size of improvement, not a measured winning advantage or a strict implementation dependency order. Priorities 1-8 address the values and decisions affecting many picks; 9-11 address narrower correctness failures; 12 measures real effectiveness; 13-14 address availability and reporting. Check the actual Yahoo scoring first: if the existing preset is correct, skip the unsupported-scoring work in R1. The forecast repairs remain prerequisites for trusting a revised recommendation model that uses those forecasts.

| Impact priority | Finding | Yahoo assistant applicability | Deferrable portion |
| --- | --- | --- | --- |
| 1 | R1 - Scoring and eligibility | **IN SCOPE, conditional on the actual Yahoo rules.** Format-only projections and limited eligibility also affect Yahoo. | **DEFERRABLE:** Sleeper's automatic reception-format selection, dedicated-2QB detection, import warnings, and `WRRB_FLEX`/`REC_FLEX` mapping. |
| 2 | R7 - Replacement allocation | **IN SCOPE.** Yahoo WORTH and recommendations use this baseline. | None. |
| 3 | M1 - Team-building objective | **IN SCOPE.** The Yahoo recommendation and queue use this scoring model. | Standalone mock-mode polish is outside this work. |
| 4 | R6 - Roster completion and queue | **IN SCOPE.** Advice is affected; automatic queue behavior matters when enabled. | Queue-specific work is conditional on using the automatic queue, not a Sleeper/mock-only issue. |
| 5 | R3 - Forecast horizon | **IN SCOPE.** The room forecast disappearing on the user's turn directly affects Yahoo advice. | **DEFERRABLE:** the future-keeper-preset horizon extension; the current Yahoo import supplies no future keeper presets. |
| 6 | R4 - Wrong survivor value | **IN SCOPE.** Yahoo uses this forecast. | None. |
| 7 | R5 - Zero survival fallback | **IN SCOPE.** Yahoo targets and pool odds use these consumers. | None. |
| 8 | M2 - Projections and personal ranks | **IN SCOPE.** These limitations affect Yahoo player assessment. | Changes solely to how mock opponents follow uploaded rankings can wait; preserve checks on any shared forecast behavior. |
| 9 | R2 - Duplicate player identity | **IN SCOPE.** Yahoo resolves its picks against this same board. | None: the invalid position and unmatched projection are shared data defects. |
| 10 | R9 - Corrected live picks | **IN SCOPE.** Yahoo uses the same polling guard. | Sleeper-specific end-to-end coverage can wait; the shared correction needs a Yahoo check. |
| 11 | R8 - Numerical survival tail | **IN SCOPE.** Yahoo uses the generic fallback, including on-clock advice under R3. | None. |
| 12 | M4 - Calibration | **IN SCOPE.** Calibrate the Yahoo assistant's forecasts and advice. | **DEFERRABLE:** Sleeper-specific calibration and standalone mock-room realism, controls, or pacing. Shared forecast behavior remains in scope. |
| 13 | R10 - Feed degradation | **IN SCOPE.** Yahoo depends on the shared board builder and feeds. | None for the board sources; these are not Sleeper league-import requests. |
| 14 | M5 - Grade and byes | **IN SCOPE, lower priority than live picks.** The assistant also opens the results screen when the draft ends. | Not mock-only. A richer post-draft grade can follow the live-advice repairs. |
| Conditional / deferrable | M3 - Dynasty context | **CONDITIONAL.** Applies if the Yahoo league is dynasty or the dynasty board is selected. | **DEFERRABLE if the Yahoo draft is redraft.** The league's dynasty status has not been established in this review. |

**DEFERRABLE validation:** populating Sleeper league fixtures and completing the two skipped Sleeper real-league suites is not a blocker for this Yahoo-focused review. Checks dedicated solely to the standalone Mock draft option can also wait. Shared engine tests, synthetic forecast fixtures, board-source checks, and Yahoo bridge/assistant checks remain relevant even when they use simulated inputs. Preserve the existing broader gate results recorded below; they were already run during the initial audit.

## What has been fixed

Seven findings, in the order the report ranks them, each its own commit. 31 new
checks in `npm run engine:test`. Typecheck, lint, `engine:test`, `server:test`,
`bridge:test`, build and `shots` all clean, no console errors, lint warnings
unchanged at 43 against a stashed baseline.

| Finding | What changed | Checked by |
| --- | --- | --- |
| R7 | `startingAllocation` gives each position its dedicated slots and shares the flex out by largest remainder among the positions a flex can reach, so the total reconciles with the league by construction. The market still sets the shape; the roster now sets the size. | Totals reconcile with and without a superflex; a one-QB no-flex league starts twelve on a board that takes 24 first, and prices replacement at QB13. |
| R3 | One `decisionHorizon` in `draft.ts`, read by both the screen and the forecast. Your own turn inside the window is stepped over by `skipPick` rather than played, so the simulation cannot draft the player you are weighing and then report he never survives. | Seat 5 on the clock at pick 5 forecasts to 20; your own turn removes nobody, so 14 opponent picks are simulated rather than 15; across three states the two horizons are the same number and never the pick in hand. |
| R4 | The forecast measures the best survivor by worth, the same definition `now` uses, instead of the first survivor in board order. A missing projection is no evidence on both sides alike. | Waiting for a player the room never takes costs nothing; what is expected to be left is never worth more than what is there. |
| R5 | Every player available when the forecast runs gets an explicit entry, so absence means only "already drafted before it ran". All three consumers now read the room's own answer. | Every available player has a forecast; the five players taken in all 120 runs would have read as reachable on ADP alone and no longer do. |
| R8 | `logNormalTail` joins `normalCdf`, and the conditional survival is a ratio taken in logs. Above two standard deviations the tail comes from the Mills ratio as a continued fraction, which has relative accuracy where Abramowitz and Stegun has only a fixed absolute error. | The ADP 10, sd 1 case reads 0.21% rather than 100%; the odds fall as the wait runs; an extreme tail stays a probability and never climbs. |
| R9 | `sameLivePicks` compares by slot and player, sorted, rather than by count. Overlapping poll answers are numbered and a stale one is dropped. | `[A, B]` then `[A, C]` puts B back and takes C without waiting for a third pick; the same picks reordered are not mistaken for a change. |
| R2 | `DRAFTABLE` names the six positions a roster slot can hold, and both boundaries that build a board row are checked against it. `normPos` keeps its pass-through, which is what a diagnostic wants. | Every board position is one a roster can hold; nobody appears twice under two ids; every count stays finite. These two fail against the pre-fix service and pass against the fixed one. |

Two of the new checks were confirmed by failing rather than assumed. The R2
board checks were run against both a pre-fix and a post-fix service. The
extreme-tail check caught a genuine underflow boundary while being written: past
about eighty standard deviations the probability really is zero to double
precision, so the assertion was corrected rather than the code.

The board went from 626 rows to 625, carries only the six supported positions,
and holds no duplicate name. On the live 12 team half-PPR board R7 changed the
allocation from 131 starters against 108 slots to 108 against 108, which had
been inflating RB and WR worth against QB and TE for every player on it.

### Still outstanding from the fixed findings

- **R2, the missing projection.** Travis Hunter's WR row still has no projected
  points. The report asks that the DB record not simply be discarded leaving the
  WR projection missing, and that half is not done, deliberately: attaching
  Sleeper's 83.1 points filed under DB would assert it is a receiving projection
  rather than an IDP one, and if it is IDP then attaching it silently corrupts
  his worth -- worse than the missing value the board already shows honestly.
  That is a question about what the feed means, not about this code.
- **The service on port 5178 reports STALE.** `server/src` changed after it
  started, so it is serving the pre-R2 board. The fix was checked against a
  second service on 5179 rather than by restarting it, because a bridge had been
  heard from three minutes earlier and Yahoo rooms are held in memory only.
- **`nextUserPick` and `picksUntilUserTurn`** now have no production caller.
  Left as pre-existing surface rather than widened into these changes.

## What is still open, and why

Eight findings are untouched. They fall into two groups, and neither is blocked
on the work above.

**Needs a fact this repository does not hold.** R1, the league's scoring inputs,
is the report's own first priority and is conditional on the actual Yahoo rules:
the report says to check those first and skip the unsupported-scoring work if
the existing preset is already right. Yahoo's import leaves scoring and roster
settings as the user set them, so nothing in the tree answers it.

**Changes an accepted product decision.** M1 (the team-building objective), the
bench-valuation half of R6, M2 (personal ranks and projection sources), M4
(calibration), M5 (grade and byes) and M3 (dynasty context) all revise what the
app is deciding rather than fix a defect in how it decides it. M1 and R6 are
constrained by the 2026-09-05 recommendation entry in `DECISIONS.md`, which the
report notes should be reconsidered explicitly before being changed. R10 (feed
degradation) is a reliability change whose scope -- what counts as degraded
operation, and whether a bad response may replace a usable cache -- is a
judgment about how the service should behave, not a single right answer.

R6 has a defect half that could be taken without settling anything: the
automatic queue returning an empty list when no positive-worth player remains,
which the report reproduces with 30 available RBs below replacement. Filling
that gap still needs a policy for what a legal selection is when nothing has
positive worth, which is why it is grouped here.


## How the current advice works

| Question | Current answer in the code |
| --- | --- |
| What will the room pay? | Selected ADP feeds, averaged or read in priority order; default is Sleeper then FFC. |
| What will the player score? | One Sleeper season projection, attributed by the repository to RotoWire. The selected ADP sources do not change the projection provider. |
| What is WORTH? | Season projected points minus a positional replacement starter's projected points. |
| What does waiting cost? | Current positional leader's worth minus expected worth remaining at the next pick. |
| Who is recommended? | The points leader at each position is scored by worth plus waiting cost; waiting cost counts only if the position fills an open starting slot. Nonpositive worth is excluded. |
| What changes when I upload rankings? | The Mine sort and, optionally, CPU selections. The recommendation and projected points do not use those ranks. |
| What does the letter grade mean? | Rank within this particular room by the projected season totals of each team's best static starting lineup. |

## Detailed findings, highest expected impact first

P1 means an issue can directly change a pick, corrupt availability, or give materially incorrect advice. P2 means an important issue with a narrower trigger or a less immediate effect. Severity labels are preserved from the initial audit; the impact-priority column above is the order to use for this Yahoo-focused work.

M findings concern the decision model rather than only implementation defects. Some deliberately follow [the accepted recommendation decision](../DECISIONS.md), under "2026-09-05 The board names a pick, and says nothing when there is nothing to say". Reconsider those decisions explicitly before changing the model.

### R1 - P1: league scoring is reduced to a format label, producing incorrect points

Evidence: [Sleeper league import](../server/src/platforms/sleeper/league.js), lines 54-63 and 131-156; [projection fields](../server/src/sources/sleeper.js), lines 20-28 and 88-132; [league configuration](../client/src/engine/types.ts), `LeagueConfig`.

**IN SCOPE - shared projection model:** the `2qb` format's projected points are always half PPR, whichever platform is followed. Yahoo's current import leaves scoring and roster settings as the user set them, so the immediate check is whether those settings and the resulting points match the actual Yahoo league. Standard, half-PPR, and PPR presets need not be replaced merely because Sleeper's importer has defects; additional scoring support is needed where the Yahoo rules differ.

Reproduced with a receiver row carrying `pts_ppr: 250` and `pts_half_ppr: 200`: `projectionMap(rows, 'ppr')` returns 250 points, while `projectionMap(rows, '2qb')` returns 200. A full-PPR superflex league therefore loses 50 points for this example before worth, waiting cost, or grades are calculated.

Other consequences visible in the code:

- **DEFERRABLE - Sleeper import:** a league with two dedicated QB starters and no SUPERFLEX slot is not detected as `2qb` by `readScoring`.
- **IN SCOPE if used by the Yahoo league:** six-point passing touchdowns, passing/interception changes, points per first down, TE reception premiums, and custom kicking/defense scoring cannot be applied. **DEFERRABLE - Sleeper import warning:** only keys beginning with `bonus` produce the bonus warning.
- **DEFERRABLE - Sleeper import:** `WRRB_FLEX` is broadened to RB/WR/TE eligibility without the warning given for `REC_FLEX`. That can make a TE look startable in a slot the actual league reserves for RB/WR. Separately, a restricted flex in the actual Yahoo roster would still require correct eligibility in the shared model.

Impact: both individual values and positional priorities can be wrong for the user's actual league, even when the import appears successful.

Recommendation: separate scoring rules, roster eligibility, redraft/dynasty context, and market ADP format. Retain raw projected statistics and calculate points using the actual rules. Explicitly identify unsupported rules and restricted flex slots. For Yahoo, continue requiring the user to supply settings that its current import cannot read.

Acceptance check for current scope: compare projected points and legal lineups against hand-calculated fixtures for the actual Yahoo scoring and roster. Include PPR superflex, dedicated 2QB, six-point passing TDs, TE premium, or restricted flex only where applicable to that league. **DEFERRABLE:** exercising Sleeper's automatic import of those settings. Any shared configuration/model change still requires a decision before implementation.

### R7 - P2: replacement levels can allocate more starters than the league has slots

**FIXED** in `startingAllocation` (`client/src/engine/value.ts`). Dedicated slots are owed outright and the flex is shared by largest remainder among eligible positions only, so the total reconciles with `teams * starterCount` by construction. On the live board this moved the allocation from 131 starters against 108 slots to 108 against 108. The kicker floor is now inherent rather than a separate clamp. Five checks in `engine:test`.

Evidence: [replacement calculation](../client/src/engine/value.ts), lines 50-70; [worth explanation](../README.md), lines 453-460.

The calculation counts positions inside the first `teams * starterCount` ADP entries, then independently floors each count at the position's required starters. It never removes allocations that exceed legal starting capacity or reconciles the total after those floors.

Reproduced in a 12-team league starting one QB, one RB and one WR, with no flex: an ADP window containing 24 QBs and 12 RBs gets supplemented with a floor of 12 WRs. The baseline effectively counts 48 positional starters against 36 slots. With QB projections `400, 399, ..., 377`, it returns replacement QB points of 377; the first QB beyond the 12 required starters has 388.

Changing ADP sources can also change WORTH even if projections and roster rules are unchanged, because those market counts define the baseline.

A separate interpretation issue: the first player outside the starting lineup is not necessarily on waivers. Other teams draft benches. The README's statement that negative worth means the waiver wire has someone as good is not supported by this starter-only baseline.

Recommendation: allocate required starters and eligible flex slots within the actual capacity, and define separately whether a baseline represents a marginal starter or a realistically available waiver replacement. Bench depth and league size matter to the latter.

Acceptance check: allocated starter counts sum to the actual league total and satisfy eligibility. A no-flex, one-QB league cannot allocate 24 starting QBs across 12 teams.

### M1 - High priority: worth plus waiting cost is not an optimizer for the resulting team

The score for an open starter is `now + (now - later)`, or `2 * now - later`. That is a heuristic. It does not compare the total lineup obtainable by taking one player now and another later.

Reproduced by passing these positional rows to `recommendPick`, with both starting slots open:

| Position | Worth now | Worth next turn | Waiting cost | App score |
| --- | ---: | ---: | ---: | ---: |
| WR | 100 | 0 | 100 | 200 |
| RB | 150 | 70 | 80 | 230 |

The app chooses RB. Under these supplied, deterministic continuation values, RB now plus WR later yields 150. WR now plus RB later yields 170. The recommendation gives up 20 points even within its own value model. This is a counterexample to optimality, not an estimate that every real draft loses 20 points.

The binary treatment of starter/bench also misses upgrades: an additional WR can improve a filled lineup by replacing a weaker starter, while an additional QB behind a stronger QB can add no healthy-week starting points. Position counts cannot distinguish them.

Recommended direction: evaluate the change in the best legal lineup when a candidate is added, then compare short candidate-conditioned draft continuations. Define bench contribution through expected usable weeks, replacement access, and upside. Do not introduce an arbitrary bench multiplier simply to hide the problem; the existing decision explicitly rejected that approach.

Validation: deterministic two-pick cases such as the table above, followed by comparisons against simpler draft strategies under the same settings and opponent simulations. Ultimately use held-out real outcomes as described in M4.

### R6 - P1: recommendations and automatic queues can neglect the starting lineup or stop before the roster is filled

Evidence: [candidate scoring](../client/src/engine/value.ts), lines 219-227; [queue sequence](../client/src/engine/forecast.ts), lines 511-527; compare [CPU starter constraint](../client/src/engine/cpu.ts), lines 179-199.

For a position that no longer fills a starter, only urgency is removed; the full worth remains. The recommendation sees position counts, not the quality of the players already held. A backup behind an excellent starting QB can therefore outrank a player who fills an empty WR slot.

Reproduced with a filled QB slot: a backup QB with worth 100 and no urgency beats a needed WR with worth 30 and waiting cost 10. The returned recommendation has `fillsStarter: false`. The same ordering occurs even if this is the final pick: the advice interface has no remaining-picks constraint.

Separately, all candidates must satisfy `row.now > 0`. In a reproduced late-draft pool containing 30 available RBs below the replacement-starter threshold, `recommendSequence(..., depth: 4)` returns an empty list. Those players may still be legitimate bench selections. A depleted starting position can also be excluded exactly when filling it is compulsory.

Recommendation: preserve the ability to finish a legal lineup using the team's actual remaining choices, then assess the incremental contribution to that roster. Separate starter replacement from bench value. When no positive-worth player remains, the automatic queue still needs a legal selection policy; the UI can explain its lower confidence.

Acceptance check: the final necessary starter is chosen over an unusable backup, and queue generation continues with legal depth when the remaining worth values are nonpositive. Bench valuation revisits an accepted design decision; see M1.

### R3 - P1: the room forecast disappears exactly when the user is on the clock

**FIXED.** `decisionHorizon` in `client/src/engine/draft.ts` is now the one horizon, read by both the screen and `forecast`, which also closes the keeper-preset disagreement noted below. Your own turn inside the window is stepped over by `skipPick` rather than played, so the simulation cannot draft the candidate you are weighing: from pick 5 to 20 it plays the room's 14 picks and not your 1. Five checks in `engine:test`.

Evidence: [forecast target](../client/src/engine/forecast.ts), lines 227-229; [UI target and forecast call](../client/src/components/DraftScreen.tsx), lines 157 and 326-328.

The UI correctly sets its waiting horizon to the user's pick after the current one. `forecast()` independently calls `nextUserPick(state)`, which returns the current pick when the user is on the clock. It then returns null because `target <= from`.

Reproduced in a 12-team snake, seat 5, after four picks: current pick is 5, the next choice is 20, and `forecast(engine, 1)` returns null. The UI consequently falls back to generic ADP survival and waiting costs. Measured room behavior and opponent rosters stop informing the recommendation when the pick must actually be made.

**DEFERRABLE - future keeper presets:** the forecast also uses `nextUserPick`, whereas the UI uses `nextUserChoice`; a future keeper can therefore create a different forecast horizon from the displayed decision horizon. The current [Yahoo league setup](../server/src/platforms/yahoo/index.js), `leagueSetup`, supplies no future keeper presets. This extension can wait without deferring the on-clock Yahoo defect above.

Recommendation: pass one explicit decision horizon through the forecast and the UI, accounting for presets. For advice on the current turn, condition the future board on the candidate pick or otherwise explicitly model the current choice; merely advancing the target would let the CPU choose the user's current player inside the simulation.

Acceptance check: the Yahoo assistant on-clock fixture forecasts to pick 20 and preserves the room reading. **DEFERRABLE:** extending the check to ensure a future keeper before the next selectable pick does not shorten that horizon.

### R4 - P1: expected remaining value measures the first player by ADP, not the best by points

**FIXED.** The forecast takes the maximum worth among everyone left, which is the definition `positionValues` already used for `now`, and treats a missing projection as no evidence on both sides. Three checks in `engine:test`, including that waiting for a player the room never takes costs nothing, and that what is expected to be left is never worth more than what is there.

Evidence: [forecast survivors](../client/src/engine/forecast.ts), lines 276-285; [current positional value](../client/src/engine/value.ts), lines 141-153.

Current value selects the highest projected points at a position. The forecast measures the first surviving player in ADP order and stops looking at that position. These are different definitions of "best", so their subtraction invents scarcity whenever projections disagree with ADP.

Reproduced with a deterministic two-team fixture. Both a 100-point WR with ADP 10 and a 300-point WR with ADP 20 survive to the next choice. Replacement is 50 points. The forecast reports expected WR worth of 50, although the surviving 300-point receiver is worth 250. The high-scoring receiver survives 100% of runs. The resulting waiting cost is inflated by 200 points.

Recommendation: in each simulation, find the maximum usable projected value among all remaining players at each position. Use the same definition on both sides of the comparison and an explicit policy for missing projections.

Acceptance check: the fixture reports 250 expected WR worth and zero waiting cost for its best WR.

### R5 - P1: zero simulated survival is interpreted as missing data and replaced with generic ADP odds

**FIXED.** Every player available when the forecast runs gets an explicit entry, so absence now means only "already drafted before it ran" and all three consumers read the room's own answer. Four checks in `engine:test`, on a horizon long enough that the room really does take five players in all 120 runs.

Evidence: [survival map creation](../client/src/engine/forecast.ts), lines 279-294; [reachable player filter](../client/src/engine/forecast.ts), line 555; [pool odds](../client/src/components/PlayerPool.tsx), line 195; [position panel odds](../client/src/engine/forecast.ts), line 405.

The forecast only creates map entries for players who survive at least one run. A player taken in every run has no entry. `reachablePlayers` and the pool interpret that absence as "no forecast" and fall back to `survivalOdds`; the position panel instead interprets it as zero.

Reproduced with a QB taken in all ten deterministic simulations: its survival map entry is missing, the generic fallback is 44.62%, and the QB remains in `reachablePlayers`. The position panel reports 0% for the same player.

Impact: the app can recommend an off-clock target its own room simulation never leaves available, while displaying conflicting odds.

Recommendation: populate the forecast with an explicit zero for every currently available player before counting survivors, or distinguish absence of a forecast from zero survival consistently in every consumer.

Acceptance check: a player taken in every run has zero odds throughout the UI and is excluded by the reachability threshold.

### M2 - High priority: there is only one performance projection, and personal rankings do not influence advice

Adding FFC, ESPN, or room ADP changes market ordering. It does not provide another independent projected point estimate. `recommendChain` and `rankCandidates` do not accept the uploaded ranking map or tiers. A user's researched ranking can disagree with the recommendation without changing it. Notes and injury labels similarly inform the human; they do not constitute a revised projection model.

ESPN's editorial rank is transformed onto the existing market's ADP scale and can vote inside `player.adp`. That combined number then influences simulated opponent picks, survival odds, replacement levels, and reported ADP bargains. An expert's preference is thereby used partly as a prediction of opponent behavior. It also is not an expert consensus: the other votes are market measurements.

The averaging cutoff creates another distortion: `votes()` drops numbers beyond `teams * 20`. In a 12-team example, averaging 120 and 240 gives 180; if the second source moves to 241, it abstains and the combined number jumps to 120. The source just became slightly less enthusiastic, but the player suddenly looks much more expensive. This is especially questionable for the supported 21-30-round drafts.

Recommended direction: keep **market availability** and **player assessment** separate throughout the engine. Preserve editorial ranks and source disagreement as their own evidence. Define clearly whether the user's ranking is authoritative, advisory, or display-only; a rank alone should not be silently converted to points. If adding projection sources or user projection imports, first measure their accuracy and coverage rather than assuming an average is automatically superior.

The [FantasyPros decision](../DECISIONS.md), under "2026-09-05 FantasyPros is not a source on the free tier", records a tested row limit and explicitly defers integration without suitable paid access. This review does not propose working around that limit or making a paid service mandatory.

### R2 - P1: the current feed creates two draftable versions of Travis Hunter

**FIXED, except the projection.** `DRAFTABLE` in `server/src/names.js` names the six positions a roster slot can hold, and both boundaries that build a board row check against it, so the DB record no longer reaches the board: 625 rows, six positions, no duplicate name, no `NaN` count. `normPos` keeps its pass-through, and PK/DST/dual-eligibility mapping is unchanged. **Still open:** Hunter's WR row has no projection, and attaching Sleeper's DB total would assert it is a receiving projection rather than an IDP one -- if it is IDP that silently corrupts his worth, which is worse than the honest gap. Left for a decision. Four checks in `engine:test`, confirmed by failing against a pre-fix service.

Evidence: [position normalization and identity](../server/src/names.js), `normPos` and `joinKey`; [projection normalization](../server/src/sources/sleeper.js), lines 94-98; [board join](../server/src/board.js), lines 260-310.

Observed from the running service's 2026, 12-team, half-PPR board:

| Name | ID | Position | ADP | Projected points |
| --- | --- | --- | --- | --- |
| Travis Hunter | `ffc-travis hunter\|WR` | WR | 161.9 | missing |
| Travis Hunter | `sl-12530` | DB | 191.6 | 83.1 |

`normPos` passes unknown positions through, and `projectionMap` only rejects an empty position. Joining on name plus position then treats the WR and DB records as different people. DB is outside the six positions the engine supports.

Reproduced by drafting both IDs through `draftPlayer`: both picks succeed, and the team receiving the DB acquires a `NaN` DB count. The legitimate WR row is also excluded from points-based advice because its projection did not join. Tests for unique IDs do not catch a duplicate person with different IDs.

Recommendation: reconcile player identity separately from platform eligibility, validate the supported position set at the boundary, and use explicit cross-source identity/eligibility mappings for these cases. Do not simply discard the DB record and leave the WR projection missing.

Acceptance check: this snapshot produces one canonical Hunter, with supported offensive eligibility and an appropriate projection; drafting him removes every source alias. Every board position is supported and every roster count remains finite.

### R9 - P1: a corrected live pick is ignored when the total number of picks stays the same

**FIXED.** `sameLivePicks` in `client/src/engine/live.ts` compares by slot and player, sorted, rather than by count, and only the live claims are compared since those are the ones the poll owns. The ordering concern is handled too: requests are numbered and an answer older than one already applied is dropped. Six checks in `engine:test`.

Evidence: [live polling](../client/src/components/DraftScreen.tsx), lines 224-238.

The poll exits when `current.state.picks.length === presets.length`. It does not compare player IDs or pick ownership. If the commissioner undoes and replaces a pick between polls, or the feed corrects a resolved identity, the new list can have the same length with different contents.

Impact: the old player remains unavailable and the replacement appears draftable until a later change in pick count forces a rebuild. Advice and queues then operate against the wrong board. This is established by the guard and control flow; a real commissioner correction was not exercised during this review.

Recommendation: compare normalized pick content, not just its length, and account for ordering of overlapping poll responses.

Acceptance check: polling `[A, B]` followed by `[A, C]` restores B, removes C, updates the roster, and recalculates advice without waiting for a third pick.

### R8 - P2: numerical tail handling can report 100% survival for a severely overdue player

**FIXED.** `logNormalTail` in `client/src/engine/random.ts` takes the tail from the Mills ratio as a continued fraction above two standard deviations, and `survivalOdds` takes the conditional ratio in logs. The ADP 10, sd 1 case now reads 0.21% rather than 100%. Past about eighty standard deviations the result is still zero, because to double precision it genuinely is; the defect was turning underflow into confidence. Four checks in `engine:test`.

Evidence: [conditional survival](../client/src/engine/survival.ts), lines 20-24; [normal CDF](../client/src/engine/random.ts), `normalCdf`.

When the probability of still being available is below `1e-6`, the code returns 1 whenever the target tail is nonzero. That is not the conditional ratio described by the function.

Reproduced with ADP 10 and standard deviation 1: survival from pick 16 to 17 is reported as 100%, as is 17 to 18. Under the function's stated normal model, the first ratio is approximately 0.21%, not certainty. At a still later target, floating-point cancellation can instead make it abruptly zero.

Recommendation: use a numerically stable survival function or log-tail ratio. If a player has fallen so far that the normal model is no longer credible, expose that as model uncertainty rather than converting numerical underflow into confidence.

Acceptance check: extreme-tail probabilities stay finite, respect the conditional model, and decline as the target moves farther away.

### M4 - High priority for confidence claims: survival and draft quality lack external calibration

Evidence: [CPU selection](../client/src/engine/cpu.ts), `chooseCpuPick`; [forecast baseline](../client/src/engine/forecast.ts), `baseline` and `observedLean`; [forecast tests](../client/src/engine/selftest.ts), lines 694-770; [recorded lean calibration](../DECISIONS.md), the 2026-09-05 lean entries.

Matching the standard deviation of random score noise to FFC's pick standard deviation does not establish that the final simulated pick positions have the same distribution. Every turn redraws scores and selects the minimum across candidates; roster bonuses, reach limits, and caps further change the result. FFC dispersion is reused even when the ADP mean comes from Sleeper, the room, or an editorial mixture.

The lean calibration recorded in the repository compares predictions with rooms produced by the same CPU model. That is useful internal validation, but does not demonstrate accuracy against actual human drafts. The tests check invariants and broad tendencies, not probability calibration or wins.

The room field is platform ADP, not evidence of these particular managers' historical selections. [The repository's Yahoo observations](../DECISIONS.md), in the 2026-09-04 browser entry, already describe `average-pick` as historical ADP; the README overstates it as the people literally being drafted against. Likewise, FFC describes its input as human selections from **mock** drafts, with computer selections removed; setup labels the count "real drafts" without that distinction. [FFC calculation notes](https://help.fantasyfootballcalculator.com/article/34-average-draft-position-adp-data).

Recommended validation:

1. Freeze the data that was available before historical drafts; do not backtest using projections or ADP updated after the outcome.
2. Test availability forecasts against held-out Yahoo drafts matching the target league size, format, and stage. Compare forecast probability buckets with observed survival, using a probability scoring metric such as Brier score. **DEFERRABLE:** extending calibration to Sleeper leagues or improving the standalone Mock draft experience; the CPU model used by Yahoo's forecast remains part of this check.
3. Compare strategies using identical seats, opponent conditions, and input snapshots: roster-aware ADP, personal ranks, simple value over replacement, current advice, and revised advice.
4. Evaluate weekly legal lineup output, bench replacement contribution, and season results using held-out actual scoring. Report uncertainty and the influence of injuries, waivers, and lineup management separately.

Until this exists, describe percentages as estimates from the model and grades as projection-based comparisons. There is no measured winning advantage to report from this review.

### R10 - P2: upstream feed degradation can silently produce unusable advice or hold up the board

Evidence: [parallel source requests](../server/src/board.js), lines 244-254; [Sleeper payload handling](../server/src/sources/sleeper.js), lines 67-76 and 94; [FFC response handling](../server/src/sources/ffc.js), `fetchAdp`; [board stale flag](../server/src/board.js), line 420.

Successful HTTP/JSON parsing is largely treated as successful data. Reproduced by substituting valid empty responses in a separate Node process: `buildBoard` returns zero players with `stale: false`. Such data can replace a previously useful cache entry. Partial projection loss can leave players with market prices but no recommendation or grade contribution.

Additionally, all sources are awaited even when the selected ADP feed does not use ESPN. ESPN has a failure catch but no application timeout. Its failure catch cannot help while a request remains pending. An uncached FFC failure also rejects the whole board even when Sleeper could provide the selected market prices and projections.

Freshness reporting is incomplete: ESPN's stale flag is excluded from the combined stale flag; Sleeper's combined fetch timestamp uses the newest position fetch rather than identifying the oldest component; and the stale warning appears in setup rather than alongside live advice.

Recommendation: validate position coverage, projection coverage, finite values, unique identities, and nonempty payloads before replacing a usable cache. Bound source fetch duration and define degraded operation according to the data required for the selected mode. Show per-source age, actual coverage, format borrowing, and failed refreshes where draft decisions are made.

Acceptance check: empty or malformed-success responses preserve a usable prior snapshot or fail clearly; a hung optional source does not block draft availability; stale selected sources remain visible during the draft.

### M5 - Medium priority: the grade and bye indicators omit substantial parts of a team's usefulness

**Yahoo-relevant, lower priority:** [the draft screen](../client/src/components/DraftScreen.tsx) calls `onFinish` when either mode completes, so these results are not confined to Mock draft. Improve live advice first; treat richer post-draft evaluation as later work.

Evidence: [grading](../client/src/engine/grade.ts), lines 39-70 and 117-120; [lineup total](../client/src/engine/roster.ts), `bestLineup`; [Sleeper-only board rows](../server/src/board.js), line 294.

The grade ranks a static season-total lineup, then spreads letters from A+ through D- by rank. A tiny projected difference can change the letter, and the room always has a winner. Bench coverage, weeks missed, replacement starts, weekly volatility, schedule, and playoff availability do not affect it. Missing projections contribute zero to lineup totals.

The inspected half-PPR board had 399 of 626 rows without a bye, because only FFC supplies that field in the current join. `countByeClashes` skips missing byes, so a low displayed clash count can mean missing information rather than a well-covered roster.

Recommended direction: label the existing grade as projected starting-lineup rank, expose missing-data coverage, and avoid implying a season win probability. Complete team bye mapping if retaining the clash indicator. Add weekly roster evaluation only as part of a defined, validated objective; do not over-prioritize avoiding bye overlaps at the expense of substantially better players.

## Source assessment

| Source | Useful role | Limits to preserve explicitly |
| --- | --- | --- |
| Sleeper projections | Deep point/stat coverage and a practical default input. | Single projection stream in this app; selected scoring may not match the league. The projections URL is not listed in the public API reference examined, so its schema/coverage needs validation. The repository attributes these projections to RotoWire; this review did not independently establish that upstream provenance. |
| Sleeper ADP | Baseline market ordering and deep pool coverage. | The request is not parameterized by team count. Its sample size/window are not exposed here. Different formats are borrowed when coverage is absent. |
| Fantasy Football Calculator | Another draft population, published dispersion, supported league sizes. | Data comes from mock selections; team counts map to 8, 10, 12, or 14. `timesDrafted` varies by player and is not used to qualify advice confidence. |
| ESPN ranks | A separate assessment to compare with the market. | Not another points projection. PPR is borrowed for half-PPR and dynasty. Mapping ranks onto market prices creates a synthetic price, not measured ADP. |
| Yahoo room ADP | Platform-specific information that can help anticipate Yahoo behavior. | Historical platform ADP is not a measurement of the current managers' preferences. Availability depends on the bridge; do not interpret a room label as a league-specific statistical sample. |
| Uploaded ranking file | A way to use the user's chosen research and make judgments beyond the default data. | Currently affects sorting and optional CPU ranking; it is not an input to recommendation value or grades. |

Primary references checked on 2026-09-07: [Sleeper's public API reference](https://docs.sleeper.com/) documents league scoring settings, drafts and players; [Sleeper's explanation of ADP versus expert rankings](https://sleeper.com/blog/what-does-adp-mean-in-fantasy-football/) distinguishes market behavior from player assessment and notes the importance of matching league settings. These support keeping the two questions separate. They do not establish that one source or strategy will win this user's league.

## Validation performed

Existing dependencies were present; no dependency installation or lockfile changes were needed. Node was `v24.19.0`. PowerShell blocks `npm.ps1`, so the equivalent `npm.cmd` entry point was used. RTK was unavailable; commands ran directly.

| Check | Result |
| --- | --- |
| `npm.cmd run serve -- status` | Existing service on 127.0.0.1:5178 reported current source. No server restart was needed. |
| `npm.cmd run typecheck` | Passed. |
| `npm.cmd --prefix client run lint` | Exit 0 with existing React/Hook warnings. Not warning-free. |
| `npm.cmd run server:test` | 14 passed. |
| `npm.cmd run bridge:test` | 7 passed. |
| `npm.cmd run engine:test` | Executed checks passed; the two suites requiring `client/fixtures.local.json` were skipped because that file is absent. |
| `npm.cmd run build` | Passed. |
| `npm.cmd run shots` | Passed; harness reported no console errors. Wide/narrow, theme, assistant and simulated Yahoo paths exercised. |
| Screenshot inspection | Inspected assistant-wide and mock-narrow player-pool images in `client/shots/`. These are ignored scratch artifacts. |
| Direct engine probes | Reproduced R2-R8 examples, the M1 two-pick counterexample, and R1's projection-field mismatch using the actual modules. |
| Isolated source probe | Reproduced R10's empty-success response using substituted fetch responses in a separate process. Temporary probe cache entries were removed. |

The direct probes ran JavaScript on standard input with `node --import ./client/node_modules/tsx/dist/loader.mjs --input-type=module` from the repository root. Synthetic fixtures used the inputs stated under each finding; they were not added to the permanent test suite. The board snapshot came from `GET /api/board?scoring=half-ppr&teams=12&year=2026`, using the service's available upstream cache, without forcing production source refreshes.

Snapshot: 626 rows, 625 with projected points, 226 of 227 FFC rows joined, 26 borrowed Sleeper ADPs, 603 ESPN-ranked rows, and 399 missing byes. FFC reported 2,879 drafts in its 2026-08-31 to 2026-09-05 window. These are observations of that snapshot, not permanent player counts or independent measurements of source accuracy.

Outstanding for Yahoo: a real Yahoo league draft with the user's actual roster/scoring, commissioner correction testing in a real room, and historical prediction/outcome validation. **DEFERRABLE:** the complete Sleeper real-league fixture run. Browser smoke tests use controlled scenarios and do not replace the Yahoo checks. R9 and the additional import/timeout paths in R1/R10 were assessed from source, not reproduced end to end. No remote CI, PR approval, or independent reviewer was obtained; no PR was created.

Scope update validation: rechecked the Yahoo board-building path, assistant forecast call, absence of imported future Yahoo keeper presets, and shared results-screen transition before assigning the labels above. This update changes only the report; the application gate results above are from the initial audit and were not rerun for these documentation edits. The impact ordering was checked against the applicability table, all 15 finding IDs, preserved evidence, and local file links.

## Recommended order by expected improvement to Yahoo pick accuracy

1. **Correct the league's scoring inputs (R1).** Confirm the actual Yahoo rules; correct the point calculations if they differ from the selected preset. Wrong scoring propagates into every valuation. Sleeper importer fixes remain deferred.
2. **Make positional WORTH comparable (R7).** Correct starter/flex allocation and distinguish a marginal starter from an available waiver replacement. This changes comparisons across the entire board.
3. **Choose the better resulting team (M1).** Compare marginal lineup improvement and candidate-conditioned continuations, instead of assuming worth plus waiting cost is optimal. This is the central change to the selection objective; validate it with the forecast repairs below.
4. **Protect roster completion and useful depth (R6).** Account for the quality already held and remaining choices; avoid backups displacing required starters and automatic queues ending at the positive-worth cutoff.
5. **Keep room knowledge when on the clock (R3).** Forecast to the next actual choice so the recommendation uses the Yahoo room at decision time.
6. **Measure the best survivor consistently (R4).** Remove false scarcity caused by comparing the points leader now with the ADP leader later.
7. **Honor zero simulated survival (R5).** Stop recycling players the forecast always loses into reachable targets with generic odds.
8. **Make the chosen player research influence advice (M2).** Define the role of personal ranks/projections and separate player assessment from market prices. Source accuracy must be evaluated rather than assumed.
9. **Repair duplicate identity and eligibility (R2).** Restore correct valuation and removal of affected players, including the reproduced Hunter case. Narrower coverage does not make the duplicate acceptable.
10. **Apply corrected Yahoo picks immediately (R9).** Keep availability and rosters correct when pick contents change without a change in count.
11. **Fix extreme-tail odds (R8).** Remove false certainty for unusually overdue players; this is a narrower probability defect.
12. **Measure real Yahoo effectiveness (M4).** Calibrate forecasts and evaluate strategies against held-out drafts/outcomes. This can change the estimated ranking above; it is required before claiming a winning advantage.
13. **Harden feed degradation and freshness (R10).** Preserve useful advice through bad or delayed source responses. This is primarily a reliability improvement when feeds misbehave.
14. **Improve result interpretation and bye coverage (M5).** Address misleading grade confidence and missing byes after the live selection issues. The assistant also displays these results.

For use before those changes, treat the app as a draft board and research aid. Verify league settings and player eligibility, use the Mine view to consult the rankings you trust, and manually assess recommendations and queue contents. Fixing the correctness issues is a higher priority than adding another ADP provider.

## Deferrable work and conditional formats

The following work does not need to delay Yahoo draft-assistant improvements:

- **Sleeper league import (R1):** automatic reception-format selection, dedicated-2QB detection, restricted-flex mapping, and import-warning coverage. The shared scoring and eligibility needed by the actual Yahoo league remain active.
- **Future keeper presets (R3):** the horizon extension for presets supplied by other workflows; the current Yahoo import supplies none.
- **Sleeper-specific validation (R9/M4):** populating the two skipped league fixtures, Sleeper correction scenarios, and Sleeper-specific forecast calibration.
- **Standalone Mock draft work:** mock-only opponent controls, pacing, rehearsal UI, and mock-specific ranking behavior. Shared board data, recommendation logic, and the CPU model used to forecast Yahoo opponents remain active.

**DEFERRABLE - Sleeper import path:** the importer retains reception points for display but does not carry the complete scoring rules into valuation. It selects standard, half PPR, or PPR primarily from receptions. Superflex overrides that selection with `2qb`.

### M3 - High priority for dynasty: the draft context is not modeled consistently

**CONDITIONAL for Yahoo; DEFERRABLE if this is a redraft league.** Dynasty is not exclusive to Sleeper or mock drafts, so choosing Yahoo alone does not settle applicability. No dynasty implementation is required for a Yahoo redraft assistant.

The dynasty board reads Sleeper dynasty half-PPR ADP, but recommended worth and grades still use a single season's half-PPR points. ESPN's dynasty selection is its redraft PPR table. Missing Sleeper ADPs can also be borrowed across redraft, superflex, and dynasty formats.

Thus the app can price the acquisition of a young player using dynasty ADP while assessing the benefit using only this season. Age-related future value, retention horizon, and future trade value are not in the objective. There is also no independent combination of dynasty, superflex, and reception scoring in the format label.

Recommended direction: either explicitly describe dynasty advice as a current-season contender view, or introduce a separate dynasty assessment based on dynasty-specific rankings/value and an agreed time horizon. Redraft editorial rankings should not vote as if they were dynasty assessments. Borrowed data should remain visible as a fallback with different meaning.
