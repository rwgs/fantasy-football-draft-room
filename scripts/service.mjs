// Start, stop, restart and inspect the data service.
//
//   npm run serve                 what is running, and what to do about it
//   npm run serve -- start        start it if it is not up
//   npm run serve -- stop         stop whatever is on the port
//   npm run serve -- restart      stop it, start it again
//   npm run serve -- status       report only, change nothing
//
// WHY THIS EXISTS
// The trap is not a busy port, which announces itself. It is a service left
// running from an earlier session: it answers /api/health perfectly well while
// serving code that has since changed, so a check passes against the old build
// and says nothing about the new one. /api/health reports the pid and the
// moment the process came up, and this compares that moment against the newest
// file under server/src. A service older than the code it is meant to be
// running is reported as stale rather than left to be discovered.
//
// It talks to the service rather than to the operating system, so there is no
// netstat or lsof parsing and it behaves the same on Windows, macOS and Linux.

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_SRC = join(ROOT, 'server', 'src');
const PORT = Number(process.env.PORT) || 5178;
const HOST = process.env.HOST || '127.0.0.1';

/** How long to wait for the port to free, or for a new service to answer. */
const SETTLE_MS = 10000;

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Is anything holding the port at all, health or no health. */
function portTaken() {
  return new Promise((resolve) => {
    const socket = createConnection({ port: PORT, host: HOST });
    const done = (taken) => { socket.destroy(); resolve(taken); };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Who holds the port, asked of the operating system rather than of the service.
 *
 * Only needed when the service answers but will not name itself, which is the
 * case below. Everything else here goes through /api/health, so this is the one
 * place that has to know what platform it is on.
 */
async function pidFromPort() {
  const [cmd, args] = process.platform === 'win32'
    ? ['netstat', ['-ano', '-p', 'TCP']]
    : ['lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN']];

  const out = await new Promise((resolve) => {
    let text = '';
    const child = spawn(cmd, args, { windowsHide: true });
    child.stdout.on('data', (d) => { text += d; });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(text));
  });

  if (process.platform !== 'win32') return Number(out.trim().split(/\s+/)[0]) || null;
  for (const line of out.split(/\r?\n/)) {
    if (!/\bLISTENING\b/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    // Local address is the second column: match the port, not an address that
    // merely ends in these digits, and not a remote port on some other row.
    if (!new RegExp(`[:.]${PORT}$`).test(parts[1] ?? '')) continue;
    return Number(parts[parts.length - 1]) || null;
  }
  return null;
}

/**
 * What is on the port.
 *
 * The state worth separating is `foreign`: something can hold the port without
 * being this service, and killing it on the assumption that it is would be the
 * wrong move. Health answering `ok` is what proves ownership; the pid is only
 * how it is reached.
 *
 * A service too old to report its pid is still ours, and is the case this whole
 * script exists for: a process from before the field was added is, by
 * definition, running code that has since changed. So its pid is looked up from
 * the port instead, and it is reported as stale without needing a timestamp it
 * cannot give.
 */
async function probe() {
  if (!(await portTaken())) return { state: 'free' };

  let body;
  try {
    const res = await fetch(`http://${HOST}:${PORT}/api/health`, {
      signal: AbortSignal.timeout(2500),
    });
    body = await res.json();
  } catch {
    return { state: 'foreign' };
  }
  if (!body?.ok) return { state: 'foreign' };

  if (typeof body.pid === 'number') {
    return { state: 'running', pid: body.pid, startedAt: body.startedAt ?? null };
  }
  return { state: 'running', pid: await pidFromPort(), startedAt: null, predatesPid: true };
}

/** The newest thing under server/src, which is what the service is running. */
async function newestSource(dir = SERVER_SRC) {
  let newest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, await newestSource(path));
    else newest = Math.max(newest, (await stat(path)).mtimeMs);
  }
  return newest;
}

function human(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

async function describe(found) {
  if (found.state === 'free') return `Nothing on ${HOST}:${PORT}.`;
  if (found.state === 'foreign') {
    return `Something holds ${HOST}:${PORT} but does not answer /api/health.\n`
      + '  Not this service, so it is not mine to kill. Stop it yourself.';
  }

  const where = `Running on ${HOST}:${PORT}, `
    + (found.pid == null ? 'pid unknown' : `pid ${found.pid}`);

  if (found.predatesPid) {
    return `${where}.\n`
      + '  STALE: too old to report when it started, which it has done since\n'
      + '  `pid` was added to /api/health. So it predates that change and every\n'
      + '  change to server/src since. Restart it.'
      + (found.pid == null
        ? '\n  Its pid could not be read from the port either, so stop it by hand.'
        : '');
  }

  if (found.startedAt == null) {
    return `${where}.\n  It names itself but not when it started, so staleness`
      + ' cannot be judged. Restart it if a check depends on it.';
  }

  const line = `${where}, up ${human(Date.now() - found.startedAt)}.`;
  const newest = await newestSource().catch(() => 0);
  return newest > found.startedAt
    ? line + '\n  STALE: server/src changed '
      + human(Date.now() - newest) + ' ago, after this process started.\n'
      + '  It is serving the old code. Restart before trusting a check against it.'
    : line + '\n  Current: nothing under server/src has changed since it started.';
}

async function start() {
  const found = await probe();
  if (found.state === 'running') {
    console.log(await describe(found));
    console.log('\nAlready up. Nothing to do.');
    return 0;
  }
  if (found.state === 'foreign') {
    console.error(await describe(found));
    return 1;
  }

  const child = spawn(process.execPath, [join('server', 'src', 'index.js')], {
    cwd: ROOT, detached: true, stdio: 'ignore', env: process.env,
  });
  child.unref();

  const until = Date.now() + SETTLE_MS;
  while (Date.now() < until) {
    const now = await probe();
    if (now.state === 'running') {
      console.log(await describe(now));
      return 0;
    }
    await wait(250);
  }
  console.error(`Started nothing that answered within ${SETTLE_MS / 1000}s.`);
  return 1;
}

async function stop() {
  const found = await probe();
  if (found.state === 'free') {
    console.log(`Nothing on ${HOST}:${PORT}. Nothing to stop.`);
    return 0;
  }
  if (found.state === 'foreign') {
    console.error(await describe(found));
    return 1;
  }

  if (found.pid == null) {
    console.error(await describe(found));
    return 1;
  }

  try {
    process.kill(found.pid);
  } catch (err) {
    // Already gone between the probe and here is a success, not a failure.
    if (err.code !== 'ESRCH') {
      console.error(`Could not stop pid ${found.pid}: ${err.message}`);
      return 1;
    }
  }

  const until = Date.now() + SETTLE_MS;
  while (Date.now() < until) {
    if (!(await portTaken())) {
      console.log(`Stopped pid ${found.pid}. ${HOST}:${PORT} is free.`);
      return 0;
    }
    await wait(200);
  }
  console.error(`Asked pid ${found.pid} to stop, but ${HOST}:${PORT} is still held.`);
  return 1;
}

async function restart() {
  const code = await stop();
  return code === 0 ? start() : code;
}

/**
 * No action named: report, then offer the ones that make sense.
 *
 * With nothing running there is only one useful thing to do, so it does it. The
 * prompt only appears where a choice actually exists, and only where somebody
 * is there to answer: piped into a script or run by an agent this reports and
 * exits rather than blocking forever on a question nobody will read.
 */
async function interactive() {
  const found = await probe();
  console.log(await describe(found));

  if (found.state === 'free') {
    console.log('\nStarting it.');
    return start();
  }
  if (found.state === 'foreign') return 1;

  if (!process.stdin.isTTY) {
    console.log('\nNot a terminal, so nothing was changed.'
      + ' Use: npm run serve -- restart | stop');
    return 0;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('\n[r]estart, [s]top, or leave it? ')).trim().toLowerCase();
  rl.close();

  if (answer === 'r' || answer === 'restart') return restart();
  if (answer === 's' || answer === 'stop') return stop();
  console.log('Left running.');
  return 0;
}

const ACTIONS = { start, stop, restart, status: async () => {
  console.log(await describe(await probe()));
  return 0;
} };

const asked = process.argv[2];
if (asked && !ACTIONS[asked]) {
  console.error(`Unknown action "${asked}". One of: start, stop, restart, status.`);
  process.exitCode = 2;
} else {
  // Set the code and let the loop drain rather than calling process.exit. On
  // Windows, exiting while the handle for a just-spawned detached child is
  // still closing trips a libuv assertion and returns 127 from a run that
  // actually succeeded. The child is unreferenced, so nothing here keeps the
  // loop alive once the last request settles.
  process.exitCode = await (asked ? ACTIONS[asked]() : interactive());
}
