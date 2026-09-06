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
    '  width: 320px; pointer-events: none; background: #111514; color: #f0eee9;',
    '  border: 1px solid #2b3330; border-left: 3px solid #b78a2e; border-radius: 6px;',
    '  font: 13px/1.4 -apple-system, Segoe UI, Roboto, sans-serif;',
    '  box-shadow: 0 6px 20px rgba(0,0,0,0.4); }',
    '.wrap.clock { border-left-color: #3fa34d; }',
    '.head { display: flex; gap: 6px; align-items: center; padding: 7px 10px;',
    '  border-bottom: 1px solid #2b3330; }',
    '.title { font-size: 11px; font-weight: 700; letter-spacing: .1em;',
    '  text-transform: uppercase; color: #a9b2ad; }',
    '.wrap.clock .title { color: #6cc77a; }',
    '.pick { margin-left: auto; font-size: 12px; color: #cdd4d0; font-variant-numeric: tabular-nums; }',
    '.hide { pointer-events: auto; cursor: pointer; background: none; border: 0;',
    '  color: #a9b2ad; font: inherit; font-size: 14px; line-height: 1; padding: 0 2px; }',
    '.hide:hover { color: #f0eee9; }',
    '.lean { margin: 0; padding: 7px 10px 0; color: #d9a83c; font-size: 12px; }',
    /*
     * THE PICK, WHICH IS WHY THE PANEL IS OPEN
     *
     * Everything under it is the reasoning. This is the answer, so it is the
     * one thing sized to be read at a glance from across a draft room, and it
     * carries its arithmetic underneath so it can be argued with.
     */
    '.take { margin: 7px 10px 0; padding: 7px 9px; border-radius: 4px;',
    '  background: rgba(63,163,77,0.13); border: 1px solid rgba(63,163,77,0.4); }',
    '.take-head { display: flex; align-items: baseline; gap: 7px; }',
    '.take-tag { font-size: 10px; font-weight: 700; letter-spacing: .12em;',
    '  text-transform: uppercase; color: #6cc77a; flex: none; }',
    '.take-name { font-size: 15px; font-weight: 700; overflow: hidden;',
    '  text-overflow: ellipsis; white-space: nowrap; }',
    '.take-pos { margin-left: auto; font-size: 11px; font-weight: 700; color: #a9b2ad; flex: none; }',
    '.take-why { margin: 3px 0 0; font-size: 11px; color: #b9c2bd; }',
    '.rows { padding: 5px 10px 8px; }',
    '.row { display: grid; grid-template-columns: 30px minmax(0,1fr) auto auto; gap: 4px 7px;',
    '  align-items: baseline; padding: 4px 0; border-top: 1px solid #1e2523; }',
    '.row:first-child { border-top: 0; }',
    '.pos { font-size: 11px; font-weight: 700; color: #a9b2ad; }',
    '.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.worth { font-variant-numeric: tabular-nums; font-weight: 700; color: #f0eee9; font-size: 13px; }',
    '.cost { font-variant-numeric: tabular-nums; color: #d9a83c; font-size: 12px; min-width: 30px;',
    '  text-align: right; }',
    '.odds { grid-column: 2 / -1; font-size: 11px; color: #8b948f; }',
    '.foot { margin: 0; padding: 6px 10px 8px; border-top: 1px solid #2b3330;',
    '  font-size: 10px; color: #7f8884; }',
    '.empty { padding: 10px; color: #a9b2ad; font-size: 12px; }',
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

  /** A small helper, because every line below is the same three steps. */
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * The pick, and the arithmetic behind it.
   *
   * Shown only when the board sent one. It says nothing when the top two are
   * close enough that naming one would invent a decision rather than report it,
   * and an empty box would read as a failure rather than as that answer.
   */
  function take(p) {
    const box = el('div', 'take');
    const head = el('div', 'take-head');
    head.append(
      el('span', 'take-tag', 'Take'),
      el('span', 'take-name', p.name || ''),
      el('span', 'take-pos', p.position || ''),
    );

    const why = '+' + Math.round(p.worth) + ' over a replacement ' + (p.position || '')
      + (p.urgency >= 1 ? ', and ' + Math.round(p.urgency) + ' of that goes if you wait' : '')
      + (p.fillsStarter
        ? '. You still have to start one.'
        : '. Your lineup is full, so this is on worth alone.');

    box.append(head, el('p', 'take-why', why));
    return box;
  }

  /** One line: the position, who is left at it, what he is worth, and the wait. */
  function row(r) {
    const line = el('div', 'row');
    const cliff = r.beforeCliff === 1
      ? 'then a drop'
      : Math.round(r.beforeCliff || 0) + ' before the drop';

    line.append(
      el('span', 'pos', r.position || ''),
      el('span', 'name', r.name || ''),
      el('span', 'worth', (r.worth > 0 ? '+' : '') + Math.round(r.worth || 0)),
      el('span', 'cost', r.cost >= 0.5 ? '-' + Math.round(r.cost) : '0'),
      el('span', 'odds', Math.round((r.odds || 0) * 100) + '% he lasts - ' + cliff),
    );
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

    if (advice && advice.lean) wrap.append(el('p', 'lean', advice.lean));
    if (advice && advice.pick) wrap.append(take(advice.pick));

    const rows = (advice && advice.rows) || [];
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Waiting for the draft board on this machine. '
        + 'Follow this draft in the app and it fills in.';
      wrap.append(empty);
    } else {
      const list = el('div', 'rows');
      for (const r of rows) list.append(row(r));
      wrap.append(list);

      /*
       * What the numbers were read off, which is what they mean. A run already
       * under way moves a room reading and cannot move an ADP one, so a panel
       * that does not say which is a panel you cannot weigh.
       */
      const src = advice.source;
      wrap.append(el('p', 'foot', src && src.kind === 'room'
        ? 'From ' + src.sims + ' runs of this room, off the real picks.'
        : 'Read off ADP, not this room, so a run already under way will not show.'));
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
