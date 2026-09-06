// The bridge userscript, run in a draft room that is not there.
//
//   npm run bridge:test
//
// This exists because the userscript was the one part of the project no check
// touched. It runs inside a page this repository does not own, wraps a socket
// nobody documents, and the only thing that had ever exercised it was a live
// draft — which is a bad place to find out that it does not send what you think.
//
// So the real file is loaded and run here, against a fake `WebSocket`, a fake
// `fetch` and a fake room URL. Nothing is stubbed inside it: the frame it puts
// on the wire is the frame the assertions read. What this cannot check is
// anything the browser does — the userscript manager, Chrome's loopback
// permission, whether Yahoo's own bundle builds its socket after this loads.
// Those still need a mock draft.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'yahoo-draft-bridge.user.js'),
  'utf8',
);

const SEAT = 3;

/**
 * Which fake room a request belongs to.
 *
 * Every room replaces `globalThis.fetch`, but the bridges loaded by earlier
 * ones are still running their own beat and still calling it, so a single
 * shared stub would hand one room's posts to another and the assertions would
 * read whichever ran last. Each room takes a league of its own and this routes
 * on it, which is also how the real service tells two drafts apart.
 */
const rooms = new Map();
let leagues = 0;

globalThis.fetch = async (url, opts) => {
  const at = String(url).match(/(\d{5,})/);
  const here = rooms.get(at && at[1]);
  if (!here) throw new Error('a request from a room that was never opened: ' + url);

  // The two reads that need the session cookie, answered as Yahoo answers.
  if (String(url).includes('pub-api')) {
    const list = String(url).includes('players/')
      ? { player_list: [{ id: '7200', fname: 'A', lname: 'Back', display_pos: 'RB', team_abbr: 'ATL' }] }
      : { team_list: [{ id: SEAT, teamname: 'Team', managers: [{ nickname: 'me' }] }] };
    return { ok: true, json: async () => ({ service: list }) };
  }

  here.posted.push(JSON.parse(opts.body));
  return { ok: true, json: async () => here.reply };
};

/**
 * A draft room with nobody in it.
 *
 * Returns the levers a test needs: what Yahoo said, what the bridge sent back
 * to Yahoo, what it posted to the service, and what the service replies.
 */
function room() {
  leagues += 1;
  const league = String(10888300 + leagues);
  const here = {
    posted: [],
    sent: [],
    reply: {
      picks: 0, pool: 1, seats: 1, needPool: false, needSeats: false,
      needQueue: false, orderKnown: true, queue: null,
    },
  };
  rooms.set(league, here);

  class Socket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.listeners = [];
    }

    addEventListener(kind, fn) { if (kind === 'message') this.listeners.push(fn); }

    send(data) { here.sent.push(data); }

    /** Yahoo saying something, as the draft server does. */
    say(data) { for (const fn of this.listeners) fn({ data }); }
  }
  Socket.CONNECTING = 0;
  Socket.OPEN = 1;
  Socket.CLOSING = 2;
  Socket.CLOSED = 3;

  // Kept per room rather than read off `globalThis` later. The bridge replaces
  // `window.WebSocket` with its own wrapper on whichever object it was handed,
  // and a test opening a socket has to reach that room's wrapper and not the
  // one belonging to whichever room loaded most recently.
  const win = { WebSocket: Socket };
  win.top = win;
  globalThis.window = win;
  globalThis.location = { pathname: `/draftclient/f1/${league}/${SEAT}` };

  // The script wraps `window.WebSocket`, so it has to run before the socket is
  // built — which is what `@run-at document-start` buys it in a real room.
  new Function(SRC)();

  return {
    league,
    posted: here.posted,
    sent: here.sent,
    open: () => new win.WebSocket('wss://draft.example/'),
    answer: (next) => { here.reply = { ...here.reply, ...next }; },
    /** Long enough for the idle beat, which is what carries the reply back. */
    settle: () => new Promise((done) => { setTimeout(done, 3600); }),
  };
}

test('it forwards the frames a board needs, and the queue frame', async () => {
  const r = room();
  const ws = r.open();
  ws.say('H|S|30|0|0|1');
  ws.say('R|1|2|3');
  ws.say('Q');
  ws.say('0|1|7200|1|RB|0');
  // None of these changes who holds which player, so none may be sent.
  ws.say('C|24');
  ws.say('D|2|2|30');
  ws.say('G|[{"pickId":1}]');
  await r.settle();

  const frames = r.posted.flatMap((p) => p.frames);
  assert.deepEqual(frames, ['H|S|30|0|0|1', 'R|1|2|3', 'Q', '0|1|7200|1|RB|0']);
  assert.ok(r.posted.some((p) => p.pool), 'the pool is posted, since only this tab can read it');
  assert.ok(r.posted.every((p) => p.team === SEAT), 'every post names the seat from the room URL');
});

test('it sets the queue the service asks for, once', async () => {
  const r = room();
  const ws = r.open();
  ws.say('0|1|7200|1|RB|0');
  r.answer({ queue: ['7200', '7201'] });
  await r.settle();

  assert.deepEqual(r.sent, [`S|${r.league}|${SEAT}|7200|7201`]);

  // The same instruction again is not the same instruction twice. Yahoo answers
  // every write with a `Q|`, so re-sending would be arguing with the room.
  await r.settle();
  assert.equal(r.sent.length, 1);
});

test('it never sends an empty queue, which would clear the room’s own', async () => {
  const r = room();
  const ws = r.open();
  ws.say('0|1|7200|1|RB|0');
  r.answer({ queue: [] });
  await r.settle();
  assert.deepEqual(r.sent, []);
});

test('it sends nothing at all when the service asks for nothing', async () => {
  const r = room();
  const ws = r.open();
  ws.say('0|1|7200|1|RB|0');
  ws.say('Q');
  await r.settle();
  assert.deepEqual(r.sent, [], 'the setting is off, so the bridge stays a reader');
});

test('it never sends a pick, whatever it is handed', async () => {
  const r = room();
  const ws = r.open();
  ws.say('0|1|7200|1|RB|0');
  // A service that had been compromised, or a reply shape nobody expected.
  r.answer({ queue: ['7200'], pick: '7201', draft: '7201' });
  await r.settle();

  assert.equal(r.sent.length, 1);
  assert.ok(
    r.sent.every((f) => f.startsWith('S|')),
    'the only frame this file can format is the queue: ' + JSON.stringify(r.sent),
  );
});

test('a reconnect forgets what it asked of the connection that went', async () => {
  const r = room();
  const first = r.open();
  first.say('0|1|7200|1|RB|0');
  r.answer({ queue: ['7200'] });
  await r.settle();
  assert.equal(r.sent.length, 1);

  // Yahoo assigns a new draft server per connection, so a rejoin is a new
  // socket with a queue of its own. What was set on the old one proves nothing.
  const again = r.open();
  again.say('0|1|7200|1|RB|0');
  await r.settle();
  assert.deepEqual(r.sent, [
    `S|${r.league}|${SEAT}|7200`,
    `S|${r.league}|${SEAT}|7200`,
  ]);
});

test('it hands back the queue frame when the service has forgotten it', async () => {
  const r = room();
  const ws = r.open();
  ws.say('Q|7200|7201');
  await r.settle();

  // A service restarted mid-draft has lost the room. Yahoo will not repeat a
  // `Q|` unasked, so the bridge is the only copy left.
  r.answer({ needQueue: true });
  await r.settle();
  const frames = r.posted.flatMap((p) => p.frames);
  assert.ok(
    frames.filter((f) => f === 'Q|7200|7201').length >= 2,
    'the last queue frame is sent again: ' + JSON.stringify(frames),
  );
});
