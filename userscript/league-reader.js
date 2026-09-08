/*
 * Read a Yahoo league in season, and hand it to the draft room service.
 *
 * A bookmarklet, on the same reasoning as `draft-panel.js` and for the same
 * reason it is not part of `yahoo-draft-bridge.user.js`. The bridge has to be a
 * userscript: it wraps `WebSocket` before Yahoo's own bundle builds one, and
 * only code injected at `document-start` can do that. This needs none of it.
 * It makes three ordinary fetches when you click it, plus one per team for the
 * rosters. See `DECISIONS.md`, 2026-09-08, for the decision and what it costs.
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

  // ---- Which league ----------------------------------------------------

  /*
   * The league out of the address bar. A league page is `/f1/<league>`, with a
   * team on the end that is not read: every roster is fetched, so which team
   * page you happened to be on decides nothing.
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
    const at = location.pathname.match(/\/f1\/(\d+)/);
    return at ? { leagueId: at[1] } : null;
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

      /*
       * EVERY ROSTER, NOT ONLY YOURS.
       *
       * A weekly decision is about the whole league: what a trade would cost
       * the other side, who is startable on somebody else's bench, which teams
       * need what. So each team's roster is read, one request each, in parallel.
       *
       * One request each rather than the `/league/<key>/teams/roster` collection
       * the API's own shape suggests would answer in one. That path is not tried
       * here because it has never been run against a real league from this
       * machine, and the per-team path has; an unverified saving is not worth
       * a reader that comes back empty. Worth measuring later.
       */
      const teamIds = allTeamIds(teams);
      // Collected in team order rather than in the order they answer, so two
      // reads of the same league give the same list. A roster that would not
      // come is a null here and is named at the end: it is worth saying and not
      // worth failing for, since everything else read is still worth having.
      const answered = await Promise.all(teamIds.map(
        (id) => readJson('/team/' + leagueKey + '.t.' + id + '/roster').catch(() => null),
      ));
      const rosters = answered.filter(Boolean);
      const missing = teamIds.filter((id, at) => !answered[at]);

      const res = await fetch(SERVICE + '/api/yahoo/league/' + where.leagueId + '/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings, teams, rosters, profile }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || ('the service answered ' + res.status));

      const slots = (body.slots || []).filter((s) => s.starting).reduce((n, s) => n + s.count, 0);
      const read = body.rosters || [];
      const players = read.reduce((n, r) => n + r.players.length, 0);
      // The roster count is said against the team count rather than on its own,
      // because "7 rosters" in an 8 team league is the interesting number and
      // "7 rosters" alone is not. A roster that failed is named on the same
      // message rather than in one that this would replace a moment later.
      show('Read ' + (body.name || 'the league') + ': ' + (body.teams || []).length
        + ' teams, ' + slots + ' starting slots, ' + (body.scoring || []).length
        + ' scoring rules, ' + read.length + ' rosters holding ' + players + ' players.'
        + (missing.length ? '\nTeam' + (missing.length > 1 ? 's ' : ' ') + missing.join(', ')
          + ' did not answer, so ' + (missing.length > 1 ? 'those rosters are' : 'that roster is')
          + ' missing.' : '')
        + (STAMPED ? '' : '\n(running from source, not a stamped copy)'),
      missing.length ? 'bad' : undefined);
    } catch (err) {
      // Every fault is said out loud. A bookmarklet that fails silently is
      // worse than no bookmarklet, because there is nowhere to look.
      show(String(err && err.message ? err.message : err)
        + '\n\nIf that names the service, check it is running on ' + SERVICE + '.', 'bad');
    }
  }

  /**
   * Every team id in the league, out of the teams response.
   *
   * The one place this file reads Yahoo's shape, and it is against the rule at
   * the top of it on purpose: a roster is fetched per team, so the ids have to
   * be known here to make the requests at all. Nothing is decided from them —
   * which team is yours is still the service's answer, from the guid — and a
   * shape this cannot walk yields no ids, at which point the service refuses
   * the snapshot on the same response rather than filing an empty league.
   */
  function allTeamIds(teams) {
    const out = [];
    try {
      const list = teams.fantasy_content.league[1].teams;
      for (let i = 0; list[String(i)]; i += 1) {
        const meta = list[String(i)].team[0];
        const flat = Object.assign({}, ...meta.filter((x) => x && typeof x === 'object'));
        if (flat.team_id) out.push(flat.team_id);
      }
    } catch { /* no ids, so no rosters; the settings and teams still go */ }
    return out;
  }

  run();
})();
