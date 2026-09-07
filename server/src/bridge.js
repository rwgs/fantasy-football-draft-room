// Which copy of the Yahoo bridge is actually running in the browser.
//
// The userscript is installed into a manager, and a manager is a place a script
// can go stale in silence. On 2026-09-07 the service served 1.3.0, the manager's
// storage held 1.3.0, the manager's list said 1.3.0, and the body executing in
// the draft room was 1.0.0: no queue write, and every `Q` dropped by a filter
// three versions old. Every account of the script agreed except the only one
// that mattered, and the draft it cost was not the first — `DECISIONS.md`
// records the same failure taking a whole live draft from the panel, which is
// why the panel stopped being a userscript at all.
//
// The bridge cannot take that exit. It has to be injected at `document-start`
// to wrap `WebSocket` before Yahoo builds one, and only a manager can do that.
// So it does the next thing: the copy handed out is stamped with a build, and
// the copy that runs reports that build back. A script describing itself is the
// one account a stale install cannot fake.
//
// The build is a hash of the source rather than a number somebody has to raise,
// for the reason the panel gives: the version that goes wrong is the one that
// was forgotten. The `@version` rides along because it is what the manager
// shows and what a human recognises, and saying both is what makes the mismatch
// legible — "1.0.0, and this build is 1.3.0" reads better than two hashes.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The placeholder the served copy carries in place of its build.
 *
 * It appears exactly once in the userscript, so the substitution cannot land on
 * the wrong line, and the bridge tests for it split so that its own comparison
 * is not itself replaced on the way out.
 */
export const BRIDGE_MARK = '__BRIDGE_BUILD__';

export function bridgeSource() {
  return readFileSync(join(HERE, '..', '..', 'userscript', 'yahoo-draft-bridge.user.js'), 'utf8');
}

/** Hashed before the stamp is applied, so both ends measure the same bytes. */
export function bridgeBuild(source) {
  return createHash('sha256').update(source).digest('hex').slice(0, 8);
}

/** The `@version` line, which is what a manager shows and a human recognises. */
export function bridgeVersion(source) {
  return (source.match(/@version\s+(\S+)/) || [])[1] || null;
}

/** The copy this service would hand out, read fresh so an edit needs no restart. */
export function currentBridge() {
  const source = bridgeSource();
  return { version: bridgeVersion(source), build: bridgeBuild(source) };
}

/** The served copy, with its build stamped in. */
export function stampedBridge() {
  const source = bridgeSource();
  return source.replace(BRIDGE_MARK, bridgeBuild(source));
}

/**
 * What to say about the bridge posting to a room, or null when nothing has.
 *
 * `seen` is whether any post has arrived at all, and it is separate from
 * `reported` on purpose. The two say different things and the difference is the
 * whole point of this file: a room nothing has posted to knows nothing about
 * any bridge, while a room being posted to by something that will not name
 * itself is being posted to by a bridge older than this paragraph. Collapsing
 * those two into "no information" is what let 1.0.0 run for a session.
 *
 * Four answers, and two of them are complaints:
 *
 *   - `null`, when nothing has posted. Nothing is known, so nothing is claimed.
 *   - `tooOld`, when something posted and sent no identity. That copy predates
 *     the stamp, so it is behind by definition and there is no need to compare.
 *   - `fromSource`, when the mark came back unspent. That copy was run straight
 *     from the repository rather than installed, so it *is* the current source
 *     and cannot be behind anything. The same escape hatch the panel has.
 *   - a build, compared against the file on disk.
 *
 * The version rides along in every case it is known, because a version on
 * screen is how the next one of these is caught in seconds rather than in a
 * session.
 */
export function bridgeStatus(reported, seen) {
  if (!seen) return null;
  const current = currentBridge();
  if (!reported || !reported.build) {
    return {
      version: (reported && reported.version) || null,
      build: null,
      tooOld: true,
      fromSource: false,
      stale: true,
      current,
    };
  }
  const fromSource = reported.build === BRIDGE_MARK;
  return {
    version: reported.version || null,
    build: fromSource ? null : reported.build,
    tooOld: false,
    fromSource,
    stale: !fromSource && reported.build !== current.build,
    current,
  };
}
