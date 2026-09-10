// ==UserScript==
// @name         Yahoo league reader
// @namespace    fantasy-football-draft-room
// @version      1.4.2
// @description  Read your own Yahoo league in season - settings, scoring, teams and rosters - and hand it to the draft room running on your machine. Reads only; never writes to Yahoo.
// @match        https://*.fantasysports.yahoo.com/f1/*
// @downloadURL  http://127.0.0.1:5178/userscript/yahoo-league-reader.user.js
// @updateURL    http://127.0.0.1:5178/userscript/yahoo-league-reader.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Read a Yahoo league in season, and hand it to the draft room service.
 *
 * ONE FILE, TWO INSTALLS, AND THE MODE IS STAMPED IN RATHER THAN GUESSED.
 *
 * As a userscript it runs itself on your league page and then re-reads on a
 * beat, so a lineup you change in Yahoo reaches the app without a click. As a
 * bookmarklet it does exactly what it always did: reads once, when clicked,
 * and refreshes nothing on its own.
 *
 * Both are this file. The service stamps the mode into the copy it hands out --
 * see `MODE` below, and note that the mark is written nowhere else in this
 * file, because the substitution takes the first occurrence and a mention in a
 * comment would be the one it landed on. Nothing inside a script can tell how
 * it was invoked, and a bookmarklet that quietly left a poller running in the
 * page would be a surprise the install page promised the opposite of.
 *
 * The bookmarklet is kept and not replaced. `DECISIONS.md` chose it over a
 * userscript for one reason that has not gone away -- a userscript manager is a
 * place a script goes stale in silence, and 2026-09-07 cost three mock drafts
 * to exactly that -- so it stays as the install that cannot fail without
 * saying so. See the 2026-09-09 entry for what reopened the question: an
 * in-season screen now consumes the snapshot, which is the condition the
 * original decision named.
 *
 * It is still not part of `yahoo-draft-bridge.user.js`. The bridge has to be a
 * userscript for a reason this does not share: it wraps `WebSocket` before
 * Yahoo's own bundle builds one, and only code injected at `document-start` can
 * do that. Sharing an install would give this every way that one can fail.
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

  /*
   * How this copy was installed, and so whether it re-reads on its own.
   *
   * Stamped by the service on the way out, per the note at the top of the file.
   * Unstamped means the source is being read live -- by a check, or by hand --
   * and that reads as the bookmarklet's behaviour, because a one-shot is the
   * safe thing to be wrong about. A check that wants the beat stamps the mark
   * the way the service does, which is the same substitution and not a stub.
   */
  const MODE = '__READER_MODE__';
  const AUTO = MODE === 'userscript';

  /*
   * RAISE `@version` ABOVE WHENEVER THIS FILE CHANGES, or an installed copy
   * never updates. The build stamp is what says which copy is running and it is
   * derived from the source, so it cannot be forgotten -- but a manager decides
   * whether to fetch at all by comparing `@version`, and a body that changed
   * under an unchanged version is a copy the manager will keep serving forever
   * while reporting no fault. That is the shape of 2026-09-07, which cost three
   * mock drafts, and this file caught itself doing it once already: the advice
   * panel landed with the version left at 1.0.0.
   */

  // ---- How often ---------------------------------------------------------

  /*
   * The beat, in minutes, kept where every other setting in this project is
   * kept: the user's own browser. This one has to live on Yahoo's origin rather
   * than the app's, because that is the only origin this code ever runs on and
   * no page can read another's storage.
   *
   * Zero means read on load and never again, which is the whole of the
   * difference between the two installs made adjustable instead of fixed.
   *
   * The floor is a runaway guard and not a preference. `OFFERED` is what the
   * panel will set, so nothing a user clicks can get near it; it exists because
   * the value is a number in storage that a hand could edit to 0.001 and point
   * eleven requests a second at somebody else's service.
   */
  const MINUTES_KEY = 'draftroom.readerMinutes';
  const DEFAULT_MINUTES = 10;
  const FLOOR_MS = 5000;
  const OFFERED = [0, 5, 10, 15, 30, 60];

  function minutes() {
    try {
      const raw = window.localStorage.getItem(MINUTES_KEY);
      /*
       * NOTHING SET AND A DELIBERATE ZERO ARE DIFFERENT ANSWERS, and both ways
       * of collapsing them are wrong. `|| DEFAULT` reads a chosen `never` as
       * unset and starts polling anyway. `Number(raw)` alone reads unset as
       * zero, because `Number(null)` is 0, and a fresh install would then never
       * come back while the panel lit `never` -- which is what this did until
       * `reader.test.mjs` asked what the default was.
       */
      if (raw === null || raw === '') return DEFAULT_MINUTES;
      const held = Number(raw);
      return Number.isFinite(held) && held >= 0 ? held : DEFAULT_MINUTES;
    } catch {
      // Storage can be denied outright. That is not a reason to stop reading,
      // only a reason to stop remembering, so the default stands.
      return DEFAULT_MINUTES;
    }
  }

  function setMinutes(value) {
    try {
      window.localStorage.setItem(MINUTES_KEY, String(value));
    } catch { /* denied, so this session only; the beat below still changes */ }
  }

  // ---- What the app makes of it -------------------------------------------

  /*
   * The advice, read back off the service and painted here.
   *
   * WHY IT IS IN THIS PANEL AND NOT A SECOND ONE. `TASKS.md` planned it as its
   * own bookmarklet, on `draft-panel.js`'s pattern, and that was written before
   * this file became a userscript. Now that it is, a second install would be a
   * second thing to go stale and would have to poll the service and guess when
   * a read had landed. This knows: the advice is fetched immediately after the
   * post that produced it, so what is on screen is always the reading above it.
   *
   * It reads one address on the loopback. It never asks Yahoo for anything, and
   * it never writes a lineup -- setting it stays the user's own action, in the
   * page underneath. See `SPEC.md`.
   */
  let advised = '';

  /**
   * Anything from Yahoo or the service, safe to put in the panel.
   *
   * The names in here are a league's real players and real team names, arriving
   * as text and going into markup. Escaped rather than trusted: this runs in the
   * user's own signed-in Yahoo page, which is the last place to be relaxed about
   * putting a string somebody else chose into `innerHTML`.
   */
  const esc = (text) => String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /** How a desk is labelled, so a heading is a desk and not a field name. */
  const DESK_LABEL = { sleeper: 'Sleeper', espn: 'ESPN' };

  const points = (n) => (typeof n === 'number' ? n.toFixed(1) : '—');
  const line = (text, colour) => `<div style="color:${colour || '#b9c2bd'}">${text}</div>`;

  function adviceHtml(got) {
    /*
     * NO ADVICE IS NOT AN EMPTY LINEUP, and the service already says which of
     * the several reasons it is. A panel that painted nothing here would be the
     * failure the app's own screen was fixed for.
     */
    if (!got || !got.advice) {
      return line(esc((got && (got.error || got.hint)) || 'No advice came back.'), '#e0b96c');
    }

    const advice = got.advice;
    const answered = advice.answered || [];
    if (!answered.length) {
      return line('No projection desk answered, so there is nothing to advise.', '#e0b96c');
    }

    const desks = answered.map((key) => {
      const desk = advice.desks[key];
      /*
       * A gain of null is not a gain of zero: a player in the lineup has no
       * projection from this desk, so the difference is missing a term of
       * unknown size. The app's screen makes the same distinction.
       */
      const gain = desk.gain === null || desk.gain === undefined ? 'gain unknown'
        : desk.gain > 0 ? '+' + points(desk.gain) : 'no change';
      /*
       * A RELOCATION IS NOT A SWAP, and it is listed apart from them for the
       * reason the app's screen does it: the player starts either way, so
       * nobody is coming out of the lineup for him and both halves of a swap
       * line would be wrong about him. He was on both sides of this list twice
       * before the swaps were computed over the whole lineup.
       */
      const moved = (desk.moved || []).map((move) => line(
        'move <b style="color:#e8e6e3">' + esc(move.name) + '</b> '
          + esc(move.from) + ' → ' + esc(move.to),
      )).join('');
      const moves = desk.moves.length
        ? desk.moves.map((move) => line(
          '<span style="color:#6b7370">' + esc(move.slot) + '</span> '
            + (move.out ? 'bench ' + esc(move.out.name) + ' → ' : 'start ')
            + '<b style="color:#e8e6e3">' + esc(move.in.name) + '</b>',
        )).join('')
        : moved ? '' : line('leaves the lineup as it is', '#6b7370');
      return '<div style="margin-top:6px">'
        + line('<b style="color:#e8e6e3">' + esc(DESK_LABEL[key] || key) + '</b> '
          + points(desk.currentPoints) + ' now · ' + points(desk.points) + ' best · ' + gain)
        + moves + moved + '</div>';
    }).join('');

    // Only who the desks do not agree about, because that alone is a decision.
    // Who they both start is said on the app's screen and not here: it is most
    // of the roster, and it crowds out the one line worth reading in a panel
    // this size.
    const disputed = advice.disputed && advice.disputed.length
      ? line('They disagree about ' + advice.disputed.map((row) => row.picks
        .map((pick) => esc(pick.player || 'nobody') + (pick.slot ? ' ' + esc(pick.slot) : ''))
        .join(' or ')).join('; ') + '.', '#e9c46a')
      : '';

    /*
     * Said here as well as on the app's screen, and it belongs here more: this
     * panel is on the page where the moves get made. Yahoo publishes no kickoff
     * time at any scope, so advice offered as though nothing had locked is
     * advice to make moves Yahoo may refuse.
     */
    const locks = advice.locksKnown ? ''
      : line('Locks are not known — check each move is still allowed.', '#6b7370');

    return '<div style="margin-top:9px; padding-top:8px; border-top:1px solid #2a3230;'
      + ' white-space:normal">'
      + line('<b style="color:#e8e6e3">This week</b>'
        + (got.week ? ' <span style="color:#6b7370">week ' + esc(got.week) + '</span>' : ''))
      + desks + disputed + locks
      + '</div>';
  }

  /** Read the advice for the league just posted, and never throw over it. */
  async function readAdvice(leagueId) {
    try {
      const res = await fetch(SERVICE + '/api/yahoo/league/' + leagueId + '/lineup');
      advised = adviceHtml(await res.json());
    } catch (err) {
      // Said rather than left blank, on the same rule as everything else here:
      // a panel that shows nothing gives nowhere to look.
      advised = line('Could not reach the advice on ' + SERVICE + ': '
        + esc(err && err.message ? err.message : err), '#e06c6c');
    }
  }

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
    const every = minutes();

    /*
     * The beat control, and only where there is a beat. As a bookmarklet this
     * panel is a message that goes away again, and giving that a setting
     * nothing acts on would be an invitation to set it.
     */
    const button = (m) => `<button data-min="${m}" style="margin:2px 1px 0;
        padding:2px 7px; border-radius:4px; cursor:pointer; font:inherit;
        background:${m === every ? '#22302a' : '#1a201e'};
        border:1px solid ${m === every ? '#7fca88' : '#2a3230'};
        color:${m === every ? '#7fca88' : '#b9c2bd'};">${m || 'never'}</button>`;
    const control = AUTO ? `
      <div style="margin-top:9px; padding-top:8px; border-top:1px solid #2a3230;
                  color:#b9c2bd; white-space:normal;">
        Read again every ${OFFERED.map(button).join('')} ${every ? 'min' : ''}
      </div>` : '';

    host.shadowRoot.innerHTML = `
      <div style="position:fixed; right:16px; bottom:16px; z-index:2147483647;
                  max-width:380px; max-height:72vh; overflow:auto;
                  padding:12px 14px; border-radius:8px;
                  background:#0f1211; color:${colour}; border:1px solid #2a3230;
                  font:13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif;
                  box-shadow:0 6px 24px rgba(0,0,0,.45); white-space:pre-wrap;">
        <b style="color:#e8e6e3">Draft room</b><br>${text}${advised}${control}
      </div>`;

    if (!AUTO) {
      // Nothing here takes the mouse, so a click where it sits still reaches
      // the page underneath. It goes on its own after a while.
      host.shadowRoot.firstElementChild.style.pointerEvents = 'none';
      clearTimeout(show.timer);
      if (tone !== 'busy') show.timer = setTimeout(() => host.remove(), 9000);
      return;
    }

    /*
     * The panel stays where there is a beat, which is the point rather than an
     * oversight: a reader polling a league every ten minutes for the rest of
     * the season should not be invisible while it does it. It is the only place
     * that says the beat is running and the only place that can stop it.
     *
     * Listeners are attached after every render because the render replaces the
     * markup and takes the old ones with it.
     */
    for (const control_ of host.shadowRoot.querySelectorAll('button[data-min]')) {
      control_.addEventListener('click', () => {
        setMinutes(Number(control_.dataset.min));
        plan();
        show(text, tone);
      });
    }
  }

  // ---- The beat ----------------------------------------------------------

  let beat = null;
  let reading = false;

  /**
   * Schedule the next read, or do not, which is the same decision either way.
   *
   * Called after every read including a failed one, because a beat that stopped
   * on one refused request would be a reader that quietly went back to being a
   * bookmarklet, and the panel would still say it was running.
   */
  function plan() {
    clearTimeout(beat);
    beat = null;
    const every = minutes();
    if (!AUTO || !every) return;
    beat = setTimeout(() => { run(); }, Math.max(every * 60000, FLOOR_MS));
  }

  /*
   * NOT GATED ON WHETHER THE TAB IS VISIBLE, which is worth saying because
   * skipping a hidden tab is the obvious thing and it would break the feature.
   * The point of the beat is that the league page sits in a background tab
   * while the user looks at the app in another one, so the tab doing the
   * reading is the tab nobody is looking at, nearly always.
   */

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

  // ---- Yahoo's own projection ------------------------------------------

  /*
   * THE ONE THING HERE THAT READS A PAGE INSTEAD OF AN API, and the exception
   * is argued rather than assumed.
   *
   * Yahoo prints a `Proj Pts` column against every player on a team's roster
   * page and publishes it at no `/fantasy/v2` path at all. That was probed on
   * 2026-09-09 against a real signed-in league: `out=projected_points` and
   * `out=projected_stats` are refused as invalid player resources at team and
   * at league scope alike, and the only projection anywhere in a fantasy-v2
   * response is `team_projected_points` on the scoreboard, which is a total for
   * the team and says nothing about who is worth starting. The page is the
   * only source there is.
   *
   * WHY THE EXTRACTION IS HERE AND NOT IN THE SERVICE, which is a departure
   * from the rule at the top of this file and was decided rather than drifted
   * into. The rule exists so that a shape Yahoo changes has one place to be
   * fixed, and that still holds: this is the one place, and `reader.test.mjs`
   * reaches it with real markup through `linkedom`. What the rule cannot pay
   * for here is the freight. A roster page is 1.14 MB and there are one per
   * team, so posting them unread would put about 9 MB on the wire every beat
   * to re-parse a DOM the browser has already built. This posts about 5 KB.
   *
   * A COLUMN THAT IS NOT THERE RETURNS NULL AND NEVER AN EMPTY LIST. HTML has
   * no contract, so the day Yahoo renames the heading this must report that it
   * found nothing rather than that nobody is projected -- the second reads as
   * a league of players with no numbers, which is what a zero would be too.
   */
  const PROJ_HEADER = /proj\s*pts/i;

  function projectionsFrom(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    let sawColumn = false;

    /*
     * Three tables carry the column, not one -- offence, kickers and defence
     * are rendered separately -- so every table is looked at and the ones
     * without the heading are skipped.
     */
    for (const table of doc.querySelectorAll('table')) {
      /*
       * The column is found by its heading and never by a class. The cell is
       * `<td class="Ta-end Nowrap">`, which several numeric columns share, so
       * a class would pick up whichever came first. The heading sits in the
       * second header row, under a group row that spans it, which is why this
       * looks for the row that holds it rather than assuming the first.
       */
      /*
       * COUNTED IN COLUMNS AND NOT IN CELLS, which is a distinction Yahoo
       * charges for. `<th colspan="2">Action</th>` sits between `Offense` and
       * `Bye` on another manager's roster page, so a body row there holds one
       * more cell than its header row holds headings, and the nth heading is
       * not the nth cell. Counting headings put this one column to the left,
       * onto `Fan Pts` -- which before kickoff is an en dash for everybody, so
       * a whole league read as unprojected, and after kickoff is a real number,
       * so the few players who had played were posted with their actual score
       * standing in for a projection. Measured on 2026-09-10 against a real
       * league: seventeen of seventeen on the user's own page, which has no
       * such heading, and one or two per rival.
       */
      let at = -1;
      let columns = 0;
      for (const row of table.querySelectorAll('thead tr')) {
        // The attribute rather than the `colSpan` property: this has to give
        // the same answer under the DOM the browser builds and under the one
        // `reader.test.mjs` parses, and only the attribute is common to both.
        const span = (head) => Number(head.getAttribute('colspan')) || 1;
        let across = 0;
        for (const head of row.querySelectorAll('th')) {
          if (at < 0 && PROJ_HEADER.test(head.textContent || '')) at = across;
          across += span(head);
        }
        if (at >= 0) {
          columns = across;
          break;
        }
      }
      if (at < 0) continue;
      sawColumn = true;

      for (const row of table.querySelectorAll('tbody tr')) {
        /*
         * `data-ys-playerid` is Yahoo's own id for the player and the same
         * number the API writes as the `p.` half of a player key, so this
         * joins exactly and nothing here matches on a name.
         */
        const held = row.querySelector('[data-ys-playerid]');
        const id = held && held.getAttribute('data-ys-playerid');
        const cells = row.querySelectorAll('td');
        // A row that is not as wide as its own header is a row this cannot
        // line up, so nothing is read off it rather than something from
        // whichever column the count happened to land on.
        if (cells.length !== columns) continue;
        const read = ((cells[at] && cells[at].textContent) || '').trim();
        const pts = Number(read);
        // A dash is what an unprojected player shows, and it is not a zero.
        if (id && read !== '' && Number.isFinite(pts)) out.push({ id: String(id), pts });
      }
    }

    return sawColumn ? out : null;
  }

  /**
   * Every team's projections, one roster page each.
   *
   * A page that will not come is dropped rather than failing the read: the
   * snapshot is worth having without it, and the service takes a team missing
   * from this list as one it knows nothing about rather than one projected at
   * nothing.
   */
  async function readProjections(leagueId, teamIds) {
    const one = async (teamId) => {
      const res = await fetch(location.origin + '/f1/' + leagueId + '/' + teamId,
        { credentials: 'include' });
      if (!res.ok) throw new Error('the roster page answered ' + res.status);
      return { teamId: String(teamId), players: projectionsFrom(await res.text()) };
    };
    const answered = await Promise.all(teamIds.map((id) => one(id).catch(() => null)));
    return answered.filter(Boolean);
  }

  // ---- The run ----------------------------------------------------------

  async function run() {
    /*
     * One read at a time. Eleven requests take a moment, so a beat can fall
     * inside the previous read on a slow connection, and two snapshots of one
     * league in flight would race over which landed last.
     */
    if (reading) return;

    /*
     * Neither of these schedules a beat, and both return before `reading` is
     * taken. An address cannot change without a navigation and a navigation
     * loads this file again, so a reader that cannot find a league here will
     * never find one -- repeating the same complaint every ten minutes would
     * be the only thing it ever did.
     */
    if (!/fantasysports\.yahoo\.com$/.test(location.hostname)) {
      show('This has to run on your Yahoo league page — it reads Yahoo using the '
        + 'session your browser already holds, which no other tab has.', 'bad');
      return;
    }
    const where = leagueFromUrl();
    if (!where) {
      show('No league in this address. Open your league — the page whose address '
        + 'has <b>/f1/</b> and a number in it.', 'bad');
      return;
    }

    reading = true;
    show('Reading league ' + where.leagueId + '…', 'busy');

    try {
      // The profile says who you are; the teams say who everyone is. The
      // service matches the guid across them, so neither is useful alone and
      // both are read before anything is sent.
      const profile = await readJson('/users;use_login=1/profile');
      const leagueKey = 'nfl.l.' + where.leagueId;

      /*
       * The scoreboard rides alongside, and it answers two things nothing else
       * here could. It pairs the teams up, so the app can put the team you are
       * playing at the top of the league rather than leaving it in team order;
       * and each team node carries `team_projected_points`, which is the number
       * Yahoo prints on its own matchup card and the only Yahoo projection this
       * project has ever been able to reach.
       *
       * It is caught rather than awaited bare. Everything else in a snapshot is
       * worth having without it, and a league whose scoreboard will not come
       * should still read -- the service takes a null here as "not sent".
       */
      const [settings, teams, scoreboard] = await Promise.all([
        readJson('/league/' + leagueKey + '/settings'),
        readJson('/league/' + leagueKey + '/teams'),
        readJson('/league/' + leagueKey + '/scoreboard').catch(() => null),
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
      /*
       * The rosters and the projections together, because they come from two
       * different hosts -- the API and the league's own pages -- and a browser
       * queues per host, so running them apart would serialise two queues that
       * do not contend.
       */
      const [answered, projections] = await Promise.all([
        Promise.all(teamIds.map(
          (id) => readJson('/team/' + leagueKey + '.t.' + id + '/roster').catch(() => null),
        )),
        readProjections(where.leagueId, teamIds).catch(() => []),
      ]);
      const rosters = answered.filter(Boolean);
      const missing = teamIds.filter((id, at) => !answered[at]);

      const res = await fetch(SERVICE + '/api/yahoo/league/' + where.leagueId + '/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings, teams, rosters, profile, scoreboard, projections }),
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
      const said = 'Read ' + esc(body.name || 'the league') + ': ' + (body.teams || []).length
        + ' teams, ' + slots + ' starting slots, ' + (body.scoring || []).length
        + ' scoring rules, ' + read.length + ' rosters holding ' + players + ' players.'
        + (missing.length ? '\nTeam' + (missing.length > 1 ? 's ' : ' ') + missing.join(', ')
          + ' did not answer, so ' + (missing.length > 1 ? 'those rosters are' : 'that roster is')
          + ' missing.' : '')
        + (STAMPED ? '' : '\n(running from source, not a stamped copy)');
      const tone = missing.length ? 'bad' : undefined;
      show(said, tone);

      /*
       * Then the advice, and only where the panel stays to hold it. As a
       * bookmarklet this message fades after nine seconds, so advice painted
       * under it would be gone before it was read, and the app's own screen is
       * a better place to have put it.
       *
       * Painted in a second pass rather than awaited before the first, so the
       * reading is on screen while the advice is being worked out. It is the
       * slower half: the service scores every roster against two desks.
       */
      if (AUTO) {
        await readAdvice(where.leagueId);
        show(said, tone);
      }
    } catch (err) {
      // Every fault is said out loud. A bookmarklet that fails silently is
      // worse than no bookmarklet, because there is nowhere to look.
      show(String(err && err.message ? err.message : err)
        + '\n\nIf that names the service, check it is running on ' + SERVICE + '.', 'bad');
    } finally {
      reading = false;
      // After the failure as well as the success. See `plan`.
      plan();
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
