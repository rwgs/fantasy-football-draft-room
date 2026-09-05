/*
 * The draft board's reading of the room, shown over the room itself.
 *
 * Separate from `yahoo-draft-bridge.user.js` on purpose. The bridge has to be a
 * userscript: it wraps `WebSocket` before Yahoo's own bundle builds one, and
 * nothing but code injected at `document-start` can do that. This needs none of
 * it. It reads one address on the loopback and draws, so it runs from a
 * bookmarklet, from the console, or from anywhere else with a DOM.
 *
 * Splitting them was not tidiness. The panel spent a whole draft invisible
 * because it was riding inside a userscript a manager would not replace, and a
 * thing that needs no privileges should not inherit the failure modes of one
 * that does.
 *
 * It never talks to Yahoo, never reads a cookie, and sends nothing anywhere. It
 * reads `GET /api/yahoo/room/<league>/advice` on this machine and paints it.
 *
 * HOW IT STAYS OUT OF THE WAY
 *   - One element on the end of the body, holding a shadow root, so no style
 *     crosses in either direction and none of Yahoo's nodes are touched.
 *   - Everything in it ignores the mouse except the button that closes it, so a
 *     click where it sits still reaches the draft underneath.
 *   - No key handler, no focus, no storage.
 *   - Every fault is caught and said out loud rather than thrown or swallowed.
 */
(() => {
  const SERVICE = 'http://127.0.0.1:5178';
  const EVERY_MS = 2500;
  const ID = 'draft-room-panel';

  const log = (...a) => console.log('[draft-panel]', ...a);

  /*
   * Which league, from whichever frame is showing the draft.
   *
   * The room's own address carries it: `/draftclient/f1/<league>/<team>`. The
   * page is checked first and then any iframe, because this is clicked or
   * pasted from wherever the person happens to be rather than injected into a
   * frame chosen for it.
   */
  const urls = [location.href].concat(
    [...document.querySelectorAll('iframe')].map((f) => f.src),
  );
  const found = urls
    .map((u) => (u || '').match(/\/draftclient\/[^/]+\/(\d{4,})\/(\d+)/))
    .find(Boolean);

  if (!found) {
    log('no Yahoo draft room on this page. Open your draft room and try again.');
    return;
  }
  const LEAGUE = found[1];
  log('league ' + LEAGUE + ', seat ' + found[2] + '. Reading ' + SERVICE + '.');

  const CSS = [
    ':host { all: initial; }',
    '.wrap { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000;',
    '  width: 246px; pointer-events: none; background: #111514; color: #e8e6e3;',
    '  border: 1px solid #2b3330; border-left: 2px solid #b78a2e; border-radius: 6px;',
    '  font: 12px/1.35 -apple-system, Segoe UI, Roboto, sans-serif;',
    '  box-shadow: 0 6px 20px rgba(0,0,0,0.4); }',
    '.wrap.clock { border-left-color: #3fa34d; }',
    '.head { display: flex; gap: 6px; align-items: center; padding: 6px 8px;',
    '  border-bottom: 1px solid #2b3330; }',
    '.title { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #8b948f; }',
    '.pick { margin-left: auto; font-size: 11px; color: #b9c2bd; font-variant-numeric: tabular-nums; }',
    '.hide { pointer-events: auto; cursor: pointer; background: none; border: 0;',
    '  color: #8b948f; font: inherit; font-size: 13px; line-height: 1; padding: 0 2px; }',
    '.hide:hover { color: #e8e6e3; }',
    '.lean { margin: 0; padding: 6px 8px 0; color: #b78a2e; font-size: 11px; }',
    '.rows { padding: 4px 8px 8px; }',
    '.row { display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 6px;',
    '  align-items: baseline; padding: 3px 0; }',
    '.pos { font-size: 10px; font-weight: 700; color: #8b948f; }',
    '.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.cost { font-variant-numeric: tabular-nums; color: #b9c2bd; font-size: 11px; }',
    '.odds { grid-column: 2 / -1; font-size: 10px; color: #6f7873; }',
    '.empty { padding: 8px; color: #8b948f; font-size: 11px; }',
  ].join(String.fromCharCode(10));

  let host = null;
  let shadow = null;
  let closed = false;

  /**
   * Put it up, and put it back.
   *
   * A draft room is a single page app and can replace everything under the body
   * as it renders, taking the panel with it, so this runs on every beat rather
   * than once.
   */
  function mount() {
    if (closed || !document.body) return;
    if (host && host.isConnected) return;
    if (!host) {
      const already = document.getElementById(ID);
      if (already) already.remove();
      host = document.createElement('div');
      host.id = ID;
      shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.append(style);
    }
    document.body.append(host);
  }

  /** One line: the position, who is left at it, and what waiting costs. */
  function row(r) {
    const line = document.createElement('div');
    line.className = 'row';

    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = r.position || '';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = r.name || '';

    const cost = document.createElement('span');
    cost.className = 'cost';
    cost.textContent = r.cost >= 0.5 ? '-' + Math.round(r.cost) : '0';

    const odds = document.createElement('span');
    odds.className = 'odds';
    odds.textContent = Math.round((r.odds || 0) * 100) + '% he lasts';

    line.append(pos, name, cost, odds);
    return line;
  }

  function render(advice) {
    if (!shadow || closed) return;
    for (const old of shadow.querySelectorAll('.wrap')) old.remove();

    const wrap = document.createElement('div');
    wrap.className = 'wrap' + (advice && advice.onClock ? ' clock' : '');

    const head = document.createElement('div');
    head.className = 'head';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = advice && advice.onClock ? 'Your pick' : 'Cost of waiting';

    const pick = document.createElement('span');
    pick.className = 'pick';
    pick.textContent = (advice && advice.pickLabel) || '';

    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'hide';
    hide.textContent = 'x';
    hide.title = 'Close this panel';
    hide.addEventListener('click', (e) => {
      e.stopPropagation();
      closed = true;
      if (host) host.remove();
    });

    head.append(title, pick, hide);
    wrap.append(head);

    if (advice && advice.lean) {
      const lean = document.createElement('p');
      lean.className = 'lean';
      lean.textContent = advice.lean;
      wrap.append(lean);
    }

    const rows = (advice && advice.rows) || [];
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Waiting for the draft board on this machine. '
        + 'Follow this draft in the app and it fills in.';
      wrap.append(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'rows';
      for (const r of rows) list.append(row(r));
      wrap.append(list);
    }

    shadow.append(wrap);
  }

  let moaned = false;
  async function beat() {
    if (closed) return;
    try {
      mount();
      if (!document.hidden) {
        const res = await fetch(SERVICE + '/api/yahoo/room/' + LEAGUE + '/advice', {
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('the service answered ' + res.status);
        render((await res.json()).advice);
      }
    } catch (err) {
      // Said once, and never thrown. A fault nobody can see is a fault nobody
      // can fix, and one that reaches the page is a fault in the draft.
      if (!moaned) {
        moaned = true;
        log('could not read the board:', (err && err.message) || err);
      }
    }
    setTimeout(beat, EVERY_MS);
  }

  mount();
  render(null);
  beat();
  log('panel up, bottom left. Close it with the x in its corner.');
})();
