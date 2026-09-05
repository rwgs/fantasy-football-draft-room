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

async function reachDraft(browser, mode, viewport) {
  const page = await browser.newPage({ viewport });
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
  ];

  for (const { mode, viewport, tag } of runs) {
    console.log(tag + ':');
    const { page, errors } = await reachDraft(browser, mode, viewport);
    await shoot(page, '.clock', tag + '-clock');
    await shoot(page, '.pool-col', tag + '-pool');
    await page.screenshot({ path: join(OUT, tag + '-full.png') });
    console.log('  ' + tag + '-full.png');
    if (errors.length) failures.push(tag + ': ' + errors.join(' | '));
    await page.close();
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
