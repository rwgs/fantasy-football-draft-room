import type {
  Board, LeagueImport, LeagueMember, LeagueSetup, LivePicks, LiveDraftState, NoteSet,
  Overrides, Platform, RankingSet, RoomAdvice, RoomState,
} from './engine/types';

const BASE = import.meta.env.VITE_API_BASE || '/api';

export interface BoardQuery {
  scoring: string;
  teams: number;
  adpSource: string;
  year: number;
  /**
   * The draft room allowed to price this board, as `<platform>:<leagueId>`.
   *
   * Sent whenever a real draft is being followed, whatever the platform, and
   * not only when the room is among the chosen feeds: the reply reports which
   * feeds it *could* have used, and that is what lets the control offer the
   * choice in the first place. A platform that publishes no such ADP yields
   * none, so this costs nothing where it means nothing.
   */
  room?: string;
  force?: boolean;
}

/**
 * The path a league or draft call goes to.
 *
 * The platform is a path segment rather than a query parameter, which is what
 * kept `/api/sleeper/...` unchanged when the seam went in. A league saved before
 * there was a choice has no platform on it, so the absence reads as Sleeper.
 */
function on(platform: Platform | undefined, path: string): string {
  return BASE + '/' + (platform || 'sleeper') + path;
}

function query(q: BoardQuery): string {
  const p = new URLSearchParams({
    scoring: q.scoring,
    teams: String(q.teams),
    adpSource: q.adpSource,
    year: String(q.year),
  });
  if (q.room) p.set('room', q.room);
  if (q.force) p.set('force', '1');
  return p.toString();
}

async function fail(res: Response): Promise<never> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = body.error || detail;
  } catch { /* The body was not JSON. Keep the status text. */ }
  throw new Error(detail);
}

export async function fetchBoard(q: BoardQuery, signal?: AbortSignal): Promise<Board> {
  const res = await fetch(BASE + '/board?' + query(q), { signal });
  if (!res.ok) return fail(res);
  return res.json();
}

export async function matchRankings(
  q: BoardQuery,
  csv: string,
  label: string,
  overrides: Overrides,
  rankColumn: number | null,
): Promise<RankingSet> {
  const res = await fetch(BASE + '/rankings?' + query(q), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv, overrides, rankColumn }),
  });
  if (!res.ok) return fail(res);
  const body = await res.json();
  return { ...body, label };
}

/**
 * Match a file of notes against the board.
 *
 * Separate from the rankings on purpose. A ranking export belongs to whoever
 * published it and you replace it whenever they publish again; your notes are
 * yours and outlive that.
 */
export async function matchNotes(
  q: BoardQuery,
  csv: string,
  label: string,
  overrides: Overrides,
): Promise<NoteSet> {
  const res = await fetch(BASE + '/notes?' + query(q), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv, overrides }),
  });
  if (!res.ok) return fail(res);
  const body = await res.json();
  return { ...body, label };
}

/** The seats, team names, declared keepers and draft state of a real league. */
export async function fetchLeagueSetup(
  platform: Platform,
  leagueId: string,
  q: BoardQuery,
  force = false,
): Promise<LeagueSetup> {
  const res = await fetch(
    on(platform, '/league/' + encodeURIComponent(leagueId) + '/setup?' + query(q))
      + (force ? '&force=1' : ''),
  );
  if (!res.ok) return fail(res);
  return res.json();
}

/** The managers in a league, so you can say which team is yours. */
export async function fetchLeagueMembers(
  platform: Platform,
  leagueId: string,
): Promise<LeagueMember[]> {
  const res = await fetch(on(platform, '/league/' + encodeURIComponent(leagueId) + '/users'));
  if (!res.ok) return fail(res);
  return res.json();
}

/** Whether a real draft has opened, and who sits in which slot. */
export async function fetchDraftState(
  platform: Platform,
  draftId: string,
): Promise<LiveDraftState> {
  const res = await fetch(on(platform, '/draft/' + encodeURIComponent(draftId)));
  if (!res.ok) return fail(res);
  return res.json();
}

/**
 * Whether the room behind a league has been posted yet.
 *
 * Asked on a beat while a Yahoo mock waits for its draft room tab to open, so
 * unlike every other read here it answers rather than refusing when there is
 * nothing there: a lobby hands out the league number before the room exists.
 */
export async function fetchRoomState(platform: Platform, leagueId: string): Promise<RoomState> {
  const res = await fetch(on(platform, '/room/' + encodeURIComponent(leagueId)),
    { cache: 'no-store' });
  if (!res.ok) return fail(res);
  return res.json();
}

/** Every pick made in a real draft so far, mapped onto this board. */
export async function fetchDraftPicks(
  platform: Platform,
  draftId: string,
  q: BoardQuery,
): Promise<LivePicks> {
  const res = await fetch(
    on(platform, '/draft/' + encodeURIComponent(draftId) + '/picks?' + query(q)),
    { cache: 'no-store' },
  );
  if (!res.ok) return fail(res);
  return res.json();
}

/**
 * Read draft settings out of a real league.
 * `force` skips the service cache, which is what Refresh is for.
 */
export async function fetchLeague(
  platform: Platform,
  id: string,
  force = false,
): Promise<LeagueImport> {
  const res = await fetch(on(platform, '/league/' + encodeURIComponent(id.trim()))
    + (force ? '?force=1' : ''));
  if (!res.ok) return fail(res);
  return res.json();
}

/**
 * Hand the draft room in the other tab what this board currently makes of it.
 *
 * The bridge shows this beside Yahoo's own picks, so a decision can be made
 * without looking away from the room. It is a one-way write with nothing to
 * read back, and a failure is not worth reporting: the panel goes stale for a
 * few seconds and the board on this screen, which is the one that matters, is
 * unaffected either way.
 */
export async function postRoomAdvice(
  platform: Platform,
  leagueId: string,
  advice: RoomAdvice,
): Promise<void> {
  await fetch(on(platform, '/room/' + encodeURIComponent(leagueId) + '/advice'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(advice),
  });
}
