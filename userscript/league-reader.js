/*
 * Read a Yahoo league in season, and hand it to the draft room service.
 *
 * A bookmarklet, on the same reasoning as `draft-panel.js` and for the same
 * reason it is not part of `yahoo-draft-bridge.user.js`. The bridge has to be a
 * userscript: it wraps `WebSocket` before Yahoo's own bundle builds one, and
 * only code injected at `document-start` can do that. This needs none of it.
 * It makes four ordinary fetches when you click it. See `DECISIONS.md`,
 * 2026-09-08, for the decision and what it costs.
 *
 * WHAT IT SENDS, AND WHAT IT NEVER SENDS
 *
 * It sends Yahoo's own JSON, unread, to this machine. `server/src/platforms/
 * yahoo/league.js` does every bit of the interpreting, because a reader in the
 * page that formed its own opinion would be a second place to fix when Yahoo
 * changes a shape.
 *
 * It never sends a cookie, a token or a crumb, and the service would not take
 * one. The browser attaches your session itself, which is the whole reason this
 * works without an API key and the whole reason it has to run here rather than
 * in the service.
 *
 * It writes nothing to Yahoo. Every request is a GET.
 *
 * WHY IT HAS TO RUN ON A YAHOO PAGE
 *
 * The panel only needed a DOM, so it ran anywhere. This needs the cookie, so it
 * has to run on a `fantasysports.yahoo.com` page — clicking it on the app's own
 * tab reaches nothing. It says so rather than failing quietly.
 */
(() => {
  const SERVICE = 'http://127.0.0.1:5178';
  const API = 'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2';
  const ID = 'draft-room-league-reader';

  /*
   * Which copy of this file is running.
   *
   * A bookmarklet carries its whole source in its own address, so the one on
   * the bookmarks bar is a photograph taken when it was dragged and cannot
   * update itself. `/league-reader` stamps the build into the copy it hands
   * out; run any other way this stays the mark below, which means the source is
   * being read live and cannot be behind anything.
   */
  const BUILD = '__READER_BUILD__';
  const STAMPED = BUILD !== '__READER' + '_BUILD__';

  // ---- Saying what happened --------------------------------------------

  /*
   * One element on the end of the body holding a shadow root, so no style
   * crosses in either direction and none of Yahoo's nodes are touched. The
   * panel does the same and for the same reasons.
   */
  function show(text, tone) {
    let host = document.getElementById(ID);
    if (!host) {
      host = document.createElement('div');
      host.id = ID;
      host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);
    }
    const colour = tone === 'bad' ? '#e06c6c' : tone === 'busy' ? '#b9c2bd' : '#7fca88';
    host.shadowRoot.innerHTML = `
      <div style="position:fixed; right:16px; bottom:16px; z-index:2147483647;
                  max-width:380px; padding:12px 14px; border-radius:8px;
                  background:#0f1211; color:${colour}; border:1px solid #2a3230;
                  font:13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif;
                  box-shadow:0 6px 24px rgba(0,0,0,.45); white-space:pre-wrap;">
        <b style="color:#e8e6e3">Draft room</b><br>${text}
      </div>`;
    // Nothing here takes the mouse, so a click where it sits still reaches the
    // page underneath. It goes on its own after a while.
    host.shadowRoot.firstElementChild.style.pointerEvents = 'none';
    clearTimeout(show.timer);
    if (tone !== 'busy') show.timer = setTimeout(() => host.remove(), 9000);
  }

  // ---- Which league, and which team ------------------------------------

  /*
   * The league out of the address bar. A league page is `/f1/<league>` with an
   * optional team on the end.
   *
   * The API wants a key like `470.l.<league>`, and that leading number is the
   * game — it changes every season and appears nowhere in the address. It does
   * not have to be found: `nfl.l.<league>` addresses the same league in the
   * current season's game, which was checked against a real league rather than
   * assumed, and the numeric key comes back on the response for the service to
   * read. So nothing here has to know or guess what season it is.
   *
   * The one thing that buys is also its one limit: `nfl` means this season, so
   * this cannot address a past season's league. In-season advice never wants
   * one, and a reader that did would have to find the game key properly.
   */
  function leagueFromUrl() {
    const at = location.pathname.match(/\/f1\/(\d+)(?:\/(\d+))?/);
    return at ? { leagueId: at[1], teamId: at[2] || null } : null;
  }

  async function readJson(path) {
    const res = await fetch(API + path + (path.includes('?') ? '&' : '?') + 'format=json',
      { credentials: 'include' });
    if (!res.ok) throw new Error(path.split('?')[0] + ' answered ' + res.status);
    return res.json();
  }

  // ---- The run ----------------------------------------------------------

  async function run() {
    if (!/fantasysports\.yahoo\.com$/.test(location.hostname)) {
      show('This has to run on your Yahoo league page — it reads Yahoo using the '
        + 'session your browser already holds, which no other tab has.', 'bad');
      return;
    }
    const where = leagueFromUrl();
    if (!where) {
      show('No league in this address. Open your league — the page whose address '
        + 'has <b>/f1/</b> and a number in it — and click this there.', 'bad');
      return;
    }

    show('Reading league ' + where.leagueId + '…', 'busy');

    try {
      // The profile says who you are; the teams say who everyone is. The
      // service matches the guid across them, so neither is useful alone and
      // both are read before anything is sent.
      const profile = await readJson('/users;use_login=1/profile');
      const leagueKey = 'nfl.l.' + where.leagueId;

      const [settings, teams] = await Promise.all([
        readJson('/league/' + leagueKey + '/settings'),
        readJson('/league/' + leagueKey + '/teams'),
      ]);

      // The team is optional: a league page carries one, a league home page may
      // not. Without it the snapshot still has the league and everyone in it.
      let roster = null;
      const teamId = where.teamId || ownTeamId(teams, profile);
      if (teamId) {
        try {
          roster = await readJson('/team/' + leagueKey + '.t.' + teamId + '/roster');
        } catch (err) {
          // A roster that would not come is worth saying and not worth failing
          // for. Everything else already read is still worth having.
          show('Read the league, but not the roster: ' + err.message, 'bad');
        }
      }

      const res = await fetch(SERVICE + '/api/yahoo/league/' + where.leagueId + '/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings, teams, roster, profile }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || ('the service answered ' + res.status));

      const slots = (body.slots || []).filter((s) => s.starting).reduce((n, s) => n + s.count, 0);
      const players = body.roster ? body.roster.players.length : 0;
      show('Read ' + (body.name || 'the league') + ': ' + (body.teams || []).length
        + ' teams, ' + slots + ' starting slots, ' + (body.scoring || []).length
        + ' scoring rules' + (players ? ', ' + players + ' on your roster' : '')
        + '.' + (STAMPED ? '' : '\n(running from source, not a stamped copy)'));
    } catch (err) {
      // Every fault is said out loud. A bookmarklet that fails silently is
      // worse than no bookmarklet, because there is nowhere to look.
      show(String(err && err.message ? err.message : err)
        + '\n\nIf that names the service, check it is running on ' + SERVICE + '.', 'bad');
    }
  }

  /** Your team in the league, by matching your guid to a manager's. */
  function ownTeamId(teams, profile) {
    try {
      const mine = profile.fantasy_content.users['0'].user[0].guid;
      const list = teams.fantasy_content.league[1].teams;
      for (let i = 0; list[String(i)]; i += 1) {
        const meta = list[String(i)].team[0];
        const flat = Object.assign({}, ...meta.filter((x) => x && typeof x === 'object'));
        const managers = flat.managers || [];
        if (managers.some((m) => m.manager && m.manager.guid === mine)) return flat.team_id;
      }
    } catch { /* the service decides this properly; here it only picks a roster */ }
    return null;
  }

  run();
})();
