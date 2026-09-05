// What the cache does when more than one caller wants the same cold key.
//
//   npm --prefix server test
//
// This is the one part of the cache no endpoint can show you. A live draft
// rebuilds the board every eight seconds and every rebuild asks for seven keys,
// so an upstream slower than the poll is the ordinary case, not the rare one,
// and what happens then is invisible from outside the process.
//
// The keys here are unique per run so every test starts genuinely cold, and the
// files they write are removed afterwards. Nothing reaches the network: the
// fetcher is supplied by the test.

import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cached } from './cache.js';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cache');
const HOUR = 60 * 60 * 1000;

const written = [];
let keys = 0;

/** A key nothing has cached yet, remembered so its file can be cleared away. */
function coldKey() {
  keys += 1;
  const key = `test_cache_${process.pid}_${keys}`;
  written.push(key);
  return key;
}

after(async () => {
  await Promise.all(written.map(
    (key) => unlink(join(CACHE_DIR, key + '.json')).catch(() => {}),
  ));
});

/**
 * A fetcher that counts its calls and hangs until released.
 *
 * The window this guards is the one where a fetch is under way and has not
 * answered, so a fetcher that resolves immediately would never open it.
 */
function slowFetcher(value) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetcher = async () => {
    fetcher.calls += 1;
    await gate;
    return value;
  };
  fetcher.calls = 0;
  fetcher.release = () => release();
  return fetcher;
}

test('ten callers on one cold key start one fetch', async () => {
  const key = coldKey();
  const fetcher = slowFetcher('a board');

  const all = Promise.all(Array.from({ length: 10 }, () => cached(key, HOUR, fetcher)));
  fetcher.release();
  const entries = await all;

  assert.equal(fetcher.calls, 1, 'the upstream was asked once');
  // The same entry, not ten copies of it: nine callers waited on the promise
  // the first one made rather than making their own.
  assert.ok(entries.every((e) => e === entries[0]));
  assert.equal(entries[0].value, 'a board');
});

test('a forced fetch does not join one already running', async () => {
  const key = coldKey();
  const fetcher = slowFetcher('a board');

  // Forcing exists to go past what is held. Joining a request already in flight
  // would hand back the very copy the caller asked to bypass.
  const joined = cached(key, HOUR, fetcher);
  const forced = cached(key, HOUR, fetcher, true);
  fetcher.release();
  await Promise.all([joined, forced]);

  assert.equal(fetcher.calls, 2);
});

test('a fetch that fails is not left in flight', async () => {
  const key = coldKey();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error('upstream down');
  };

  await assert.rejects(cached(key, HOUR, failing), /upstream down/);
  // A promise left in the map would hand the same failure to every later
  // caller, so a source that recovered would never be asked again.
  await assert.rejects(cached(key, HOUR, failing), /upstream down/);

  assert.equal(calls, 2);
});

test('a key already fetched is still not fetched again', async () => {
  const key = coldKey();
  const fetcher = slowFetcher('a board');
  fetcher.release();

  const first = await cached(key, HOUR, fetcher);
  const second = await cached(key, HOUR, fetcher);

  // Sharing a promise must not have cost the cache its actual job.
  assert.equal(fetcher.calls, 1);
  assert.equal(first.value, 'a board');
  assert.equal(second.value, 'a board');
});
