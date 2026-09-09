/**
 * Drive the app in a real browser and photograph it.
 *
 * `AGENTS.md` asks for rendered evidence when a change is visible, and the two
 * screens worth photographing are both several clicks in: the draft screen only
 * exists once a draft has started, and the assistant differs from the mock in
 * what it puts on that screen. Getting there is the part worth keeping, not the
 * pictures, which are scratch and are ignored by git.
 *
 *   npm run dev        # both halves; the board is fetched from the service
 *   npm run shots      # writes client/shots/
 *
 * A console error is a failure here, not a footnote. A screen can photograph
 * perfectly while React complains underneath it, so the exit status covers both.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const APP = process.env.SHOTS_URL || 'http://localhost:5177';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots');

/** Wide enough for the three column layout, and a phone. */
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 430, height: 900 };

const START = { mock: 'Start mock draft', assistant: 'Follow the draft' };

/** Where the app keeps what you set. Seeded below to stand in for a last session. */
const STORE = 'draftroom.v1';
/** A Yahoo league saved in a previous session. Its room is long gone. */
const DEAD_LEAGUE = '900000001';
/** The seat the room below says the bridge is running in. */
const MY_SEAT = 7;
/** One beat of the wait for a room, and room to spare for the read that follows. */
const ROOM_WAIT = 30000;

/*
 * `colorScheme` drives the real `prefers-color-scheme`, not a class the harness
 * sets, so a light run exercises the path a light desk actually takes: the
 * default 'system' preference resolving through matchMedia.
 */
async function reachDraft(browser, mode, viewport, colorScheme = 'dark') {
  const page = await browser.newPage({ viewport, colorScheme });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  if (mode === 'assistant') {
    await page.getByRole('button', { name: /Draft assistant/ }).click();
  }

  // Starting is held until the board arrives, and the board is a live fetch
  // through the service. Waiting on the button is waiting on the real thing.
  await page.waitForFunction(
    (label) => [...document.querySelectorAll('button')]
      .some((b) => b.textContent.includes(label) && !b.disabled),
    START[mode],
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: START[mode] }).first().click();
  await page.locator('.clock').waitFor({ state: 'visible' });
  // The mock runs the room up to your turn before the clock settles.
  await page.waitForTimeout(600);

  return { page, errors };
}

/**
 * A Yahoo league the way one comes back with the page: an ID and nothing else.
 *
 * Every field the settings screen reads is here, because a missing one paints a
 * console error, and a console error is a failure in this script.
 */
function savedYahooLeague(id) {
  const settings = {
    id,
    draftId: id,
    previousLeagueId: null,
    isKeeper: false,
    maxKeepers: 0,
    name: 'Yahoo league ' + id,
    season: null,
    status: 'pre_draft',
    teams: 12,
    rounds: 15,
    roster: null,
    scoring: null,
    draftType: 'snake',
    rosterPositions: [],
    receptionPoints: 0,
    warnings: [],
  };
  return {
    id,
    name: settings.name,
    platform: 'yahoo',
    settings,
    fetchedAt: Date.now(),
    rankingSource: null,
    keepers: [],
    pendingKeepers: [],
    tradedPicks: [],
    myUserId: null,
    slots: [],
  };
}

/**
 * Post a room the way the bridge in a draft room tab does.
 *
 * The seat it runs in and the whole draft order, which is what the connect
 * burst carries and what the app waits for before it opens anything. Through
 * the app's own origin, so this needs to know no more about where the service
 * runs than the browser does.
 */
async function postRoom(id, teams, rounds, seat) {
  const order = [];
  for (let round = 1; round <= rounds; round += 1) {
    const down = Array.from({ length: teams }, (_, i) => i + 1);
    order.push(...(round % 2 ? down : down.reverse()));
  }
  const res = await fetch(APP + '/api/yahoo/room/' + id, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      team: seat,
      seats: Array.from({ length: teams }, (_, i) => ({
        id: i + 1, teamname: 'Team ' + (i + 1), manager: 'Manager ' + (i + 1),
      })),
      frames: ['H|S|30|0|0|0', 'R|' + order.join('|')],
    }),
  });
  if (!res.ok) throw new Error('the service refused the room: ' + res.status);
}

/**
 * The pool, posted separately because that is how it arrives.
 *
 * The bridge sends the seats and the order on connect and the pool whenever it
 * manages to read it, and a service restarted mid-draft is sent the pool again
 * on its own, long after the board opened. The pool is the only thing in a room
 * carrying Yahoo's own ADP, so it alone decides whether the room can price a
 * board — which is why the app has to keep asking rather than take the answer
 * it got when the board was built.
 *
 * Built off the real board so the ADP lands on real players, the way the
 * bridge's does.
 */
async function postPool(id) {
  const res = await fetch(APP + '/api/board?scoring=ppr&teams=12&adpSource=sleeper');
  if (!res.ok) throw new Error('no board to build a pool from: ' + res.status);
  const board = await res.json();
  const pool = board.players.slice(0, 8).map((p, i) => {
    const [fname, ...rest] = p.name.split(' ');
    return {
      id: String(9000 + i),
      fname,
      lname: rest.join(' '),
      display_pos: p.position,
      team_abbr: p.team,
      adp: 10 + i,
      rank: i + 1,
    };
  });
  const sent = await fetch(APP + '/api/yahoo/room/' + id, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pool, frames: [] }),
  });
  if (!sent.ok) throw new Error('the service refused the pool: ' + sent.status);
}

/**
 * A Yahoo mock, from a room that does not exist yet to a board that follows it.
 *
 * The only path here that no other check can reach. `engine:test` asks the
 * service the questions a caller asks and renders nothing, and everything below
 * is about when the app decides to open the board, which is where it went
 * wrong: a ticked box and a league ID restored from the last session were taken
 * as evidence of a room, so the board opened on a dead league and the real mock
 * was never picked up.
 *
 * Three steps, in one page because they are one behaviour. A league that came
 * back with the page opens nothing. A number typed before the draft room tab is
 * up waits rather than failing. The room appearing opens the board by itself,
 * in the seat the room says is yours.
 */
async function yahooMock(browser, viewport) {
  const live = String(Date.now()).slice(-9);
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.addInitScript(([key, state]) => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [STORE, {
    mode: 'assistant',
    yahooMock: true,
    activeLeagueId: DEAD_LEAGUE,
    savedLeagues: [savedYahooLeague(DEAD_LEAGUE)],
  }]);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  // The board is a live fetch, and nothing can be decided before it lands.
  await page.waitForFunction(
    (label) => [...document.querySelectorAll('button')]
      .some((b) => b.textContent.includes(label) && !b.disabled),
    START.assistant,
    { timeout: 60000 },
  );
  await page.waitForTimeout(500);
  if (await page.locator('.clock').count()) {
    throw new Error('the board opened on a league restored from the page, with no room behind it');
  }

  await page.getByRole('button', { name: 'Yahoo', exact: true }).click();
  if (!await page.getByRole('checkbox', { name: /Yahoo mock draft/ }).isChecked()) {
    throw new Error('the mock box did not come back ticked');
  }

  await page.locator('#leagueId').fill(live);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Waiting for the room').waitFor({ state: 'visible' });
  if (await page.locator('.clock').count()) {
    throw new Error('the board opened on a room nobody has posted');
  }
  await page.screenshot({ path: join(OUT, 'yahoo-mock-waiting.png') });
  console.log('  yahoo-mock-waiting.png');

  // The draft room tab, two or three minutes later.
  await postRoom(live, 12, 15, MY_SEAT);
  await page.locator('.clock').waitFor({ state: 'visible', timeout: ROOM_WAIT });

  const slot = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).league.mySlot,
    STORE,
  );
  if (slot !== MY_SEAT) {
    throw new Error('the board opened in seat ' + slot + ', not the ' + MY_SEAT
      + ' the room reported');
  }

  /*
   * THE ROOM FEED, WHICH ARRIVES AFTER THE BOARD THAT REPORTS IT.
   *
   * A board says which feeds it could have used as of the moment it was built,
   * and this one was built while the room held no ADP at all. So the control is
   * dead here, correctly. It used to stay dead: nothing the board is keyed on
   * moves when a pool lands, and a live Yahoo draft would run for an hour
   * behind a chip saying it needed a live draft to follow.
   */
  const roomChip = page.getByRole('button', { name: 'Your draft room', exact: true });
  if (await roomChip.isEnabled()) {
    throw new Error('the room was offered as a feed before any pool was posted');
  }

  await postPool(live);
  await page.waitForFunction(
    (label) => [...document.querySelectorAll('button')]
      .some((b) => b.textContent.trim() === label && !b.disabled),
    'Your draft room',
    { timeout: ROOM_WAIT },
  );

  return { page, errors };
}

/**
 * The league the screen is showing, by name.
 *
 * Not `getByText`, which now matches twice: the header says which league is on
 * screen and a picker chip says which leagues have been read. Waiting on the
 * chip would pass while the screen showed nothing at all, which is exactly the
 * failure the switch check below exists to catch.
 */
function shownLeague(page, name) {
  return page.locator('.season-head b', { hasText: name });
}

/**
 * Post a league snapshot the way the reader bookmarklet does.
 *
 * Yahoo's own envelope, invented managers, and real players off the live board
 * so the cross-source join has real rows to find and the screenshot shows a
 * roster rather than a column of misses. Through the app's own origin, so this
 * knows no more about where the service runs than the browser does.
 */
async function postSnapshot(id, teams, { old = false } = {}) {
  const res = await fetch(APP + '/api/board?scoring=ppr&teams=12&adpSource=sleeper');
  if (!res.ok) throw new Error('no board to build a snapshot from: ' + res.status);
  const board = await res.json();
  const list = (items) => {
    const out = { count: items.length };
    items.forEach((item, i) => { out[String(i)] = item; });
    return out;
  };
  const key = '470.l.' + id;
  const player = (p, n, slot) => ({
    player: [
      [
        { player_key: '470.p.' + n }, { player_id: String(n) },
        { name: { full: p.name } }, { editorial_team_abbr: p.team },
        { display_position: p.position }, { primary_position: p.position },
        { eligible_positions: [{ position: p.position }] },
        { bye_weeks: { week: String(p.bye ?? 7) } },
      ],
      { selected_position: [{ position: slot }] },
    ],
  });

  /*
   * Nine each, benched in the MIDDLE, which is the part that matters.
   *
   * Yahoo returns a roster in its own order, and that order puts a started
   * kicker and defence *after* the eight bench players, observed in a real
   * league. So the fixture mirrors it: two benched players with a started one
   * behind them. A fixture that put the bench last would photograph a screen
   * that happened to look right, and would not have caught the bug at all.
   *
   * The bench rows earn their place twice over, since they render dimmed rather
   * than hidden. Which position each starter is started at is left as their
   * own; the fixture is not trying to be a legal lineup, and the slots panel is
   * what says what a legal one would be.
   */
  const HELD = 9;
  const BENCHED = new Set([6, 7]);

  /*
   * A KICKER AND A DEFENCE, INVENTED RATHER THAN TAKEN OFF THE BOARD, and
   * posted last of all so they land behind the bench exactly as Yahoo sends
   * them. The board is ADP order and neither position comes anywhere near the
   * top of it, so nine real players are nine skill players and the two slots
   * this app can say least about were the two the fixture never held.
   *
   * They are what makes the ordering checkable. No desk projects either, so
   * they are not seats a lineup can be advised into -- which is precisely how
   * the week's table came to sort them below the bench, having ranked the
   * roster by the seats rather than by the league's own slot list.
   */
  const UNSCORED = [
    { name: 'Cameron Dicker', team: 'LAC', position: 'K', bye: 12 },
    { name: 'Denver Broncos', team: 'DEN', position: 'DEF', bye: 12 },
  ];

  const rosters = Array.from({ length: teams }, (_, t) => ({
    fantasy_content: {
      team: [
        [{ team_key: key + '.t.' + (t + 1) }],
        {
          roster: {
            week: 3,
            is_editable: 1,
            0: {
              players: list([
                ...board.players.slice(t * HELD, (t + 1) * HELD).map((p, i) => player(
                  p,
                  20000 + t * HELD + i,
                  BENCHED.has(i) ? 'BN' : p.position,
                )),
                ...UNSCORED.map((p, i) => player(p, 29000 + t * UNSCORED.length + i, p.position)),
              ]),
            },
          },
        },
      ],
    },
  }));

  const sent = await fetch(APP + '/api/yahoo/league/' + id + '/snapshot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      settings: {
        fantasy_content: {
          league: [
            {
              league_key: key, league_id: id, name: 'The Sunday League', game_code: 'nfl',
              season: '2026', num_teams: teams, scoring_type: 'head', current_week: 3,
              start_week: '1', end_week: '18',
            },
            {
              settings: [{
                roster_positions: [
                  { roster_position: { position: 'QB', count: 1, is_starting_position: 1 } },
                  { roster_position: { position: 'RB', count: 2, is_starting_position: 1 } },
                  { roster_position: { position: 'WR', count: 2, is_starting_position: 1 } },
                  { roster_position: { position: 'TE', count: 1, is_starting_position: 1 } },
                  { roster_position: { position: 'W/R/T', count: 1, is_starting_position: 1 } },
                  { roster_position: { position: 'K', count: 1, is_starting_position: 1 } },
                  { roster_position: { position: 'DEF', count: 1, is_starting_position: 1 } },
                  { roster_position: { position: 'BN', count: 8, is_starting_position: 0 } },
                  { roster_position: { position: 'IR', count: 2, is_starting_position: 0 } },
                ],
                stat_categories: {
                  stats: [
                    { stat: { stat_id: 4, name: 'Passing Yards', abbr: 'Yds', enabled: '1' } },
                    { stat: { stat_id: 5, name: 'Passing Touchdowns', abbr: 'TD', enabled: '1' } },
                    { stat: { stat_id: 11, name: 'Receptions', abbr: 'Rec', enabled: '1' } },
                    { stat: { stat_id: 78, name: 'Targets', abbr: 'Tgt', enabled: '1' } },
                  ],
                },
                stat_modifiers: {
                  stats: [
                    { stat: { stat_id: 4, value: '0.04' } },
                    { stat: { stat_id: 5, value: '4' } },
                    { stat: { stat_id: 11, value: '0.5' } },
                    /*
                     * Priced on purpose, and it is what makes the advice's
                     * limits real rather than theoretical. No desk publishes
                     * targets, so a league that scores them has a rule missing
                     * from every projected total -- and the screen has to say
                     * so instead of counting it as zero. Left unpriced this
                     * category is a rule the league counts at nothing, which
                     * cannot make a total wrong and is correctly not reported.
                     */
                    { stat: { stat_id: 78, value: '0.5' } },
                  ],
                },
                waiver_type: 'FR', waiver_rule: 'continuous', uses_faab: '0',
                trade_end_date: '2026-11-27',
              }],
            },
          ],
        },
      },
      teams: {
        fantasy_content: {
          league: [
            { league_key: key },
            {
              teams: list(Array.from({ length: teams }, (_, t) => ({
                team: [[
                  { team_key: key + '.t.' + (t + 1) }, { team_id: String(t + 1) },
                  { name: t === 1 ? 'Gridiron Gulls' : 'Team ' + (t + 1) },
                  { waiver_priority: t + 1 }, { number_of_moves: t }, { number_of_trades: 0 },
                  { managers: [{ manager: { guid: t === 1 ? 'GUID-MINE' : 'GUID-' + t } }] },
                ]],
              }))),
            },
          ],
        },
      },
      // `rosters` normally, and the singular `roster` for the shape a
      // bookmarklet too old to send every roster posts.
      ...(old ? { roster: rosters[0] } : { rosters }),
      /*
       * The second team is the user's, so the screenshot shows the own-team
       * mark landing somewhere other than first. That is the whole point of
       * matching on the guid rather than on a position in the list, and a
       * fixture where the user happened to be first would photograph the same
       * either way.
       */
      profile: { fantasy_content: { users: { count: 1, 0: { user: [{ guid: 'GUID-MINE' }] } } } },
    }),
  });
  /*
   * The reply is read, and not only for the status.
   *
   * Read because it says how much of the snapshot survived, which turns the
   * post into a check: a screenshot of eight empty rosters would photograph
   * perfectly. And read because leaving a response body unconsumed tripped
   * Node's own HTTP parser here — `assert(!this.paused)` out of undici on
   * socket close, which looks like nothing to do with this code.
   */
  const body = await sent.json().catch(() => ({}));
  if (!sent.ok) throw new Error('the service refused the snapshot: ' + sent.status);
  const want = old ? 1 : teams;
  if ((body.rosters || []).length !== want) {
    throw new Error('posted ' + want + ' rosters and the service read '
      + (body.rosters || []).length);
  }
}

/**
 * The in-season league view, in both of its states.
 *
 * The empty one first and deliberately: "nothing read yet" is the state every
 * user meets before they have run the bookmarklet, and the failure it has to
 * avoid is looking like a league with no teams in it. Then the same screen with
 * a league behind it.
 */
async function yahooSeason(browser, viewport) {
  const id = String(Date.now()).slice(-9);
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  /*
   * `seasonLeagueId` and nothing else. The in-season league is its own setting,
   * because borrowing the draft's active league made the screen unreachable in
   * season: a Yahoo league becomes active only once its draft settings import,
   * and importing them needs a posted draft room. Nothing about a draft is
   * seeded here, which is the point.
   */
  await page.addInitScript(([key, state]) => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [STORE, { mode: 'assistant', savedLeagues: [], activeLeagueId: null, seasonLeagueId: id }]);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  const open = page.getByRole('button', { name: 'My league in season' });
  await open.waitFor({ state: 'visible', timeout: 60000 });
  await open.click();

  /*
   * ONE LEAGUE AND ONE PAGE, WHICH IS ALSO THE REAL JOURNEY.
   *
   * The empty state comes first because it is the one every user meets before
   * they have run the bookmarklet, and the failure it exists to avoid is
   * looking like a league with no teams in it. Then the snapshot is posted the
   * way the bookmarklet posts one and the same screen is asked again, which is
   * exactly what a user does: install, click, come back, press Read again.
   *
   * No reload and no reaching into storage between the two. `addInitScript`
   * runs on every navigation, so a reload puts the seeded state back and
   * silently undoes anything set since — which cost a run here.
   */
  await page.getByText('Nothing read yet').waitFor({ state: 'visible', timeout: ROOM_WAIT });
  await page.screenshot({ path: join(OUT, 'season-unread.png') });
  console.log('  season-unread.png');

  await postSnapshot(id, 8);
  await page.getByRole('button', { name: 'Read again' }).click();
  await shownLeague(page, 'The Sunday League').waitFor({ state: 'visible', timeout: ROOM_WAIT });

  // And the league now appears in the picker as something to click rather than
  // type, which is how the app learns a league exists at all.
  const offered = page.locator('.season-held .chip');
  if (!await offered.count()) {
    throw new Error('a league that has been read was not offered in the picker');
  }

  /*
   * The starting lineup has to read as one block, and the fixture posts it in
   * Yahoo's order, which does not. Reported from a real league: the started
   * kicker and defence came back after the eight bench players, so the two
   * slots hardest to guess at sat furthest from the top.
   */
  const slotColumn = await page.locator('.season-roster').first()
    .locator('tbody tr td:first-child')
    .allInnerTexts();
  const bench = slotColumn.findIndex((slot) => slot.trim() === 'BN');
  if (bench < 0) throw new Error('the fixture benched nobody, so this checks nothing');
  const startedAfter = slotColumn.slice(bench + 1).filter((slot) => slot.trim() !== 'BN');
  if (startedAfter.length) {
    throw new Error('a started player sits below the bench: ' + startedAfter.join(', ')
      + ' in ' + slotColumn.join(' '));
  }

  /*
   * THE ADVICE, WHICH IS THE ONE THING ON THIS SCREEN THAT RECOMMENDS
   * ANYTHING, so it is also the one worth photographing most.
   *
   * It arrives on its own request, after the league and behind two projection
   * desks, so the wait is for the desks rather than for the section: the
   * heading renders immediately saying it is working it out.
   *
   * What is asserted is deliberately not "a move was advised". The fixture's
   * players are real and their projections are live, so which move is best
   * changes week to week and a check on the number would fail for the wrong
   * reason. What must hold whatever the numbers say is that the limits are
   * stated: this fixture starts a kicker and a defence, which no desk projects,
   * and scores targets, which none publishes.
   */
  await page.getByRole('heading', { name: 'This week' })
    .waitFor({ state: 'visible', timeout: ROOM_WAIT });
  const desks = page.locator('.season-desk');
  await desks.first().waitFor({ state: 'visible', timeout: ROOM_WAIT });
  await page.screenshot({ path: join(OUT, 'season-advice.png') });
  console.log('  season-advice.png');

  /*
   * THE OWN-TEAM MARK, WHICH MOVED WITH THE ROSTER IT MARKS. The user's team is
   * named in the week's panel and listed nowhere else, so the acceptance
   * criterion is checked in both directions: the right name at the top, and no
   * roster below still wearing the mark.
   *
   * The fixture makes the *second* team the user's on purpose. A guid match
   * that had quietly fallen back to a position would name the first, so the
   * name is the whole of the check and a count of rosters is not.
   */
  const weekPanel = page.locator('.panel', { has: page.getByRole('heading', { name: 'This week' }) });
  const weekHead = weekPanel.locator('.panel-head');
  await weekHead.getByText('Gridiron Gulls').waitFor({ state: 'visible' });
  if (await weekHead.locator('.chip').count() !== 1) {
    throw new Error("the week's panel does not mark the team it advises on as yours");
  }
  const marks = await page.locator('.season-roster-head .chip').count();
  if (marks) {
    throw new Error("the user's own roster is still listed among the rivals, " + marks + ' marked');
  }
  const rivals = await page.locator('.season-roster').count();
  if (rivals !== 7) {
    throw new Error('expected the other 7 of 8 rosters listed, found ' + rivals);
  }

  /*
   * NOBODY IS BENCHED AND STARTED IN THE SAME TABLE.
   *
   * Read off the rendered rows rather than the endpoint, because this defect
   * has twice been visible on screen while every check passed. It is the one
   * place that tells the user what to do, and a player started in place of
   * himself reads as a bug in the app.
   *
   * This fixture is why the check is here and not in `engine:test`: it starts a
   * receiver at `WR` that the best lineup wants in the flex, so the slot change
   * is real on live projections. `engine:test`'s own fixture produces no
   * relocation and the same assertion passes there against the pre-fix code.
   */
  for (const block of await page.locator('.season-desk').all()) {
    const out = [];
    const going = [];
    for (const row of await block.locator('.season-table tbody tr').all()) {
      const cells = (await row.locator('td').allInnerTexts()).map((cell) => cell.trim());
      if (cells.length < 3) continue;
      // The screen's word for nobody coming out, which is not a player.
      if (cells[1] && cells[1] !== 'nobody') out.push(cells[1]);
      if (cells[2]) going.push(cells[2]);
    }
    const both = out.filter((name) => going.includes(name));
    if (both.length) {
      throw new Error('a desk benches and starts the same player: ' + both.join(', '));
    }
  }

  /*
   * AND THE WEEK'S OWN TABLE READS AS A LINEUP TOO, which is the same check as
   * the roster one above and had to be made twice because the two tables
   * ordered themselves from different lists. The roster took the league's slot
   * list and was right; this one took the seats a lineup can be advised into,
   * which deliberately exclude the kicker and the defence because no desk
   * projects them -- so both sorted last, below eight benched players, in the
   * table the reader is meant to check the advice against.
   *
   * The roster is the last table in the panel, which is what finds it: the
   * desks' own tables of swaps come first, then the disputed one, and the
   * roster closes the panel. Taking the last rather than counting them means a
   * desk that fails to answer takes its block away without moving the target.
   */
  const weekRows = await weekPanel.locator('.season-table').last().locator('tbody tr').all();
  const weekSlots = [];
  for (const row of weekRows) {
    const cells = await row.locator('td').allInnerTexts();
    weekSlots.push(cells[0].trim());
  }
  const sat = weekSlots.findIndex((slot) => slot === 'BN');
  if (sat < 0) {
    throw new Error("the week's table benched nobody, so this checks nothing: " + weekSlots.join(' '));
  }
  const below = weekSlots.slice(sat + 1).filter((slot) => slot !== 'BN' && slot !== 'IR');
  if (below.length) {
    throw new Error("a started player sits below the bench in the week's table: "
      + below.join(', ') + ' in ' + weekSlots.join(' '));
  }

  /*
   * A kicker and a defence slot get no advice at all, and the screen has to say
   * so rather than leave two seats quietly missing from a nine-slot lineup.
   * Y9.1 could not reproduce either position's components against a feed's own
   * published points, so this is a permanent limit and not a gap to fix.
   */
  const limits = await page.locator('.panel', { has: page.getByRole('heading', { name: 'This week' }) })
    .innerText();
  for (const said of ['K', 'DEF']) {
    if (!limits.includes(said)) {
      throw new Error('the advice does not say ' + said + ' gets none: ' + limits.slice(0, 400));
    }
  }
  if (!limits.includes('Targets')) {
    throw new Error('a league rule no desk publishes went unmentioned: ' + limits.slice(0, 400));
  }
  /*
   * And that nothing is known about locks, which is the ordinary case rather
   * than an edge one: Yahoo publishes no kickoff time at any scope. Advice
   * offered as though nothing had locked is advice to make moves Yahoo refuses.
   */
  if (!limits.includes('locked')) {
    throw new Error('the advice does not say whether locks are known: ' + limits.slice(0, 400));
  }

  return { page, errors };
}

/**
 * The in-season view's failure states, which are the ones worth photographing.
 *
 * The happy path above shows a league. These are what the same screen says when
 * it cannot, and each has a wrong answer that looks right: a stale bookmarklet
 * reading as Yahoo having failed, a service that forgot a league reading as one
 * never read, and a league switch leaving the last league's rosters on screen
 * under the new one's name.
 *
 * One page and no reloads. `addInitScript` runs on every navigation, so a reload
 * puts the seeded state back and undoes anything the page has done since.
 */
async function yahooSeasonFailures(browser, viewport) {
  const stale = String(Date.now()).slice(-9);
  const fresh = String(Date.now() + 1).slice(-9);
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.addInitScript(([key, state]) => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [STORE, {
    mode: 'assistant', savedLeagues: [], activeLeagueId: null, seasonLeagueId: stale,
  }]);

  // A bookmarklet too old to send every roster, which is the likeliest failure
  // this reader has: a bookmarklet carries its source in the address it was
  // dragged from and can never update itself.
  await postSnapshot(stale, 8, { old: true });

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  const open = page.getByRole('button', { name: 'My league in season' });
  await open.waitFor({ state: 'visible', timeout: 60000 });
  await open.click();

  await shownLeague(page, 'The Sunday League').waitFor({ state: 'visible', timeout: ROOM_WAIT });
  const behind = page.locator('.banner.is-bad').filter({ hasText: 'old copy' });
  if (!await behind.count()) {
    throw new Error('an old reader sent one roster and the screen did not say so');
  }
  await page.screenshot({ path: join(OUT, 'season-reader-behind.png') });
  console.log('  season-reader-behind.png');

  /*
   * NOW THE SERVICE FORGETS IT, WHICH IS WHAT A RESTART DOES.
   *
   * Snapshots are memory only and bounded at eight, so eight more evict this
   * one. From the service's side an evicted league and one lost to a restart
   * are the same answer; the app is the only thing that can tell them from a
   * league never read, because it was holding the reading.
   */
  for (let i = 0; i < 8; i += 1) {
    await postSnapshot(String(Date.now() + 100 + i).slice(-9), 1);
  }
  await page.getByRole('button', { name: 'Read again' }).click();
  await page.getByText('The reading is gone').waitFor({ state: 'visible', timeout: ROOM_WAIT });
  await page.screenshot({ path: join(OUT, 'season-forgotten.png') });
  console.log('  season-forgotten.png');

  /*
   * AND A LEAGUE SWITCH, WHICH MUST NOT SHOW THE LAST LEAGUE'S STATE.
   *
   * Read one league, switch to another that has never been read, and the screen
   * has to be empty. Left to itself the reading outlives the switch, and a
   * failed fetch would leave it up for good.
   */
  await postSnapshot(stale, 8);
  await page.getByRole('button', { name: 'Read again' }).click();
  await shownLeague(page, 'The Sunday League').waitFor({ state: 'visible', timeout: ROOM_WAIT });

  /*
   * The switch, on the screen's own picker rather than through the draft's
   * league control. It used to need a posted draft room and the Yahoo platform
   * chosen first, because the screen borrowed the active league and that only
   * moves when draft settings import -- which is the defect the picker
   * replaced. Typing a number is now the whole of it.
   */
  await page.locator('#seasonLeagueId').fill(fresh);
  await page.getByRole('button', { name: 'Read this league' }).click();

  await page.getByText('Nothing read yet').waitFor({ state: 'visible', timeout: ROOM_WAIT });
  if (await shownLeague(page, 'The Sunday League').count()) {
    throw new Error('switching leagues left the last one on screen');
  }
  // And it is not called forgotten either: this league was never read, and the
  // two states have different fixes.
  if (await page.getByText('The reading is gone').count()) {
    throw new Error('a league never read was reported as one the service forgot');
  }
  await page.screenshot({ path: join(OUT, 'season-switched.png') });
  console.log('  season-switched.png');

  return { page, errors };
}

async function shoot(page, selector, name) {
  await page.locator(selector).screenshot({ path: join(OUT, name + '.png') });
  console.log('  ' + name + '.png');
}

async function main() {
  const health = await fetch(APP).catch(() => null);
  if (!health?.ok) {
    console.error('Nothing is answering on ' + APP + '. Start it with: npm run dev');
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];

  const runs = [
    { mode: 'mock', viewport: WIDE, tag: 'mock-wide' },
    { mode: 'mock', viewport: NARROW, tag: 'mock-narrow' },
    { mode: 'assistant', viewport: WIDE, tag: 'assistant-wide' },
    { mode: 'mock', viewport: WIDE, tag: 'mock-wide-light', colorScheme: 'light' },
    { mode: 'mock', viewport: NARROW, tag: 'mock-narrow-light', colorScheme: 'light' },
  ];

  for (const { mode, viewport, tag, colorScheme } of runs) {
    console.log(tag + ':');
    const { page, errors } = await reachDraft(browser, mode, viewport, colorScheme);
    const painted = await page.evaluate(() => document.documentElement.dataset.theme);
    const wanted = colorScheme === 'light' ? 'light' : 'dark';
    if (painted !== wanted) failures.push(tag + ': board painted ' + painted + ', wanted ' + wanted);
    await shoot(page, '.clock', tag + '-clock');
    await shoot(page, '.pool-col', tag + '-pool');
    await page.screenshot({ path: join(OUT, tag + '-full.png') });
    console.log('  ' + tag + '-full.png');
    if (errors.length) failures.push(tag + ': ' + errors.join(' | '));
    await page.close();
  }

  /*
   * The switch is three states on one button, and the third is the one worth
   * checking: an override has to be able to hand the app back to the machine.
   */
  console.log('theme-toggle:');
  {
    const page = await browser.newPage({ viewport: WIDE, colorScheme: 'light' });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    const btn = page.locator('.theme-toggle');
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      seen.push(await page.evaluate(() => document.documentElement.dataset.theme)
        + '/' + (await btn.textContent()).trim());
      await btn.click();
    }
    const want = ['light/Theme: auto', 'light/Theme: light', 'dark/Theme: dark', 'light/Theme: auto'];
    if (seen.join(' ') !== want.join(' ')) {
      failures.push('theme-toggle: cycled ' + seen.join(' -> ') + ', wanted ' + want.join(' -> '));
    } else {
      console.log('  auto -> light -> dark -> auto, on a light machine');
    }
    if (errors.length) failures.push('theme-toggle: ' + errors.join(' | '));
    await page.close();
  }

  console.log('yahoo-mock:');
  try {
    const { page, errors } = await yahooMock(browser, WIDE);
    await shoot(page, '.clock', 'yahoo-mock-clock');
    await page.screenshot({ path: join(OUT, 'yahoo-mock-full.png') });
    console.log('  yahoo-mock-full.png');

    /*
     * The queue control, switched on.
     *
     * Off it is three chips saying nothing, and off is what the shot above
     * already holds. On is where it posts to the service, reports what the room
     * holds, and grows a second row — so it is the state worth a photograph and
     * the one where a fault would show as a console error rather than a
     * difference in the picture.
     */
    await page.getByRole('button', { name: 'Autodraft', exact: true }).click();
    await page.locator('.queue-writer-state').waitFor({ state: 'visible' });
    await shoot(page, '.queue-writer', 'yahoo-queue');

    if (errors.length) failures.push('yahoo-mock: ' + errors.join(' | '));
    await page.close();
  } catch (err) {
    failures.push('yahoo-mock: ' + err.message);
  }

  console.log('yahoo-season:');
  try {
    const { page, errors } = await yahooSeason(browser, WIDE);
    await page.screenshot({ path: join(OUT, 'season-full.png'), fullPage: true });
    console.log('  season-full.png');
    // The user's own roster, which is the week's panel: it is not in the list
    // below, because everything that list would say about it is said there.
    await shoot(page, '.panel:has(.season-desk)', 'season-roster');

    if (errors.length) failures.push('yahoo-season: ' + errors.join(' | '));
    await page.close();
  } catch (err) {
    failures.push('yahoo-season: ' + err.message);
  }

  console.log('yahoo-season-failures:');
  try {
    const { page, errors } = await yahooSeasonFailures(browser, WIDE);
    if (errors.length) failures.push('yahoo-season-failures: ' + errors.join(' | '));
    await page.close();
  } catch (err) {
    failures.push('yahoo-season-failures: ' + err.message);
  }

  await browser.close();

  if (failures.length) {
    console.error('\nThe browser reported errors:');
    for (const f of failures) console.error('  ' + f);
    process.exitCode = 1;
    return;
  }
  console.log('\nNo console errors. Shots are in client/shots/.');
}

await main();
