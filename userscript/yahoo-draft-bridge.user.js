// ==UserScript==
// @name         Yahoo draft bridge
// @namespace    fantasy-football-draft-room
// @version      1.0.0
// @description  Copy your own Yahoo draft room onto the draft board running on your machine. Reads only; never picks.
// @match        https://football.fantasysports.yahoo.com/draftclient/*
// @downloadURL  http://127.0.0.1:5178/userscript/yahoo-draft-bridge.user.js
// @updateURL    http://127.0.0.1:5178/userscript/yahoo-draft-bridge.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * The bridge between a Yahoo draft room and the draft board on your machine.
 *
 * Why this exists at all: Yahoo's draft room talks to its own draft server, and
 * every endpoint it uses authenticates on your browser's session cookie. The
 * local service has no cookie and must never hold one, so it cannot read your
 * draft however politely it asks. The only thing that can is code already
 * running in the tab you have open. That is this file. See `DECISIONS.md`.
 *
 * What it does: wraps `WebSocket` so it can read the frames Yahoo is already
 * sending itself, fetches the league's player pool and seats once, and posts
 * both to `http://127.0.0.1:5178`. That is the whole job.
 *
 * What it never does:
 *
 *   - Make a pick, or send anything at all to Yahoo. Every frame passes through
 *     untouched; this only listens. The tool is not an autodrafter.
 *   - Read `document.cookie`, or any storage. Your Yahoo session stays in the
 *     browser, and the local service is deliberately never given it.
 *   - Send anything anywhere except the loopback address below.
 *
 * Two things worth knowing before you rely on it:
 *
 *   - The frame format is Yahoo's private protocol with its own client. Nobody
 *     promised it, and it can change in a deploy, without notice, mid-draft. If
 *     picks stop appearing, that is the first thing to suspect.
 *   - Everything it was built from was watched in mock drafts. Run a mock with
 *     the board open beside it before you trust it in a real one.
 *
 * INSTALLING
 *
 *   1. Install a userscript manager, such as Tampermonkey. On Chrome it also
 *      needs "Allow User Scripts" turned on, under the manager's own entry in
 *      `chrome://extensions`. Without it nothing runs and nothing says so.
 *   2. Start the draft board on this machine: `npm run dev`.
 *   3. Open http://127.0.0.1:5178/userscript/yahoo-draft-bridge.user.js and let
 *      the manager install it. Installing from that address rather than pasting
 *      the text is what lets a later edit reach the browser, once the `@version`
 *      above is raised.
 *   4. Open your Yahoo draft room from the lobby, as you normally would. Do not
 *      paste the room's address into a new tab: the `auth` in it is single use,
 *      and reloading it leaves the draft rather than rejoining it. Coming back
 *      in from the lobby is fine, and is how to attach to a draft already under
 *      way: the server replays every pick so far on connect.
 *   5. In the app, choose Yahoo and enter the league number from the room's
 *      address. The console logs `[yahoo-bridge]` lines if you want to watch.
 */

(() => {
  'use strict';

  /** The service on this machine. Nothing is ever sent anywhere else. */
  const SERVICE = 'http://127.0.0.1:5178';

  /**
   * Frames worth forwarding: a pick, the settings, the draft order, and the
   * replay of everything missed. `docs/yahoo-draft-protocol.md` lists the rest
   * — clock ticks, grades, managers coming and going — and none of them changes
   * who holds which player, so none of them is sent.
   */
  const WANTED = /^(?:0|H|R|P)(?:\||$)/;

  /** Frames are batched, so a burst of picks costs one request rather than six. */
  const FLUSH_MS = 400;
  /** A queue that only ever grows means the service is down. Cap it and say so. */
  const MAX_QUEUED = 2000;

  const log = (...args) => console.log('[yahoo-bridge]', ...args);

  // ---- Which league, and which seat --------------------------------------
  //
  // Both are in the room's own address: `/draftclient/f1/<league>/<team>`. That
  // is why this never has to ask which seat is yours, and why it cannot be
  // pointed at a league you are not in.

  const route = location.pathname.match(/\/draftclient\/[^/]+\/(\d{4,})\/(\d+)/);
  if (!route) return;
  const LEAGUE = route[1];
  const TEAM = Number(route[2]);

  let queue = [];
  let sending = false;
  let poolSent = false;
  let seatsSent = false;
  let timer = null;

  // ---- Read the socket ----------------------------------------------------
  //
  // This has to happen before Yahoo's bundle constructs its socket, which is
  // why the script runs at `document-start`. A wrapper installed even a moment
  // later watches a socket that is already open and sees nothing.

  const Native = window.WebSocket;

  function Bridged(url, protocols) {
    const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
    try {
      socket.addEventListener('message', (event) => {
        // Never let a fault in here reach Yahoo's own handler. A bridge that
        // breaks should cost the picks on the board, not the draft itself.
        try {
          if (typeof event.data !== 'string') return;
          if (!WANTED.test(event.data)) return;
          push(event.data);
        } catch (err) {
          log('dropped a frame:', err && err.message);
        }
      });
    } catch (err) {
      log('could not listen to a socket:', err && err.message);
    }
    return socket;
  }

  // Keep the shape of the real thing. Code that checks `instanceof WebSocket`
  // or reads `WebSocket.OPEN` must not be able to tell the difference.
  Bridged.prototype = Native.prototype;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Bridged[key] = Native[key];

  window.WebSocket = Bridged;

  function push(frame) {
    if (queue.length >= MAX_QUEUED) {
      // Drop the oldest rather than the newest: the recent picks are the ones
      // still worth having, and Yahoo replays the whole draft on a reconnect
      // anyway, so nothing here is the only copy.
      queue.shift();
    }
    queue.push(frame);
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  // ---- What only this tab can fetch ---------------------------------------
  //
  // A pick frame names a player by a Yahoo ID and nothing else. The pool is the
  // only thing that says whose ID it is, and it answers the session cookie
  // alone, so it is fetched here and posted once. The seats are the same story.

  async function pubApi(path) {
    const res = await fetch('https://pub-api.fantasysports.yahoo.com/fantasy/v3/' + path, {
      // The cookie is what makes this answer at all. It goes to Yahoo, which
      // already has it, and travels nowhere else.
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(path + ' returned ' + res.status);
    return res.json();
  }

  /** The pool, trimmed to the five fields the board needs to place a pick. */
  async function readPool() {
    const body = await pubApi('players/nfl/' + LEAGUE);
    const list = body?.service?.player_list || [];
    return list.map((p) => ({
      id: String(p.id),
      // The full forename, not the `C. Olave` the room paints on screen. The
      // name matching wants three shared opening letters and would refuse an
      // initial against the full name, so reading the feed matters here.
      fname: p.fname || '',
      lname: p.lname || '',
      display_pos: p.display_pos || '',
      team_abbr: p.team_abbr || '',
    }));
  }

  /** The seats, so the board can name the teams rather than number them. */
  async function readSeats() {
    const body = await pubApi('teams/nfl/' + LEAGUE);
    const list = body?.service?.team_list || [];
    return list.map((t) => ({
      id: Number(t.id),
      teamname: t.teamname || '',
      manager: t.managers?.[0]?.nickname || '',
    }));
  }

  // ---- Post it ------------------------------------------------------------

  async function flush() {
    timer = null;
    if (sending) return;
    if (!queue.length && poolSent && seatsSent) return;
    sending = true;

    // Taken before the request and put back if it fails, so a service that is
    // not running yet costs nothing: the frames wait rather than vanish.
    const sendingFrames = queue;
    queue = [];

    const body = { team: TEAM, frames: sendingFrames };
    try {
      if (!poolSent) body.pool = await readPool();
      if (!seatsSent) body.seats = await readSeats();
    } catch (err) {
      log('could not read the league:', err && err.message);
    }

    try {
      const res = await fetch(SERVICE + '/api/yahoo/room/' + LEAGUE, {
        method: 'POST',
        // No cookies, to anybody. This request carries a player pool, the seats
        // and Yahoo's own draft frames, and nothing that identifies you.
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('the service returned ' + res.status);
      const reply = await res.json();

      if (body.pool) poolSent = true;
      if (body.seats) seatsSent = true;
      // A restarted service has forgotten the pool. It says so, and the next
      // flush sends it again rather than leaving every later pick unresolved.
      if (reply.needPool) poolSent = false;
      if (reply.needSeats) seatsSent = false;

      if (sendingFrames.length || body.pool) {
        log('sent ' + sendingFrames.length + ' frames; the board has '
          + reply.picks + ' picks of ' + reply.pool + ' players');
      }
    } catch (err) {
      queue = sendingFrames.concat(queue);
      log('could not reach the draft board on ' + SERVICE + ':', err && err.message);
      // Try again on a slower beat. The draft is not waiting for us, and a
      // request per frame at a dead port helps nobody.
      if (!timer) timer = setTimeout(flush, 3000);
    } finally {
      sending = false;
    }
  }

  // The pool and the seats do not wait for a first pick: a board that knows who
  // is in the league before the draft opens is a board ready when it does.
  flush();

  log('watching league ' + LEAGUE + ' from seat ' + TEAM + '. Posting to ' + SERVICE + '.');
})();
