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
    if (errors.length) failures.push('yahoo-mock: ' + errors.join(' | '));
    await page.close();
  } catch (err) {
    failures.push('yahoo-mock: ' + err.message);
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
