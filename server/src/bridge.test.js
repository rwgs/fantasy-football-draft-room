// Whether the service can tell which copy of the userscript is talking to it.
//
//   npm --prefix server test
//
// No endpoint can show this, because the thing being tested is what the service
// concludes about a browser it cannot see. The case that matters is a bridge
// that answers every question correctly except which one it is: on 2026-09-07
// one served, stored and listed as 1.3.0 ran as 1.0.0 for a whole session,
// mirroring picks perfectly while writing no queue at all. The reading below is
// the only thing that would have caught it.
//
// Nothing here reaches the network or the filesystem beyond reading the
// userscript the repository already holds.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BRIDGE_MARK, bridgeBuild, bridgeSource, bridgeStatus, currentBridge, forgetBridge,
  lastBridge, noteBridge, stampedBridge,
} from './bridge.js';

test('the served copy carries a build where the mark was', () => {
  const current = currentBridge();
  const served = stampedBridge();

  assert.equal(served.includes(BRIDGE_MARK), false,
    'the mark must be spent, or the copy handed out claims no build');
  assert.ok(served.includes(current.build),
    'the copy handed out must carry the build the service would compare against');
  assert.match(current.build, /^[0-9a-f]{8}$/);
  // Its shape, not its value. Pinning the number here would mean every version
  // bump broke a test that has no opinion about which version is current.
  assert.match(current.version, /^\d+\.\d+\.\d+$/);
});

test('both ends hash the same bytes', () => {
  // The stamp is applied after the hash, so a bridge comparing its own build
  // against this endpoint is comparing like with like. Hashing the stamped copy
  // instead would make every install look stale the moment it was installed.
  assert.equal(bridgeBuild(bridgeSource()), currentBridge().build);
  assert.notEqual(bridgeBuild(stampedBridge()), currentBridge().build);
});

test('the mark appears once, so the substitution cannot land wrong', () => {
  const hits = bridgeSource().split(BRIDGE_MARK).length - 1;
  assert.equal(hits, 1);
});

test('a room nothing has posted to claims nothing', () => {
  assert.equal(bridgeStatus(null, false), null);
  assert.equal(bridgeStatus({ version: '1.3.0', build: 'abcd1234' }, false), null);
});

test('a bridge that will not name itself is behind by definition', () => {
  // The 1.0.0 case, and the reason `seen` is a separate argument: silence from
  // something that is posting is itself the answer, and reading it as "nothing
  // known" is what cost the session.
  const status = bridgeStatus(null, true);
  assert.equal(status.tooOld, true);
  assert.equal(status.stale, true);
  assert.equal(status.build, null);
  assert.equal(status.current.build, currentBridge().build);
});

test('a version without a build is still behind', () => {
  const status = bridgeStatus({ version: '1.0.0' }, true);
  assert.equal(status.tooOld, true);
  assert.equal(status.stale, true);
  assert.equal(status.version, '1.0.0', 'the version is kept so the app can name it');
});

test('a copy run from the repository is not stale', () => {
  // The mark comes back unspent, which means this copy is the current source
  // and cannot be behind it. Same escape hatch the panel has.
  const status = bridgeStatus({ version: '1.3.0', build: BRIDGE_MARK }, true);
  assert.equal(status.fromSource, true);
  assert.equal(status.stale, false);
  assert.equal(status.build, null, 'it claims no build rather than a wrong one');
});

test('a current install is not stale, and a stale one is', () => {
  const current = currentBridge();

  const good = bridgeStatus({ version: current.version, build: current.build }, true);
  assert.equal(good.stale, false);
  assert.equal(good.tooOld, false);
  assert.equal(good.build, current.build);

  // The case the version alone would miss: the number says current and the body
  // is not, which is exactly what a manager reported all session.
  const bad = bridgeStatus({ version: current.version, build: 'deadbeef' }, true);
  assert.equal(bad.stale, true);
  assert.equal(bad.version, current.version, 'a matching version does not excuse the build');
});

test('the last bridge heard is remembered without a league', () => {
  // The reading has to exist before any draft is followed, because a stale
  // install costs the draft you are about to start rather than the one you are
  // in. Nothing here names a league, which is the point.
  forgetBridge();
  assert.equal(lastBridge(), null, 'nothing has posted, so nothing is claimed');

  noteBridge(undefined);
  assert.equal(lastBridge().tooOld, true, 'something posted and would not say what');

  const current = currentBridge();
  noteBridge({ version: current.version, build: current.build });
  assert.equal(lastBridge().stale, false);

  // A second bridge replaces the first rather than joining it: the question is
  // about the copy that is installed, and there is only one of those.
  noteBridge({ version: '1.0.0', build: 'deadbeef' });
  assert.equal(lastBridge().stale, true);
  assert.equal(lastBridge().version, '1.0.0');

  forgetBridge();
});

test('the last bridge heard says when, so silence can be told from health', async () => {
  // 2026-09-07, twice. The first time the running copy was old and would not
  // say so. The second it was current and had stopped running, and the reading
  // taken an hour earlier still read as health: the app went on saying picks
  // would mirror while nothing was posting at all, because a reading with no
  // time on it cannot expire. What is installed and whether it is still talking
  // are two questions, and only one of them had an answer here.
  forgetBridge();
  assert.equal(lastBridge(), null, 'nothing has posted, so there is no when');

  const opened = Date.now();
  noteBridge(currentBridge());
  const first = lastBridge().heardAt;
  assert.ok(first >= opened && first <= Date.now(),
    'the time is when the post arrived: ' + first);

  // Every post moves it on, not only the first. A bridge is heard from every
  // few seconds while a room is open, so what the app watches is the gap since
  // the last one rather than the fact that there was ever a post.
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  noteBridge({ version: '1.0.0', build: 'deadbeef' });
  assert.ok(lastBridge().heardAt > first, 'a later post moves the time on');

  forgetBridge();
});
