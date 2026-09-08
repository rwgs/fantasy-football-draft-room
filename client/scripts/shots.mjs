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
 * Post a league snapshot the way the reader bookmarklet does.
 *
 * Yahoo's own envelope, invented managers, and real players off the live board
 * so the cross-source join has real rows to find and the screenshot shows a
 * roster rather than a column of misses. Through the app's own origin, so this
 * knows no more about where the service runs than the browser does.
 */
async function postSnapshot(id, teams) {
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
   * Nine each, and the last three benched.
   *
   * The bench rows are the point of going past the starting slots: they render
   * differently, dimmed rather than hidden, and a fixture where every player is
   * started would photograph a path the app does not usually take. Which
   * position each is started at is left as their own, since the fixture is not
   * trying to be a legal lineup — the slots panel above is what says what a
   * legal one would be.
   */
  const HELD = 9;
  const BENCHED = 3;
  const rosters = Array.from({ length: teams }, (_, t) => ({
    fantasy_content: {
      team: [
        [{ team_key: key + '.t.' + (t + 1) }],
        {
          roster: {
            week: 3,
            is_editable: 1,
            0: {
              players: list(board.players.slice(t * HELD, (t + 1) * HELD)
                .map((p, i) => player(
                  p,
                  20000 + t * HELD + i,
                  i >= HELD - BENCHED ? 'BN' : p.position,
                ))),
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
      rosters,
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
  if ((body.rosters || []).length !== teams) {
    throw new Error('posted ' + teams + ' rosters and the service read '
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

  await page.addInitScript(([key, state]) => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [STORE, {
    mode: 'assistant',
    activeLeagueId: id,
    savedLeagues: [savedYahooLeague(id)],
  }]);

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
  await page.getByText('The Sunday League').waitFor({ state: 'visible', timeout: ROOM_WAIT });

  /*
   * The own-team mark is the acceptance criterion worth photographing, and the
   * fixture puts it on the second roster on purpose, so the shot has to reach
   * it. A failure here is the guid match having fallen back to a position.
   */
  await page.getByText('Gridiron Gulls').waitFor({ state: 'visible' });
  const marks = await page.locator('.season-roster-head .chip').count();
  if (marks !== 1) {
    throw new Error('expected exactly one roster marked as yours, found ' + marks);
  }

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
    // The user's own roster rather than the first, since the fixture puts the
    // two in different places on purpose.
    await shoot(page, '.season-roster:has(.chip)', 'season-roster');

    if (errors.length) failures.push('yahoo-season: ' + errors.join(' | '));
    await page.close();
  } catch (err) {
    failures.push('yahoo-season: ' + err.message);
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
