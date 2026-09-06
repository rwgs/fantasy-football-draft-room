// ==UserScript==
// @name         Yahoo draft bridge
// @namespace    fantasy-football-draft-room
// @version      1.3.0
// @description  Copy your own Yahoo draft room onto the draft board running on your machine, and set your queue from it when you ask. Never picks.
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
 * both to `http://127.0.0.1:5178`. That is the whole of the reading.
 *
 * What it sends to Yahoo: your draft queue, and only when you have turned that
 * on in the app. Yahoo's own client sets a queue by sending the whole list on
 * one frame, and this sends the same frame with the same list. Two rules hold
 * it in place, and both are in `DECISIONS.md`:
 *
 *   - It never sends a pick. The frame that would is known, documented and
 *     deliberately absent from this file. A wrong queue costs you a player when
 *     a clock expires; a wrong pick costs you one immediately, and no part of
 *     the reasoning that justified the queue reaches that far.
 *   - It never writes a queue it has not read. The frame replaces the whole
 *     list, so writing one while ignorant of what is in it is a deletion. The
 *     service withholds the instruction until Yahoo has said what it holds.
 *
 * What it never does:
 *
 *   - Read `document.cookie`, or any storage. Your Yahoo session stays in the
 *     browser, and the local service is deliberately never given it.
 *   - Send anything anywhere except the loopback address below.
 *   - Draw anything. The panel that shows what the board makes of the room is
 *     not here: it needs no privileges, and tying it to a userscript only gave
 *     it a userscript's ways of failing to install. It is a bookmarklet, from
 *     `http://127.0.0.1:5178/panel`. See `DECISIONS.md`.
 *
 * Two things worth knowing before you rely on it:
 *
 *   - The frame format is Yahoo's private protocol with its own client. Nobody
 *     promised it, and it can change in a deploy, without notice, mid-draft. If
 *     picks stop appearing, that is the first thing to suspect.
 *   - Chrome gates a public page reaching the loopback, separately from anything
 *     this project controls. Where it is enforced it asks once, and refusing it
 *     leaves the console saying only that a CORS policy denied "the `loopback`
 *     address space". If nothing ever arrives and that line is in the console,
 *     that is the reason: allow the local network access Chrome asked about.
 *     No header from the service can answer it, because it is a permission
 *     rather than a negotiation.
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
   * Frames worth forwarding: a pick, the settings, the draft order, the replay
   * of everything missed, and your own queue. `docs/yahoo-draft-protocol.md`
   * lists the rest — clock ticks, grades, managers coming and going — and none
   * of them changes who holds which player, so none of them is sent.
   *
   * `Q` is the odd one out: it changes nothing on the board, and is forwarded
   * because it is the only thing that says what your queue holds. Writing one
   * without knowing that would delete whatever was already in it.
   */
  const WANTED = /^(?:0|H|R|P|Q)(?:\||$)/;

  /** Frames are batched, so a burst of picks costs one request rather than six. */
  const FLUSH_MS = 400;
  /**
   * And a beat for when nothing is happening.
   *
   * Picks arrive when they arrive, but the queue the app wants set changes on
   * its own schedule — you star someone between picks — and the reply to this
   * post is how that reaches the room. Slow, because it is a loopback request
   * about a draft where nothing has moved.
   */
  const IDLE_MS = 3000;
  /** A backlog that only ever grows means the service is down. Cap it. */
  const MAX_PENDING = 2000;

  /** Bumped with `@version` above. Logged so the running copy is never in doubt. */
  const VERSION = '1.3.0';

  const log = (...args) => console.log('[yahoo-bridge]', ...args);

  // Said before anything that could go wrong, so the running version is known
  // even when everything after this line fails. It used to be logged at the
  // end, which told you the version only when nothing had gone wrong, which is
  // exactly when nobody needs it.
  log('v' + VERSION + ' loading in the ' + (window.top === window ? 'top frame' : 'an iframe')
    + ' at ' + location.pathname);

  // ---- Which league, and which seat --------------------------------------
  //
  // Both are in the room's own address: `/draftclient/f1/<league>/<team>`. That
  // is why this never has to ask which seat is yours, and why it cannot be
  // pointed at a league you are not in.

  const route = location.pathname.match(/\/draftclient\/[^/]+\/(\d{4,})\/(\d+)/);
  if (!route) return;
  const LEAGUE = route[1];
  const TEAM = Number(route[2]);

  // Frames waiting to be posted. Named for the buffer it is, because `queue` in
  // this file now means the draft queue Yahoo holds.
  let pending = [];
  let sending = false;
  let poolSent = false;
  let seatsSent = false;
  let timer = null;

  /**
   * The socket the draft is on, and what has been asked of it.
   *
   * The page opens sockets this has no interest in, so the draft is identified
   * as whichever one says something only the draft server says. `lastSent` is
   * cleared with it: a reconnect is a new queue, and what was asked of a
   * connection that has gone is not an answer about this one.
   */
  let draftSocket = null;
  let lastSent = null;
  /** The last queue Yahoo reported, to hand back to a service that restarted. */
  let lastQueueFrame = null;

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
          // Only the draft server sends any of these, so the first one to
          // arrive is what identifies the socket worth answering on.
          if (draftSocket !== socket) {
            draftSocket = socket;
            lastSent = null;
          }
          if (event.data[0] === 'Q') lastQueueFrame = event.data;
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
    if (pending.length >= MAX_PENDING) {
      // Drop the oldest rather than the newest: the recent picks are the ones
      // still worth having, and Yahoo replays the whole draft on a reconnect
      // anyway, so nothing here is the only copy.
      pending.shift();
    }
    pending.push(frame);
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  // ---- The one thing sent to Yahoo ----------------------------------------

  /**
   * Set the draft queue, as Yahoo's own client sets it.
   *
   * The frame carries the whole ordered list and replaces what is there, which
   * is why the service withholds it until the room has said what it holds. By
   * the time a list arrives here it is already the merge of both.
   *
   * Three refusals, all deliberate:
   *
   *   - An empty list is never sent. It is indistinguishable from asking Yahoo
   *     to clear the queue, and nothing in the app ever wants that.
   *   - The same list is never sent twice. Yahoo answers every write with a
   *     `Q|`, and rewriting on a difference the room chose would be arguing
   *     with the user's own draft room rather than following it.
   *   - Nothing is sent before a frame has identified the draft socket.
   */
  function writeQueue(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    if (!draftSocket || draftSocket.readyState !== Native.OPEN) return;

    const line = ids.join('|');
    if (line === lastSent) return;

    try {
      draftSocket.send('S|' + LEAGUE + '|' + TEAM + '|' + line);
      lastSent = line;
      // Says whether the room had ever reported a queue of its own, because a
      // write made without one replaced whatever was in it unseen. This was
      // found the hard way: a dropped `Q` looks exactly like a queue nobody
      // asked for, and only the service could tell the two apart.
      log('set the draft room queue, ' + ids.length + ' deep'
        + (lastQueueFrame ? '' : ' (this room has never reported a queue)'));
    } catch (err) {
      log('could not set the queue:', err && err.message);
    }
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

  /**
   * The pool, trimmed to what the board needs.
   *
   * Five fields place a pick. The last two are not needed for that at all, and
   * are here because this response is the only place they can be had: Yahoo
   * publishes how its own drafters behave, and only to a browser holding the
   * session cookie. `average-pick` is an ADP measured over the people you are
   * actually drafting against, rather than over Sleeper or Fantasy Football
   * Calculator's very different populations, and `o_rank` is Yahoo's own
   * ranking, which covers every player rather than only the drafted ones.
   *
   * Both are sent as they arrive, unrounded and unjudged. What they are worth
   * is decided on the board, not here.
   */
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
      adp: p['average-pick'] ?? null,
      rank: p.o_rank ?? null,
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
    sending = true;
    // A post with nothing in it is still worth making: its reply is how the
    // queue the app wants set reaches this tab. `IDLE_MS` keeps that cheap.
    let again = IDLE_MS;

    // Taken before the request and put back if it fails, so a service that is
    // not running yet costs nothing: the frames wait rather than vanish.
    const sendingFrames = pending;
    pending = [];

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
      // And has forgotten the queue, which Yahoo reports only when it changes.
      // Handing back the last one seen is what stops a restart from leaving the
      // queue unwritable for the rest of the draft.
      if (reply.needQueue && lastQueueFrame) push(lastQueueFrame);

      // The whole write path, in one line at the end of a read. Null is the
      // ordinary answer: the setting is off, or the room has not said what its
      // queue holds, and both mean send nothing.
      if (reply.queue) writeQueue(reply.queue);

      if (sendingFrames.length || body.pool) {
        log('sent ' + sendingFrames.length + ' frames; the board has '
          + reply.picks + ' picks of ' + reply.pool + ' players');
      }
      // Picks come in bursts, so stay on the fast beat while any are waiting.
      if (pending.length) again = FLUSH_MS;
    } catch (err) {
      pending = sendingFrames.concat(pending);
      log('could not reach the draft board on ' + SERVICE + ':', err && err.message);
      // Try again on a slower beat. The draft is not waiting for us, and a
      // request per frame at a dead port helps nobody.
      again = 3000;
    } finally {
      sending = false;
      // Always come back. Picks arrive when they arrive, but the queue the app
      // wants set changes between them, and nothing else would fetch it.
      if (!timer) timer = setTimeout(flush, again);
    }
  }

  // The pool and the seats do not wait for a first pick: a board that knows who
  // is in the league before the draft opens is a board ready when it does.
  flush();

  log('watching league ' + LEAGUE + ' from seat ' + TEAM + '. Posting to ' + SERVICE + '.');
})();
