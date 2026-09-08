import { maskLeague, maskTeam } from '../anon';
import type { SeasonFeed, SeasonRead, SeasonRoster, SeasonSlot } from '../engine/types';

/**
 * A Yahoo league in season, read only.
 *
 * A fourth screen rather than a third mode, decided rather than assumed: the
 * mode badge says how a *draft* runs, mock against assistant, and this is not a
 * draft. So the draft flow is untouched and this sits beside it.
 *
 * NOTHING HERE RECOMMENDS ANYTHING. No projections, no lineup advice, no waiver
 * suggestions. What it shows is what was read and how old it is, which is the
 * thing that has to be trustworthy before any advice built on it is worth
 * reading. Phase 9 owns the advice.
 *
 * The one design rule worth stating: every absence says which absence it is. A
 * player the pool never matched shows "not in the pool" and not a blank
 * ownership column, a feed that failed says so rather than showing an age, and
 * a league nobody has read is offered the bookmarklet instead of rendering as
 * an empty league.
 */

interface Props {
  read: SeasonRead | null;
  loading: boolean;
  error: string | null;
  anonymous: boolean;
  onRefresh: () => void;
  onBack: () => void;
}

/** The rest of the stale-reader sentence, said either side of the link. */
const REDRAG = ', replace the one on your bookmarks bar, and read the league once more.';

/** How long ago, in the units the rest of the app uses for a feed. */
function since(at: number | null): string {
  if (at == null) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return secs + 's ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

function FeedRow({ label, feed, note }: { label: string; feed: SeasonFeed; note?: string }) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      {/*
        * A feed that failed reports the failure instead of an age. Showing an
        * age beside an error would be reporting when the last good copy came,
        * which reads as freshness.
        */}
      <b className="mono" style={feed.error || feed.stale ? { color: 'var(--te)' } : undefined}>
        {feed.error ? 'failed' : since(feed.fetchedAt)}
      </b>
      <span className="hint">{feed.error || (feed.stale ? 'stale' : note || '')}</span>
    </div>
  );
}

/** A slot, said the way a person would say it. */
function slotLine(slot: SeasonSlot): string {
  const count = slot.count > 1 ? ' ×' + slot.count : '';
  if (!slot.starting) return slot.position + count;
  if (!slot.accepts) return slot.position + count + ' (this app cannot say what it takes)';
  if (slot.accepts.length === 1) return slot.position + count;
  // A composite is named and then explained, because "W/R/T" is Yahoo's label
  // and "WR, RB or TE" is what it means.
  const list = slot.accepts;
  return slot.position + count + ' ('
    + list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1] + ')';
}

function Roster({ roster, name, anonymous, index }: {
  roster: SeasonRoster; name: string; anonymous: boolean; index: number;
}) {
  const held = roster.players.length;
  return (
    <div className="season-roster">
      <div className="season-roster-head">
        <b>{maskTeam(name, index, roster.own, anonymous)}</b>
        {roster.own && <span className="chip" aria-pressed="true">yours</span>}
        <span className="hint">
          {held + ' players'}
          {roster.week != null ? ' · week ' + roster.week : ''}
          {/*
            * The join counts, said per roster. A total for the league would
            * hide one team having matched nothing, which is exactly the shape
            * a broken join takes.
            */}
          {' · ' + roster.matched.pool + '/' + roster.matched.of + ' in the pool'}
          {' · ' + roster.matched.board + '/' + roster.matched.of + ' on the board'}
        </span>
      </div>

      <table className="season-table">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Player</th>
            <th>Elig.</th>
            <th>Team</th>
            <th className="num">Bye</th>
            <th className="num">Owned</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {roster.players.map((p) => (
            <tr key={p.playerKey} data-bench={p.selectedPosition === 'BN' || p.selectedPosition === 'IR'}>
              <td className="mono">{p.selectedPosition ?? '—'}</td>
              <td>{p.name ?? p.playerKey}</td>
              {/*
                * Every eligible position, not the primary one. A player Yahoo
                * lists at two is the reason the whole list is carried, and
                * showing one of them would hide the fact.
                */}
              <td className="mono">{p.positions.join(', ') || '—'}</td>
              <td className="mono">{p.team ?? '—'}</td>
              <td className="mono num">{p.pool?.byeWeek ?? p.byeWeek ?? '—'}</td>
              <td className="mono num">
                {p.pool ? (p.pool.percentOwned == null ? '—' : p.pool.percentOwned + '%') : ''}
              </td>
              <td className="hint">
                {p.pool
                  // Yahoo's own code, spelt out where it spelt it out. Never
                  // read as an injury: `NA` is 44% of the pool and means
                  // unrostered rather than hurt.
                  ? (p.pool.statusFull || p.pool.status || 'nothing reported')
                  : 'not in the pool'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!roster.players.length && <p className="hint">This roster came back empty.</p>}
    </div>
  );
}

export default function SeasonScreen({
  read, loading, error, anonymous, onRefresh, onBack,
}: Props) {
  const snapshot = read?.snapshot ?? null;
  const league = read?.league ?? null;
  const feeds = read?.feeds ?? null;

  const header = (
    <div className="season-head">
      <button type="button" className="chip" onClick={onBack}>Back to setup</button>
      <b>{snapshot ? maskLeague(snapshot.name || 'Your league', 0, anonymous) : 'Your league'}</b>
      {snapshot && (
        <span className="hint">
          {snapshot.season}
          {snapshot.week.current != null ? ' · week ' + snapshot.week.current : ''}
          {snapshot.numTeams != null ? ' · ' + snapshot.numTeams + ' teams' : ''}
          {snapshot.scoringType ? ' · ' + snapshot.scoringType : ''}
        </span>
      )}
      <button
        type="button"
        className="chip"
        style={{ marginLeft: 'auto' }}
        disabled={loading}
        onClick={onRefresh}
      >
        {loading ? 'Reading…' : 'Read again'}
      </button>
    </div>
  );

  /*
   * NOT READ YET IS NOT AN EMPTY LEAGUE, and the difference is the whole point
   * of this branch. Nothing is on a clock in season: the app cannot fetch a
   * league itself, because Yahoo answers a session cookie the service must
   * never hold, so until the bookmarklet is clicked there is genuinely nothing
   * and saying so is the honest answer rather than a fault to report.
   */
  if (!read?.read) {
    return (
      <div className="results">
        <div className="results-inner">
          {header}
          <section className="panel">
            <div className="panel-head"><h2 className="eyebrow">Nothing read yet</h2></div>
            <div className="setup-body">
              {error && <p className="banner is-bad">{error}</p>}
              <p className="hint">
                {read?.hint
                  || 'This league has not been read yet. Yahoo answers your browser’s own '
                  + 'session, which this app never holds, so a league is read by a bookmarklet '
                  + 'you run on the league page.'}
              </p>
              {read?.readerUrl && (
                <p className="hint">
                  <a href={read.readerUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
                    Install the league reader
                  </a>
                  {', drag it to your bookmarks bar, open your Yahoo league page and click it. '}
                  {'Then come back here and press Read again.'}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const teamNames = new Map(
    (snapshot?.teams ?? []).map((team) => [team.teamKey, team.name || team.teamId]),
  );
  const starting = league?.slots.filter((s) => s.starting) ?? [];
  const bench = league?.slots.filter((s) => !s.starting) ?? [];
  const scored = snapshot?.scoring.filter((s) => s.points != null) ?? [];

  return (
    <div className="results">
      <div className="results-inner">
        {header}

        {/*
          * A reader that cannot send every roster, said before anything else.
          * One roster in an eight team league is otherwise indistinguishable
          * from Yahoo having failed, and the fix is re-dragging a bookmark.
          *
          * A bold lead-in and then the rest, which is the shape the bridge
          * banners already use. `.banner` is a flex row, so every child of it
          * is an item with a gap between it and the next: the sentence has to
          * be one child or the link comes out spaced away from the comma that
          * follows it.
          */}
        {snapshot?.readerBehind && (
          <p className="banner is-bad">
            <b>The bookmarklet that read this league is an old copy.</b>
            <span>
              {'It sent only one roster. A bookmarklet cannot update itself, so '}
              {read.readerUrl ? (
                <a href={read.readerUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
                  install it again
                </a>
              ) : 'install it again from the service'}
              {REDRAG}
            </span>
          </p>
        )}

        {!!league?.unresolvedSlots.length && (
          <p className="banner is-bad">
            {'This league has ' + (league.unresolvedSlots.length === 1 ? 'a slot' : 'slots')
              + ' this app cannot read: ' + league.unresolvedSlots.join(', ')
              + '. Nothing below claims to know what '
              + (league.unresolvedSlots.length === 1 ? 'it takes' : 'they take') + '.'}
          </p>
        )}

        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">How old this is</h2>
            <span className="hint mono">
              {league ? league.matched.rosters + ' rosters' : ''}
            </span>
          </div>
          <div className="setup-body">
            {/*
              * Four ages rather than one. They are fetched apart, so a single
              * age would be whichever refreshed last; and the league is not a
              * feed at all, so it is dated by when your browser read it.
              */}
            <div className="stat-row">
              {feeds && <FeedRow label="League" feed={feeds.league} note="read in your browser" />}
              {feeds && <FeedRow label="Player pool" feed={feeds.pool} />}
              {feeds && <FeedRow label="Slot list" feed={feeds.vocabulary} />}
              {feeds && <FeedRow label="Draft board" feed={feeds.board} />}
            </div>
            {league && (
              <p className="hint">
                {league.matched.pool + ' of ' + league.matched.of
                  + ' rostered players matched Yahoo’s pool, and '
                  + league.matched.board + ' matched the draft board. '}
                A player who matched neither is still shown, with the columns he has no
                source for left blank rather than filled in.
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">Roster slots</h2>
            <span className="hint mono">
              {starting.reduce((n, s) => n + s.count, 0) + ' starting'}
            </span>
          </div>
          <div className="setup-body">
            <p>{starting.map(slotLine).join('   ·   ') || 'None read.'}</p>
            {!!bench.length && (
              <p className="hint">
                {'Not started: ' + bench.map(slotLine).join(', ') + '.'}
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">Scoring</h2>
            <span className="hint mono">
              {snapshot ? snapshot.scoring.length + ' rules' : ''}
            </span>
          </div>
          <div className="setup-body">
            <div className="season-scoring">
              {scored.map((rule) => (
                <span key={rule.statId} className="hint">
                  <b className="mono">{rule.points}</b>
                  {' '}
                  {rule.name || rule.abbr || rule.statId}
                </span>
              ))}
            </div>
            {/*
              * A category counted at zero is not the same as one the league does
              * not count, so the ones with no value are numbered rather than
              * dropped. It is also most of the list: 38 categories, 35 values.
              */}
            {snapshot && snapshot.scoring.length > scored.length && (
              <p className="hint">
                {(() => {
                  const rest = snapshot.scoring.length - scored.length;
                  return rest === 1
                    ? 'One more category is counted with no value set against it.'
                    : rest + ' more categories are counted with no value set against them.';
                })()}
              </p>
            )}
            {snapshot?.waivers && (
              <p className="hint">
                {'Waivers: ' + (snapshot.waivers.type || 'not read')
                  + (snapshot.waivers.usesFaab ? ', with a FAAB budget' : ', by priority')
                  + (snapshot.trades.endDate ? '. Trades end ' + snapshot.trades.endDate : '')
                  + '.'}
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">Rosters</h2>
            <span className="hint mono">
              {league ? league.matched.of + ' players' : ''}
            </span>
          </div>
          <div className="setup-body">
            {league?.rosters.length
              ? league.rosters.map((roster, at) => (
                <Roster
                  key={roster.teamKey ?? String(at)}
                  roster={roster}
                  // The team's own name, from the league's team list. A roster
                  // carries the key it was read under and not the name, and
                  // showing `470.l.111.t.3` would be showing the plumbing.
                  name={teamNames.get(roster.teamKey ?? '') || 'Team ' + (at + 1)}
                  anonymous={anonymous}
                  index={at}
                />
              ))
              : (
                <p className="hint">
                  No rosters came back. The league and its rules read, so this is Yahoo
                  having refused the rosters rather than the league being empty.
                </p>
              )}
          </div>
        </section>
      </div>
    </div>
  );
}
