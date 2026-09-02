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
import { ADP_SOURCES, FORMATS, buildBoard, nearestSize } from './board.js';
import { parseRankings } from './rankings.js';
import { PLATFORM_NAMES, platformFor } from './platforms/index.js';

const app = express();
const PORT = Number(process.env.PORT) || 5178;
const DEFAULT_YEAR = Number(process.env.DRAFT_YEAR) || new Date().getFullYear();

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
  const format = FORMATS[q.scoring] ? q.scoring : 'half-ppr';
  const adpSource = ADP_SOURCES[q.adpSource] ? q.adpSource : 'sleeper';
  const teams = Math.min(16, Math.max(2, Number(q.teams) || 12));
  // A year is a new cache key and a new set of upstream fetches, so an
  // unbounded one lets a stranger drive traffic at two free feeds on our
  // behalf. Neither feed holds a season outside this window.
  const asked = Number(q.year) || DEFAULT_YEAR;
  const year = asked >= 2015 && asked <= DEFAULT_YEAR + 1 ? Math.trunc(asked) : DEFAULT_YEAR;
  return { format, adpSource, teams, year, force: q.force === '1' || q.force === 'true' };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    year: DEFAULT_YEAR,
    formats: FORMATS,
    adpSources: ADP_SOURCES,
    platforms: PLATFORM_NAMES,
  });
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
