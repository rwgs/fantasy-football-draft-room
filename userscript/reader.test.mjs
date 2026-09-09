// The league reader, run against a Yahoo league that is not there.
//
//   npm run reader:test
//
// The companion to `bridge.test.mjs` and it exists for the same reason: this
// file runs inside a page the repository does not own, and until the reader
// grew a beat the only thing that had ever exercised it was clicking it.
//
// A beat is worth checking rather than trusting. A reader that stops
// rescheduling looks exactly like one that is working -- the panel still says
// it is reading every ten minutes, the last reading on screen is still correct,
// and the only symptom is a snapshot that quietly ages. So what is checked here
// is the scheduling itself: that it comes back, that `never` means never, and
// that the bookmarklet copy never starts a beat whatever the setting says.
//
// THE REAL FILE, WITH THE REAL STAMPS. The two substitutions the service makes
// on the way out are made here the same way, because the mode stamp is what
// decides the behaviour under test and a test that set it some other way would
// be checking a path the service never serves.
//
// NOTHING INSIDE IT IS STUBBED. The environment is supplied and the file is
// not: `document`, `window`, `location` and `fetch` are passed in as parameters
// of the function the source becomes, so those names resolve to the fakes
// inside it without a global being replaced. That is also what keeps two
// readers apart -- each gets its own, so an earlier one's beat cannot read a
// later one's league, which a shared global would let it do.
//
// What this cannot see is the browser: the userscript manager, whether the
// installed copy is the current one, and the per-extension "Allow user scripts"
// control that registers nothing and reports no fault when it is off. Those
// still need a real league page.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'league-reader.js'),
  'utf8',
);

/**
 * Long enough for a beat set to a tenth of a minute to have come round.
 *
 * The reader floors its own beat at five seconds as a runaway guard, so six is
 * the shortest real interval there is and this is the wait that outlasts one.
 * It makes this file slow for its size, on purpose: the thing being checked is
 * a timer, and a fake clock would check that the test's clock advances.
 */
const PAST_ONE_BEAT = 7000;
const SHORT = 0.1;

const PROFILE = { fantasy_content: { users: { 0: { user: [{ guid: 'GUID-ME' }] } } } };
const SETTINGS = { fantasy_content: { league: [{ name: 'Test League' }, { settings: [{}] }] } };
// `allTeamIds` is the one place the reader reads Yahoo's shape, so this is that
// shape and not a convenient one: a numeric string key, a `team` whose first
// element is an array, and the id inside it.
const TEAMS = {
  fantasy_content: { league: [{}, { teams: { 0: { team: [[{ team_id: '1' }]] } } }] },
};
const ROSTER = { fantasy_content: { team: [[{ team_key: 'nfl.l.1.t.1' }], { roster: {} }] } };

let leagues = 0;

/**
 * One reader, on a league page, with nobody upstream.
 *
 * Returns what it posted to the service and what its panel says, which between
 * them are everything it does.
 */
function reader({ mode = 'userscript', every = null } = {}) {
  leagues += 1;
  const league = String(966000000 + leagues);
  const posted = [];
  const store = new Map();
  if (every !== null) store.set('draftroom.readerMinutes', String(every));

  const shadow = {
    innerHTML: '',
    // No button is clicked here. The setting is written directly, which is the
    // same value by the same key, and clicking is the browser's half.
    querySelectorAll: () => [],
    firstElementChild: { style: {} },
  };
  const host = {
    id: '',
    shadowRoot: null,
    attachShadow() { this.shadowRoot = shadow; return shadow; },
    remove() {},
  };

  const document_ = {
    getElementById: (id) => (host.id === id ? host : null),
    createElement: () => host,
    body: { appendChild: () => {} },
  };

  const window_ = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };

  const location_ = {
    hostname: 'football.fantasysports.yahoo.com',
    pathname: '/f1/' + league + '/1',
  };

  const fetch_ = async (url, opts) => {
    const at = String(url);
    if (at.includes('/api/yahoo/league/')) {
      assert.ok(at.includes(league), 'a reader posted to a league that is not its own');
      posted.push(JSON.parse(opts.body));
      return {
        ok: true,
        json: async () => ({
          name: 'Test League', teams: [{}], slots: [], scoring: [], rosters: [{ players: [] }],
        }),
      };
    }
    // Never a cookie, a token or a crumb, in either direction. The browser
    // attaches the session in a real page and nothing here forwards one.
    assert.ok(!opts || !opts.headers || !opts.headers.cookie, 'the reader sent a cookie');
    if (at.includes('profile')) return { ok: true, json: async () => PROFILE };
    if (at.includes('/settings')) return { ok: true, json: async () => SETTINGS };
    if (at.includes('/teams')) return { ok: true, json: async () => TEAMS };
    if (at.includes('/roster')) return { ok: true, json: async () => ROSTER };
    throw new Error('a request nobody expected: ' + at);
  };

  const stamped = SRC
    .replace('__READER_BUILD__', 'testbuild')
    .replace('__READER_MODE__', mode);

  new Function('document', 'window', 'location', 'fetch', stamped)(
    document_, window_, location_, fetch_,
  );

  return {
    league,
    posted,
    store,
    said: () => shadow.innerHTML,
    settle: (ms = 400) => new Promise((done) => { setTimeout(done, ms); }),
  };
}

test('it reads the league on load, without being clicked', async () => {
  const r = reader({ every: 0 });
  await r.settle();

  assert.equal(r.posted.length, 1);
  const [body] = r.posted;
  // Yahoo's own JSON, unread. Every bit of the interpreting is the service's.
  assert.deepEqual(Object.keys(body).sort(), ['profile', 'rosters', 'settings', 'teams']);
  assert.equal(body.rosters.length, 1, 'the roster is read per team, so one team is one roster');
  assert.match(r.said(), /Read Test League/);
});

test('it reads again on the beat it is set to', async () => {
  const r = reader({ every: SHORT });
  await r.settle(PAST_ONE_BEAT);

  assert.ok(r.posted.length >= 2, 'it read ' + r.posted.length + ' times, so it did not come back');
});

test('never means never, and is the whole of the difference between the installs', async () => {
  const r = reader({ every: 0 });
  await r.settle(PAST_ONE_BEAT);

  assert.equal(r.posted.length, 1, 'a beat of zero still came back');
});

test('a bookmarklet copy starts no beat, whatever the setting says', async () => {
  // The setting is the short one, so a copy that read the setting and ignored
  // its own mode would fail this rather than pass it slowly.
  const r = reader({ mode: 'bookmarklet', every: SHORT });
  await r.settle(PAST_ONE_BEAT);

  assert.equal(r.posted.length, 1, 'the bookmarklet came back on its own');
  assert.doesNotMatch(r.said(), /Read again every/,
    'the bookmarklet offered a beat it does not have');
});

test('the userscript panel offers the beat and marks the one in force', async () => {
  // Nothing stored, so this is the default rather than a value under test.
  const r = reader();
  await r.settle();

  const said = r.said();
  assert.match(said, /Read again every/);
  for (const offered of [0, 5, 10, 15, 30, 60]) {
    assert.match(said, new RegExp('data-min="' + offered + '"'), offered + ' was not offered');
  }
  // Ten minutes, lit, because a panel that does not say which one is in force
  // is a panel that cannot tell a running beat from a stopped one.
  assert.match(said, /data-min="10"[^>]*#7fca88/);
  assert.equal(r.posted.length, 1, 'the default is a beat, so this has not fired yet');
});
