// What the board does when a feed answers badly.
//
//   npm --prefix server test
//
// The audit's R10, and the reason it is checked here rather than through the
// board endpoint: every case needs an upstream that misbehaves on purpose. A
// response that parses cleanly and carries nobody, a position with nothing
// projected in it, a socket that opens and never answers. None of those can be
// asked for from outside the process, and all three were being read as data.
//
// Nothing reaches the network: `fetch` is replaced for the length of each test.
// Every test uses a year of its own so its cache keys are genuinely cold --
// the memory cache outlives a test, and a warm key would answer before the
// stub was ever called -- and the files they write are removed afterwards.

import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildBoard } from './board.js';
import { fetchAdp } from './sources/ffc.js';
import { fetchProjections } from './sources/sleeper.js';
import { fetchEspnRanks } from './sources/espnRanks.js';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cache');
const HOUR = 60 * 60 * 1000;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const written = [];

/**
 * A year nothing has cached, and every key it will write.
 *
 * Kept well away from a real season so a run can never touch the copies a
 * draft is working from.
 */
let years = 0;
function coldYear() {
  years += 1;
  const year = 1900 + years;
  written.push(`ffc_half-ppr_12_${year}`, `espn_ranks_${year}`);
  for (const pos of POSITIONS) written.push(`sleeper_${year}_${pos}`);
  return year;
}

after(async () => {
  await Promise.all(written.map(
    (key) => unlink(join(CACHE_DIR, key + '.json')).catch(() => {}),
  ));
});

/** One market row, with only the fields the board reads. */
function adpRow({ name, position, adp }) {
  return {
    name,
    position,
    team: 'JAX',
    adp,
    adp_formatted: '1.01',
    stdev: 1.5,
    bye: 7,
    high: 1,
    low: 4,
    times_drafted: 40,
  };
}

/** One projection row, keyed to join with the market row of the same name. */
function projectionRow({ id, first, last, position, points = 100, adp = 2 }) {
  return {
    player_id: id,
    team: 'JAX',
    player: {
      first_name: first, last_name: last, position, fantasy_positions: [position],
    },
    stats: { pts_half_ppr: points, pts_ppr: points, gp: 17, adp_half_ppr: adp },
  };
}

const MARKET = {
  status: 'Success',
  players: [
    adpRow({ name: 'Jax Back', position: 'RB', adp: 1.5 }),
    adpRow({ name: 'Jax Catcher', position: 'WR', adp: 2.5 }),
  ],
};

/** Every position answers, so a whole-payload failure is the only variable. */
function projections(pos) {
  if (pos === 'RB') return [projectionRow({ id: '1', first: 'Jax', last: 'Back', position: 'RB' })];
  if (pos === 'WR') return [projectionRow({ id: '2', first: 'Jax', last: 'Catcher', position: 'WR' })];
  return [projectionRow({ id: '3' + pos, first: 'A', last: pos, position: pos, points: 50 })];
}

const RANKS = {
  players: [
    {
      defaultPositionId: 2,
      fullName: 'Jax Back',
      proTeamId: 30,
      draftRanksByRankType: { PPR: { rank: 1, auctionValue: 40 } },
      ownership: { averageDraftPosition: 1.4, percentOwned: 99 },
    },
    {
      defaultPositionId: 3,
      fullName: 'Jax Catcher',
      proTeamId: 30,
      draftRanksByRankType: { PPR: { rank: 2, auctionValue: 30 } },
      ownership: { averageDraftPosition: 2.6, percentOwned: 98 },
    },
  ],
};

/** What the ESPN fetcher caches: the small part it keeps of the payload above. */
const ESPN_ROWS = [
  {
    name: 'Jax Back',
    position: 'RB',
    team: 'JAX',
    ranks: { PPR: { rank: 1, auction: 40 } },
    adp: 1.4,
    percentOwned: 99,
  },
];

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const hangs = () => new Promise(() => {});

/** Which feed a URL belongs to, so a stub can answer one badly and the rest well. */
function feedOf(url) {
  if (url.includes('fantasyfootballcalculator')) return 'ffc';
  if (url.includes('api.sleeper.app')) return 'sleeper';
  if (url.includes('fantasy.espn.com')) return 'espn';
  return 'unknown';
}

/** The position a Sleeper URL is asking about. */
function positionOf(url) {
  return decodeURIComponent(url).replace(/.*position\[\]=/, '').replace(/&.*/, '');
}

/**
 * Answer every feed well, except where `answers` says otherwise.
 *
 * Returns the calls it saw, so a test can also ask what was sent rather than
 * only what came back.
 */
function stubFetch(answers = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const text = String(url);
    const feed = feedOf(text);
    calls.push({ feed, url: text, signal: opts.signal });
    const answer = answers[feed];
    if (answer) return answer(text, opts);
    if (feed === 'ffc') return ok(MARKET);
    if (feed === 'sleeper') return ok(projections(positionOf(text)));
    if (feed === 'espn') return ok(RANKS);
    throw new Error('nothing should reach ' + text);
  };
  calls.restore = () => { globalThis.fetch = real; };
  return calls;
}

/** Put a copy on disk as though it had been fetched `ageMs` ago. */
async function seed(key, value, ageMs) {
  await mkdir(CACHE_DIR, { recursive: true });
  const entry = { key, fetchedAt: Date.now() - ageMs, stale: false, value };
  await writeFile(join(CACHE_DIR, key + '.json'), JSON.stringify(entry), 'utf8');
  return entry.fetchedAt;
}

test('a market payload that names nobody keeps the copy on disk', async () => {
  const year = coldYear();
  const calls = stubFetch();
  try {
    const first = await fetchAdp({ format: 'half-ppr', teams: 12, year });
    assert.equal(first.players.length, 2);
    assert.equal(first.meta.stale, false);

    // Valid JSON, a Success status, and nobody in it. This used to be written
    // over the copy above and reported as current.
    calls.restore();
    const empty = stubFetch({ ffc: () => ok({ status: 'Success', players: [] }) });
    try {
      const second = await fetchAdp({ format: 'half-ppr', teams: 12, year, force: true });
      assert.equal(second.players.length, 2, 'the players from the good fetch survive');
      assert.equal(second.meta.stale, true, 'and the board is told they are old');
    } finally {
      empty.restore();
    }
  } finally {
    calls.restore();
  }
});

test('a position with nothing projected in it keeps the copy on disk', async () => {
  const year = coldYear();
  const calls = stubFetch();
  try {
    const first = await fetchProjections({ year });
    assert.equal(first.rows.length, 6);
    assert.equal(first.stale, false);

    // Rows, but not one of them projected to play. Downstream drops every one
    // of those, so the whole position would have gone missing quietly.
    calls.restore();
    const unprojected = stubFetch({
      sleeper: (url) => ok([{ ...projectionRow({
        id: '9', first: 'Not', last: 'Playing', position: positionOf(url),
      }), stats: { gp: 0 } }]),
    });
    try {
      const second = await fetchProjections({ year, force: true });
      assert.equal(second.rows.length, 6, 'the projections from the good fetch survive');
      assert.equal(second.stale, true);
    } finally {
      unprojected.restore();
    }
  } finally {
    calls.restore();
  }
});

test('a ranking payload with nobody ranked keeps the copy on disk', async () => {
  const year = coldYear();
  const calls = stubFetch();
  try {
    const first = await fetchEspnRanks({ format: 'half-ppr', year });
    assert.equal(first.byKey.size, 2);
    assert.equal(first.meta.stale, false);

    calls.restore();
    const unranked = stubFetch({ espn: () => ok({ players: [] }) });
    try {
      const second = await fetchEspnRanks({ format: 'half-ppr', year, force: true });
      assert.equal(second.byKey.size, 2, 'the ranks from the good fetch survive');
      assert.equal(second.meta.stale, true);
    } finally {
      unranked.restore();
    }
  } finally {
    calls.restore();
  }
});

test('every request carries a deadline', async () => {
  const year = coldYear();
  const calls = stubFetch();
  try {
    await buildBoard({
      format: 'half-ppr', teams: 12, year, adpSource: 'avg:sleeper,ffc,espn',
    });
  } finally {
    calls.restore();
  }

  // What is not checked here is the duration. A stub that ignores the signal
  // proves nothing about fifteen seconds, and waiting one out would put a
  // minute into this file to assert a constant.
  assert.deepEqual(
    [...new Set(calls.map((c) => c.feed))].sort(),
    ['espn', 'ffc', 'sleeper'],
    'all three feeds were asked',
  );
  for (const call of calls) {
    assert.ok(call.signal instanceof AbortSignal, call.feed + ' was given no deadline');
  }
});

// The one test here with a deadline of its own. What it guards against is a
// wait with no end, so without one a regression would hang this file rather
// than fail it. Ten times what a healthy run takes.
test('a feed that is not pricing the board does not hold it up', { timeout: 15_000 }, async () => {
  const year = coldYear();
  const calls = stubFetch({ espn: hangs });
  try {
    // ESPN never answers. Resolving at all is the assertion: this used to be
    // inside a `Promise.all`, so it waited for as long as the socket stayed up.
    const board = await buildBoard({
      format: 'half-ppr', teams: 12, year, adpSource: 'order:sleeper,ffc',
    });

    assert.ok(board.players.length >= 2, 'the two feeds that answered priced the board');
    assert.equal(board.meta.espn.pending, true, 'and the response says ESPN is still out');
    const espn = board.meta.feeds.find((f) => f.source === 'espn');
    assert.equal(espn.fetchedAt, null, 'a feed that never answered has no age');
    assert.equal(espn.counts, false);
  } finally {
    calls.restore();
  }
});

test('and one that is pricing it is waited for past that bound', async () => {
  const year = coldYear();
  const slow = (body, ms) => () => new Promise((resolve) => {
    setTimeout(resolve, ms, ok(body));
  });
  const calls = stubFetch({ espn: slow(RANKS, 2000) });
  try {
    const board = await buildBoard({
      format: 'half-ppr', teams: 12, year, adpSource: 'avg:sleeper,ffc,espn',
    });

    assert.ok(board.meta.espn.ranked >= 2, 'ESPN answered, late, and was used');
    assert.equal(board.meta.espn.pending, undefined);
    assert.equal(board.meta.feeds.find((f) => f.source === 'espn').counts, true);
  } finally {
    calls.restore();
  }
});

test('one stale position is not hidden behind five fresh ones', async () => {
  const year = coldYear();
  const old = await seed(`sleeper_${year}_QB`, projections('QB'), 20 * HOUR);

  // Every position answers except quarterbacks, whose copy on disk is the one
  // from twenty hours ago. Five sixths of this fetch is minutes old.
  const calls = stubFetch({
    sleeper: (url) => (positionOf(url) === 'QB'
      ? { ok: false, status: 503, json: async () => ({}) }
      : ok(projections(positionOf(url)))),
  });
  try {
    const out = await fetchProjections({ year });
    assert.equal(out.stale, true);
    assert.equal(out.fetchedAt, old, 'the reading is the oldest position, not the newest');
    assert.ok(Date.now() - out.fetchedAt > 19 * HOUR);
  } finally {
    calls.restore();
  }
});

test("a board's staleness is the staleness of the feeds pricing it", async () => {
  const year = coldYear();
  // Older than ESPN's six hours, so it is expired and refetched -- and the
  // fetch below fails, so what comes back is this copy, marked stale.
  await seed(`espn_ranks_${year}`, ESPN_ROWS, 7 * HOUR);

  const calls = stubFetch({ espn: () => ({ ok: false, status: 500, json: async () => ({}) }) });
  try {
    const priced = await buildBoard({
      format: 'half-ppr', teams: 12, year, adpSource: 'avg:sleeper,ffc,espn',
    });
    assert.equal(priced.meta.feeds.find((f) => f.source === 'espn').stale, true);
    assert.equal(priced.meta.stale, true, 'a stale feed that prices the board is the board');

    const decorated = await buildBoard({
      format: 'half-ppr', teams: 12, year, adpSource: 'order:sleeper,ffc',
    });
    const espn = decorated.meta.feeds.find((f) => f.source === 'espn');
    assert.equal(espn.stale, true, 'the same feed is still reported as old');
    assert.equal(espn.counts, false);
    assert.equal(decorated.meta.stale, false, 'but it is not pricing anything');
    assert.ok(decorated.meta.feeds.every((f) => f.source === 'espn' || f.fetchedAt > 0));
  } finally {
    calls.restore();
  }
});
