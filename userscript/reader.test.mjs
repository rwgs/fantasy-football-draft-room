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
/*
 * The scoreboard, which the reader fetches for two things at once: who you play
 * and Yahoo's own projected total. Its own branch below, before `/teams`, since
 * neither substring is in the other but the roster branch would take it.
 */
const SCOREBOARD = {
  fantasy_content: {
    league: [{}, { scoreboard: { 0: { matchups: { count: 0 } } } }],
  },
};

/**
 * What the service answers for the week's advice, in the endpoint's own shape.
 *
 * Trimmed to the fields the panel reads and no further, so a field it stops
 * reading shows up here as a field nothing needs.
 */
const desk = (now, best, gain, moves, moved = []) => ({
  currentPoints: now, points: best, gain, moves, moved,
});
const ADVICE = {
  read: true,
  week: 3,
  advice: {
    answered: ['sleeper', 'espn'],
    desks: {
      sleeper: desk(8.9, 12.5, 3.6, [{
        slot: 'RB',
        out: { playerKey: 'p1', name: 'Saquon Barkley' },
        in: { playerKey: 'p2', name: 'Omarion Hampton' },
      }]),
      // No swap, and a relocation instead: the other shape a desk's answer
       // takes, and the one that used to come out as a player benched and
       // started at once.
      espn: desk(9.5, 10.2, 0.7, [], [{
        playerKey: 'p3', name: 'Travis Etienne Jr.', from: 'RB', to: 'W/R/T',
      }]),
    },
    agreed: [{ player: 'Chase Brown', slot: 'RB' }],
    disputed: [{
      picks: [
        { desk: 'sleeper', player: 'Omarion Hampton', slot: 'RB', points: {} },
        { desk: 'espn', player: 'Ashton Jeanty', slot: 'W/R/T', points: {} },
      ],
      spread: 0.4,
      material: false,
    }],
    locksKnown: false,
  },
};

let leagues = 0;

/**
 * One reader, on a league page, with nobody upstream.
 *
 * Returns what it posted to the service and what its panel says, which between
 * them are everything it does.
 */
function reader({
  mode = 'userscript', every = null, advice = ADVICE, reachable = true, scoreboardOk = true,
} = {}) {
  leagues += 1;
  const league = String(966000000 + leagues);
  const posted = [];
  const asked = [];
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
    /*
     * Before the snapshot branch, because both addresses start
     * `/api/yahoo/league/<id>` and the advice is the one with a tail. Getting
     * that order wrong is silent: the advice read lands on the snapshot branch,
     * `opts` is undefined, and the reader's own catch turns the type error into
     * a panel that says the service is unreachable.
     */
    if (at.includes('/lineup')) {
      asked.push(at);
      if (!reachable) throw new Error('connection refused');
      return { ok: true, json: async () => advice };
    }
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
    if (at.includes('/scoreboard')) {
      if (!scoreboardOk) throw new Error('Yahoo refused the scoreboard');
      return { ok: true, json: async () => SCOREBOARD };
    }
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
    /** Every advice read, so a copy that asked for none can be told apart. */
    asked,
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
  assert.deepEqual(Object.keys(body).sort(),
    ['profile', 'rosters', 'scoreboard', 'settings', 'teams']);
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

test('it paints the advice the app would show, off the same endpoint', async () => {
  const r = reader({ every: 0 });
  await r.settle();

  assert.equal(r.asked.length, 1, 'the advice was read once, after the snapshot');
  assert.match(r.asked[0], new RegExp('/api/yahoo/league/' + r.league + '/lineup'));

  const said = r.said();
  // The swap, named as the seat the user edits and the two players in it.
  assert.match(said, /RB/);
  assert.match(said, /bench Saquon Barkley/);
  assert.match(said, /Omarion Hampton/);
  // Both desks, with what each makes of the lineup as it stands.
  assert.match(said, /Sleeper<\/b> 8\.9 now · 12\.5 best · \+3\.6/);
  assert.match(said, /ESPN<\/b> 9\.5 now · 10\.2 best · \+0\.7/);

  /*
   * A relocation, said as one. The player starts either way, so he must not
   * appear as benched or started -- which is what he did until the swaps were
   * computed over the whole lineup rather than slot by slot.
   */
  assert.match(said, /move <b[^>]*>Travis Etienne Jr\.<\/b> RB → W\/R\/T/);
  assert.doesNotMatch(said, /bench Travis Etienne Jr\./);
  // And a desk with a relocation is not reported as leaving the lineup alone.
  assert.doesNotMatch(said, /leaves the lineup as it is/);
  // And the two halves of the disagreement, the same way the screen puts them.
  assert.match(said, /Both desks start Chase Brown/);
  assert.match(said, /disagree about Omarion Hampton RB or Ashton Jeanty W\/R\/T/);
  /*
   * The locks caution belongs here more than on the app's screen, because this
   * panel is on the page where the moves get made and Yahoo publishes no
   * kickoff time at any scope.
   */
  assert.match(said, /Locks are not known/);
});

test('a gain of null is unknown and never a gain of nothing', async () => {
  // A starter this desk cannot score, so the difference between the two totals
  // is missing a term of unknown size. Zero there would be a confident claim.
  const advice = structuredClone(ADVICE);
  advice.advice.desks.sleeper.gain = null;
  const r = reader({ every: 0, advice });
  await r.settle();

  assert.match(r.said(), /gain unknown/);
  assert.doesNotMatch(r.said(), /\+0\.0/);
});

test('advice that cannot be reached is said out loud, not left blank', async () => {
  const r = reader({ every: 0, reachable: false });
  await r.settle();

  // The reading still stands: the league was read, only the advice was not.
  assert.equal(r.posted.length, 1);
  assert.match(r.said(), /Read Test League/);
  assert.match(r.said(), /Could not reach the advice/);
});

test('a refusal from the service is repeated rather than painted as no advice', async () => {
  // Read, and not advisable. The service says which of several reasons, and a
  // panel that showed nothing here would be the defect the app's screen fixed.
  const r = reader({
    every: 0,
    advice: { read: true, advice: null, error: 'No roster in this snapshot matched your account.' },
  });
  await r.settle();

  assert.match(r.said(), /No roster in this snapshot matched your account/);
});

test('a name out of Yahoo cannot put markup into the panel', async () => {
  /*
   * These names are a real league's real players, arriving as text and going
   * into `innerHTML` on the user's own signed-in Yahoo page. Escaped rather
   * than trusted, which is cheap here and is the last place to be relaxed
   * about it.
   */
  const advice = structuredClone(ADVICE);
  advice.advice.agreed = [{ player: '<img src=x onerror="alert(1)">', slot: 'RB' }];
  const r = reader({ every: 0, advice });
  await r.settle();

  assert.doesNotMatch(r.said(), /<img src=x/);
  assert.match(r.said(), /&lt;img src=x/);
});

test('a bookmarklet copy asks for no advice, since its panel does not stay', async () => {
  const r = reader({ mode: 'bookmarklet', every: 0 });
  await r.settle();

  assert.equal(r.posted.length, 1, 'it still reads the league');
  assert.deepEqual(r.asked, [], 'it fetched advice its panel would drop nine seconds later');
});

test('it reads the scoreboard, which is what says who you are playing', () => {
  // Its own request rather than something dug out of the teams response: the
  // team list pairs nobody up, and `matchup_week` names the week and not the
  // opponent.
  const r = reader({ every: 0 });
  return r.settle().then(() => {
    const [body] = r.posted;
    assert.ok(body.scoreboard, 'the snapshot went without a scoreboard');
  });
});

test('a scoreboard Yahoo refuses costs the matchup and not the read', () => {
  /*
   * The newest and least load-bearing thing the reader fetches, so it is caught
   * rather than awaited bare. Everything else in the snapshot is worth having
   * without it, and the service reads a null here as "not sent".
   */
  const r = reader({ every: 0, scoreboardOk: false });
  return r.settle().then(() => {
    assert.equal(r.posted.length, 1, 'a refused scoreboard took the whole read with it');
    assert.equal(r.posted[0].scoreboard, null);
    assert.match(r.said(), /Read Test League/);
  });
});
