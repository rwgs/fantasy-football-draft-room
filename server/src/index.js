// The data service behind the mock draft simulator.
//
// The draft itself runs in the browser: a pick has to land the instant you
// click, and nothing about a draft needs a server round trip. What does need a
// server is reaching two upstream feeds that do not allow a browser to call
// them directly, caching what they return, and joining the two boards in one
// place so the browser never has to guess whether two records name the same
// player.

import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADP_FEEDS, ADP_RULES, FORMATS, buildBoard, nearestSize } from './board.js';
import { parseRankings } from './rankings.js';
import { PLATFORM_NAMES, platformFor } from './platforms/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/*
 * Settings that belong to this machine rather than to the repository.
 *
 * `server/.env` is where a key goes. It is git ignored, and it is read here
 * rather than by a flag on the command line because this service is started
 * several ways — `npm start`, `npm run dev`, and `scripts/service.mjs` spawning
 * it directly — and a flag would have to be remembered in each of them.
 *
 * Node reads it natively, so this costs no dependency. Missing is the normal
 * case and not an error: every feed the service needs is free and keyless, and
 * only the optional ones look here.
 *
 * Anything reading one of these must read it when it is used, not when its
 * module is imported. Imports are evaluated before this line runs, so a `const`
 * at the top of a source file would capture the value from before the file was
 * loaded.
 */
try {
  process.loadEnvFile(join(HERE, '..', '.env'));
} catch {
  // No file, or no permission to read it. Both mean "nothing configured here".
}

const app = express();
const PORT = Number(process.env.PORT) || 5178;
const DEFAULT_YEAR = Number(process.env.DRAFT_YEAR) || new Date().getFullYear();

/** When this process came up, reported on /api/health so a stale one shows. */
const STARTED_AT = Date.now();

// The Vite proxy puts the client on this origin, so a normal run never meets
// CORS at all. It is open here for anyone running the two halves apart.
app.use(cors());

app.use(express.json({ limit: '4mb' }));
app.use(express.text({ limit: '4mb', type: ['text/csv', 'text/plain'] }));

/**
 * Read the platform and the ID out of the path, or answer and return null.
 *
 * Every one of these IDs is pasted into an upstream URL, so it is checked here
 * rather than trusted. Express decodes a path parameter before this sees it,
 * which is what makes the check worth doing: without it an encoded slash walks
 * the upstream path instead of naming a league.
 *
 * What counts as an ID belongs to the platform. Sleeper writes a long run of
 * digits and Yahoo writes a league key with dots in it, so a single rule here
 * would have to be loose enough to admit both and would stop being a check.
 *
 * The platform name is never echoed back. It is path input, and the reply lists
 * the names that do exist instead.
 */
function readTarget(req, res) {
  const platform = platformFor(req.params.platform);
  if (!platform) {
    res.status(404).json({
      error: 'No league platform by that name. This service reads: '
        + PLATFORM_NAMES.join(', ') + '.',
    });
    return null;
  }

  const id = String(req.params.id || '').trim();
  if (!platform.isValidId(id)) {
    res.status(400).json({ error: platform.idHint });
    return null;
  }

  return { platform, id };
}

function readQuery(q) {
  const format = FORMATS[q.scoring] ? q.scoring : 'ppr';
  // Carried rather than checked here: `parseAdpSource` is the one place that
  // decides what a source string means, and it drops what it does not know.
  // Capped only so a stranger cannot send a megabyte of feed names.
  const adpSource = String(q.adpSource || 'sleeper').slice(0, 120);
  const teams = Math.min(16, Math.max(2, Number(q.teams) || 12));
  // A year is a new cache key and a new set of upstream fetches, so an
  // unbounded one lets a stranger drive traffic at two free feeds on our
  // behalf. Neither feed holds a season outside this window.
  const asked = Number(q.year) || DEFAULT_YEAR;
  const year = asked >= 2015 && asked <= DEFAULT_YEAR + 1 ? Math.trunc(asked) : DEFAULT_YEAR;
  // Which live draft room, if any, is allowed to price this board. Written
  // `<platform>:<leagueId>`, and worth nothing on its own: it is resolved
  // through the registry below, so an unknown platform or a league nobody has
  // posted simply yields no room rather than an error. Asking for a room that
  // does not exist is what the app does every time it starts.
  const room = String(q.room || '').slice(0, 64);
  return {
    format,
    adpSource,
    teams,
    year,
    roomAdp: room ? roomAdpFor(room) : null,
    force: q.force === '1' || q.force === 'true',
  };
}

/**
 * The ADP of the room being followed, when one is being followed.
 *
 * Only a platform can produce this, because only a platform's own users can
 * read it, so the board asks the registry rather than knowing any platform's
 * name. A platform that cannot publish one simply does not offer `roomAdpByKey`
 * and the board is built from the feeds alone, which is every platform but
 * Yahoo today.
 */
function roomAdpFor(room) {
  const [name, leagueId] = String(room).split(':');
  const platform = platformFor(name);
  if (!platform?.roomAdpByKey || !platform.isValidId(String(leagueId || ''))) return null;
  try {
    return platform.roomAdpByKey(leagueId);
  } catch {
    // A room that cannot be read is a board without it, never a failed board.
    return null;
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    year: DEFAULT_YEAR,
    formats: FORMATS,
    adpFeeds: ADP_FEEDS,
    adpRules: ADP_RULES,
    platforms: PLATFORM_NAMES,
    // Who is answering, and since when. A health check that only says "ok"
    // cannot tell a service that just started from one left running since
    // yesterday on code that has since changed, and the second one answers
    // just as cheerfully. `scripts/service.mjs` reads these two to say so.
    // Loopback only by default, so this tells a stranger nothing.
    pid: process.pid,
    startedAt: STARTED_AT,
  });
});

/**
 * The Yahoo bridge userscript, served so a userscript manager can install it.
 *
 * Pasting the file into Tampermonkey's editor works once and then rots: the
 * copy in the browser stops matching the copy in the repository and nothing
 * says so. Installed from this address instead, the manager records where it
 * came from and can fetch it again, which is the only way an edit here reaches
 * a draft room without a human remembering to re-paste it.
 *
 * It is served from the service rather than the client because the service is
 * the half that is running whenever the bridge has anything to post to, and
 * because this is the origin the bridge already names.
 */
app.get('/userscript/yahoo-draft-bridge.user.js', (_req, res) => {
  // The extension is what makes a userscript manager offer to install rather
  // than the browser offering to display, so the type must not turn it into a
  // download or a page.
  res.type('text/javascript; charset=utf-8');
  res.set('cache-control', 'no-store');
  res.sendFile(join(HERE, '..', '..', 'userscript', 'yahoo-draft-bridge.user.js'));
});

/*
 * The panel, and a page that installs it as a bookmarklet.
 *
 * The panel is not part of the bridge userscript. The bridge must be injected
 * at `document-start` to wrap `WebSocket` before Yahoo builds one; the panel
 * needs nothing but a DOM, and tying it to a userscript manager meant it
 * inherited every way one can fail to update. A bookmarklet is one click, from
 * the browser itself, with nothing in between.
 */
/**
 * The panel's source, and the build stamp that says which copy you are running.
 *
 * A bookmarklet carries the whole script in its own address, so the copy on the
 * bookmarks bar is a photograph of this file taken whenever it was dragged. It
 * cannot update itself, and a stale one fails the way the userscript did before
 * it: silently, drawing an older panel while the file on disk says otherwise.
 *
 * So the build is stamped into the copy handed out, and the panel asks what the
 * current one is. Derived from the source rather than a number somebody has to
 * remember to raise, because the version that goes wrong is the one that was
 * forgotten. Hashed before the stamp is applied, so both ends compute the same
 * thing from the same bytes.
 *
 * Read per request rather than at boot, so editing the panel in a dev session
 * is picked up without restarting a service that may be holding a live draft.
 */
const PANEL_MARK = '__PANEL_BUILD__';

function panelSource() {
  return readFileSync(join(HERE, '..', '..', 'userscript', 'draft-panel.js'), 'utf8');
}

function panelBuild(source) {
  return createHash('sha256').update(source).digest('hex').slice(0, 8);
}

/** Which panel this service would hand out, for a running one to compare against. */
app.get('/api/panel/build', (_req, res) => {
  res.set('cache-control', 'no-store');
  res.json({ build: panelBuild(panelSource()) });
});

app.get('/panel.js', (_req, res) => {
  res.type('text/javascript; charset=utf-8');
  res.set('cache-control', 'no-store');
  res.sendFile(join(HERE, '..', '..', 'userscript', 'draft-panel.js'));
});

app.get('/panel', (_req, res) => {
  // The whole panel goes in the bookmarklet rather than a loader that fetches
  // it. A loader would be shorter and would also be a script tag on an https
  // page pointing at plain http, which is the sort of thing a browser is right
  // to be suspicious of.
  const source = panelSource();
  const href = 'javascript:' + encodeURIComponent(
    source.replace(PANEL_MARK, panelBuild(source)),
  );
  res.type('html').set('cache-control', 'no-store').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Draft panel</title><style>
 body { font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; background: #0f1211;
        color: #e8e6e3; margin: 0; padding: 40px; }
 main { max-width: 620px; margin: 0 auto; }
 h1 { font-size: 20px; margin: 0 0 4px; }
 p { color: #b9c2bd; }
 a.bm { display: inline-block; margin: 18px 0; padding: 10px 16px; background: #1a201e;
        border: 1px solid #b78a2e; border-radius: 6px; color: #e9c46a;
        text-decoration: none; font-weight: 600; }
 ol { color: #b9c2bd; } li { margin: 6px 0; }
 code { background: #1a201e; padding: 1px 5px; border-radius: 3px; color: #e8e6e3; }
</style></head><body><main>
<h1>Draft panel</h1>
<p>Shows what the board makes of your pick, over the Yahoo draft room itself.
   It reads this machine only and never touches Yahoo.</p>
<p><b>Drag this to your bookmarks bar:</b></p>
<a class="bm" href="${href}">Draft panel</a>
<ol>
  <li>Drag the button above onto your bookmarks bar. Clicking it here does nothing.</li>
  <li>Open your Yahoo draft room.</li>
  <li>Click the bookmark. The panel appears bottom left.</li>
</ol>
<p>Click it again after a page reload. Close the panel with the <code>x</code> in its corner.
   The numbers appear once the app is following that draft.</p>
</main></body></html>`);
});

/** The merged draft board for one scoring format and league size. */
app.get('/api/board', async (req, res) => {
  const q = readQuery(req.query);
  try {
    const board = await buildBoard(q);
    res.json(board);
  } catch (err) {
    res.status(502).json({
      error: 'Could not reach the ADP feeds and no cached copy exists.',
      detail: String(err.message || err),
    });
  }
});

/**
 * Match a pasted or uploaded ranking list against that board.
 *
 * `overrides` is the user's own name to player mapping, kept in their browser
 * and sent with every request. It is applied before any automatic tier, so a
 * decision the user made once is never second guessed.
 */
app.post('/api/rankings', async (req, res) => {
  const q = readQuery({ ...req.query, ...(req.is('application/json') ? req.body : {}) });
  const text = typeof req.body === 'string' ? req.body : req.body?.csv;
  const overrides = (req.is('application/json') && req.body?.overrides) || {};
  const rankColumn = req.is('application/json') && req.body?.rankColumn != null
    ? Number(req.body.rankColumn)
    : null;

  if (!text || !String(text).trim()) {
    res.status(400).json({ error: 'Send the ranking list as `csv` in the request body.' });
    return;
  }

  try {
    const board = await buildBoard(q);
    const result = parseRankings(text, board.players, overrides, rankColumn);
    res.json({ ...result, poolSize: board.players.length });
  } catch (err) {
    res.status(502).json({
      error: 'Could not build the board to match your rankings against.',
      detail: String(err.message || err),
    });
  }
});

/**
 * Match a file of player notes against that same board.
 *
 * A notes file is a ranking file with the ranking left out: a column of names
 * and a column of what you think about them. So it runs through the same six
 * matching tiers and the same overrides, and the order of the rows is ignored.
 *
 * This exists next to the notes column in a ranking file, not instead of it.
 * A ranking export is somebody else's file and you replace it whenever they
 * publish again; your notes are yours and should outlive that.
 */
app.post('/api/notes', async (req, res) => {
  const q = readQuery({ ...req.query, ...(req.is('application/json') ? req.body : {}) });
  const text = typeof req.body === 'string' ? req.body : req.body?.csv;
  const overrides = (req.is('application/json') && req.body?.overrides) || {};

  if (!text || !String(text).trim()) {
    res.status(400).json({ error: 'Send the notes as `csv` in the request body.' });
    return;
  }

  try {
    const board = await buildBoard(q);
    const result = parseRankings(text, board.players, overrides, null);

    if (!result.columns.note) {
      res.status(400).json({
        error: 'No notes column found. Name one column Notes and put the note in it.',
        headers: result.columns.headers,
      });
      return;
    }

    // Only the rows that actually say something. A name with an empty note is
    // not a note, and carrying it would blank a note the ranking file set.
    const notes = result.entries
      .filter((e) => e.note)
      .map((e) => ({ id: e.id, name: e.name, note: e.note }));

    res.json({
      notes,
      unmatched: result.unmatched,
      ignored: result.ignored,
      columns: result.columns,
      matchRate: result.matchRate,
      truncated: result.truncated,
      poolSize: board.players.length,
    });
  } catch (err) {
    res.status(502).json({
      error: 'Could not build the board to match your notes against.',
      detail: String(err.message || err),
    });
  }
});

/**
 * Read a real league and return draft settings that match it.
 *
 * The platform is a path segment, so `/api/sleeper/league/<id>` is the same URL
 * it has always been and every one of these routes answers for whichever
 * platform gets added next without being touched again.
 */
app.get('/api/:platform/league/:id', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    res.json(await target.platform.importLeague(target.id, req.query.force === '1'));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/** Who is in a league, so you can say which team is yours. */
app.get('/api/:platform/league/:id/users', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    res.json(await target.platform.leagueUsers(target.id, req.query.force === '1'));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * Everything about a real league in one answer: the seats and their team names,
 * the keepers declared so far, and the state of the draft.
 */
app.get('/api/:platform/league/:id/setup', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    res.json(await target.platform.leagueSetup(
      target.id, readQuery(req.query), req.query.force === '1',
    ));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/** Whether a draft has opened, and who sits in which slot. */
app.get('/api/:platform/draft/:id', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    res.json(await target.platform.draftState(target.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * What a draft room in the user's own browser has seen, posted here.
 *
 * The only route in the service that is written to. It exists because Yahoo
 * cannot be read the way Sleeper is: every endpoint its draft room uses
 * authenticates on the browser's session cookie, so the service has no way to
 * ask and must be told instead. A userscript in the user's tab does the telling.
 *
 * The route names no platform. It offers the path to whichever platforms have
 * an `ingest`, and answers 404 for the ones that do not, so a pulled platform
 * like Sleeper is not quietly writable.
 *
 * This is a cross-origin POST, from `football.fantasysports.yahoo.com`. It needs
 * no allowance added for it because `cors()` above already answers every origin
 * — which is worth knowing rather than discovering: the service is loopback-only
 * by default, and that, not CORS, is what keeps it to this machine.
 *
 * No cookie, token or credential is sent here, and none would be accepted. What
 * arrives is a player pool, the seats, and the draft's own frames.
 */
app.post('/api/:platform/room/:id', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  if (!target.platform.ingest) {
    res.status(404).json({ error: 'That platform is read from its own feed, not posted to.' });
    return;
  }
  try {
    res.set('cache-control', 'no-store');
    res.json(await target.platform.ingest(target.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * Whether the room behind a league has been posted yet.
 *
 * The only question about a Yahoo league that a league nobody has posted can
 * answer, and it answers "not yet" rather than refusing. The app asks it while
 * it waits for a draft room to open, which is an ordinary few minutes of a mock
 * rather than a fault, and a refusal on a beat would fill a console with errors
 * about something going exactly as it should.
 *
 * Offered only to platforms that keep a room, exactly as the two routes around
 * it are. A pulled platform has nothing to wait for.
 */
app.get('/api/:platform/room/:id', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  if (!target.platform.roomState) {
    res.status(404).json({ error: 'That platform is read from its own feed, not posted to.' });
    return;
  }
  try {
    res.set('cache-control', 'no-store');
    res.json(await target.platform.roomState(target.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * What the board makes of the room, written by the app and read by the bridge.
 *
 * The two cannot address each other. The app is a page on this machine and the
 * bridge runs inside Yahoo's own draft room, so this is the pigeonhole between
 * them: the app posts what it has worked out, the bridge collects it and shows
 * it where the picks are actually being made.
 *
 * Nothing here forms an opinion. The engine that prices a pick lives in the
 * client, and putting a second copy of it in the service would give two answers
 * to the same question. Offered only to platforms that have somewhere to keep
 * it, exactly as the ingestion route above is.
 */
app.post('/api/:platform/room/:id/advice', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  if (!target.platform.putAdvice) {
    res.status(404).json({ error: 'That platform keeps no room to advise on.' });
    return;
  }
  try {
    res.set('cache-control', 'no-store');
    res.json(await target.platform.putAdvice(target.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.get('/api/:platform/room/:id/advice', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  if (!target.platform.readAdvice) {
    res.status(404).json({ error: 'That platform keeps no room to advise on.' });
    return;
  }
  try {
    res.set('cache-control', 'no-store');
    res.json(await target.platform.readAdvice(target.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * Every pick made in a real draft so far, mapped onto this board.
 * Never cached: a draft in progress is stale the moment it is read.
 */
app.get('/api/:platform/draft/:id/picks', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    res.set('cache-control', 'no-store');
    res.json(await target.platform.draftPicks(target.id, readQuery(req.query)));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * The loopback by default, so this answers your own machine and nothing else.
 *
 * The Vite proxy reaches it over the loopback, so a normal run costs nothing
 * for the closed default. Set HOST to `0.0.0.0` when the service has to answer
 * something that is not on this machine, which is what a container needs.
 */
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`Mock draft data service listening on http://${HOST}:${PORT}`);
  console.log(`Default season ${DEFAULT_YEAR}. ADP league sizes available: 8, 10, 12, 14.`);
  console.log(`A 12 team request maps to the ${nearestSize(12)} team ADP set.`);
});
