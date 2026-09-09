import { useState } from 'react';
import { maskLeague, maskTeam } from '../anon';
import type {
  SeasonFeed, SeasonLeagueHeld, SeasonPlayer, SeasonRead, SeasonRoster, SeasonSlot,
} from '../engine/types';

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
  /** The Yahoo league being looked at, or null before one has been chosen. */
  leagueId: string | null;
  /**
   * The leagues the service is holding a reading of.
   *
   * So a league can be chosen rather than typed. The reader posts a snapshot
   * and the app finds out from this, which is what makes the screen reachable
   * without anything borrowed from the draft settings.
   */
  held: SeasonLeagueHeld[];
  /**
   * Whether the service has forgotten a league this app had already read.
   *
   * The app's answer, not the service's: snapshots live in memory alone, so a
   * restart loses them, and the service cannot tell a league never read from
   * one it read and forgot.
   */
  forgotten: boolean;
  loading: boolean;
  error: string | null;
  anonymous: boolean;
  /** Read a league. Given one, it becomes the league this screen is looking at. */
  onRead: (leagueId: string) => void;
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
  if (!slot.accepts) {
    /*
     * `unresolved` is null where the published slot list never arrived, and the
     * banner above says that once. Repeating it against every slot is noise,
     * and against `QB` it reads as this app not knowing what a quarterback slot
     * takes rather than as a feed that did not answer. The clause is for the
     * other case: a slot the list did arrive and could not explain.
     */
    return slot.position + count
      + (slot.unresolved ? ' (this app cannot say what it takes)' : '');
  }
  if (slot.accepts.length === 1) return slot.position + count;
  // A composite is named and then explained, because "W/R/T" is Yahoo's label
  // and "WR, RB or TE" is what it means.
  const list = slot.accepts;
  return slot.position + count + ' ('
    + list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1] + ')';
}

/**
 * The roster in the order a person reads it: the starting lineup in the
 * league's own slot order, then the bench, then IR.
 *
 * YAHOO'S OWN ORDER IS NOT THAT, and the difference was reported from a real
 * league: it returned `QB RB RB WR WR TE W/R/T` and then eight bench players
 * and *then* the started kicker and defence, so the starting lineup was not
 * contiguous and the two slots hardest to guess at were furthest from the top.
 *
 * The order comes from the league's own slot list rather than a table of
 * positions written here, so a league that starts things in a different order
 * reads in that order. `sort` is stable, so two players in one slot keep the
 * order Yahoo gave them, and a slot the list does not mention sorts last rather
 * than throwing the roster away.
 */
function inSlotOrder(players: SeasonPlayer[], slots: SeasonSlot[]): SeasonPlayer[] {
  const rank = new Map(slots.map((slot, at) => [slot.position, at]));
  const at = (p: SeasonPlayer) => rank.get(p.selectedPosition ?? '') ?? slots.length;
  return [...players].sort((a, b) => at(a) - at(b));
}

function Roster({ roster, name, anonymous, index, pooled, slots }: {
  roster: SeasonRoster; name: string; anonymous: boolean; index: number;
  /** Whether the pool answered at all, which decides what a miss may be called. */
  pooled: boolean;
  /** The league's slots, which is what puts the roster in a readable order. */
  slots: SeasonSlot[];
}) {
  const held = roster.players.length;
  const ordered = inSlotOrder(roster.players, slots);
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
          {roster.matched.pool == null
            ? ' · pool not read'
            : ' · ' + roster.matched.pool + '/' + roster.matched.of + ' in the pool'}
          {roster.matched.board == null
            ? ' · board not read'
            : ' · ' + roster.matched.board + '/' + roster.matched.of + ' on the board'}
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
          {ordered.map((p) => (
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
                  // "Not in the pool" is a claim about the player, and it can
                  // only be made when the pool actually answered.
                  : pooled ? 'not in the pool' : ''}
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
  read, leagueId, held, forgotten, loading, error, anonymous, onRead, onBack,
}: Props) {
  const [typed, setTyped] = useState(leagueId ?? '');
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
      {leagueId && (
        <button
          type="button"
          className="chip"
          style={{ marginLeft: 'auto' }}
          disabled={loading}
          onClick={() => onRead(leagueId)}
        >
          {loading ? 'Reading…' : 'Read again'}
        </button>
      )}
    </div>
  );

  /*
   * WHICH LEAGUE, ASKED HERE RATHER THAN BORROWED.
   *
   * Two ways in, because they suit different moments. The leagues the service is
   * already holding are offered as buttons, so after running the bookmarklet
   * there is nothing to type. And the number can be typed, which is what you
   * need the first time, or when the service has been restarted and is holding
   * nothing at all.
   *
   * It is not taken from the app's active league, which is what it did at first
   * and is the defect this replaces: that is a *draft* setting, only set once
   * draft settings import, and importing them needs a posted draft room. In
   * season there is none, so the screen could not reach the case it exists for.
   */
  const picker = (
    <section className="panel">
      <div className="panel-head">
        <h2 className="eyebrow">Which league</h2>
        <span className="hint mono">{held.length ? held.length + ' read' : ''}</span>
      </div>
      <div className="setup-body">
        {!!held.length && (
          <div className="season-held">
            {held.map((one) => (
              <button
                key={one.leagueId}
                type="button"
                className="chip"
                aria-pressed={one.leagueId === leagueId}
                onClick={() => { setTyped(one.leagueId); onRead(one.leagueId); }}
              >
                {maskLeague(one.name || one.leagueId, 0, anonymous)}
                {one.season ? ' · ' + one.season : ''}
                {one.numTeams != null ? ' · ' + one.numTeams + ' teams' : ''}
              </button>
            ))}
          </div>
        )}

        <form
          className="season-pick"
          onSubmit={(e) => {
            e.preventDefault();
            const id = typed.trim();
            if (id) onRead(id);
          }}
        >
          <label className="hint" htmlFor="seasonLeagueId">Yahoo league ID</label>
          <input
            id="seasonLeagueId"
            className="input"
            inputMode="numeric"
            value={typed}
            placeholder="123456"
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" className="chip" disabled={loading || !typed.trim()}>
            {loading ? 'Reading…' : 'Read this league'}
          </button>
        </form>
        <p className="hint">
          The number in your Yahoo league address, after
          {' '}
          <code>/f1/</code>
          . Only Yahoo can be read in season.
        </p>
      </div>
    </section>
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
          {picker}
          {leagueId && (
          <section className="panel">
            <div className="panel-head">
              <h2 className="eyebrow">{forgotten ? 'The reading is gone' : 'Nothing read yet'}</h2>
            </div>
            <div className="setup-body">
              {error && <p className="banner is-bad">{error}</p>}
              {/*
                * "Nothing read yet" about a league read five minutes ago reads
                * as this app having lost it. The service cannot tell the two
                * apart -- a snapshot it has forgotten and one it never had look
                * identical from there -- but the app was holding the reading,
                * so it says which this is.
                */}
              <p className="hint">
                {forgotten
                  ? 'This league was read, and the service is no longer holding it. That is '
                    + 'what a restart does: snapshots are kept in memory only, never on disk, '
                    + 'so nothing of your league is left behind when the service stops. '
                    + 'Running the bookmarklet again is the whole of the fix.'
                  : read?.hint
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
          )}
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
        {picker}

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

        {/*
          * A slot list that never arrived is not a league with odd slots in it.
          * Two banners rather than one, because the first blames Yahoo's feed
          * and the second describes the league, and printing the second for the
          * first would blame the league for the network.
          */}
        {league && !league.joined.vocabulary && (
          <p className="banner is-bad">
            <b>Yahoo&rsquo;s slot list could not be read.</b>
            <span>
              So nothing below says what a shared slot such as a flex accepts. The league,
              its rosters and its scoring are unaffected &mdash; they came from your browser,
              not from that feed.
            </span>
          </p>
        )}

        {!!league?.unresolvedSlots?.length && (
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
            {/*
              * A COUNT IS ONLY PRINTED FOR A JOIN THAT RAN.
              *
              * "0 of 72 matched Yahoo's pool" after a failed fetch is the exact
              * sentence Y8.4 exists to prevent: it reads as a league full of
              * players nobody has heard of. Null comes back from the service for
              * that case and is said as what it is.
              */}
            {league && (
              <p className="hint">
                {league.matched.pool == null
                  ? 'How many rostered players Yahoo’s pool holds is unknown, because that feed did not answer. '
                  : league.matched.pool + ' of ' + league.matched.of
                    + ' rostered players matched Yahoo’s pool. '}
                {league.matched.board == null
                  ? 'The draft board did not answer either, so nothing here is matched against it.'
                  : league.matched.board + ' of ' + league.matched.of
                    + ' matched the draft board. A player who matched neither is still shown, '
                    + 'with the columns he has no source for left blank rather than filled in.'}
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
            {/*
              * ONE CELL PER RULE, AND THE VALUE NOT IN MONO.
              *
              * Both parts were reported as one complaint from a real league:
              * "passing yards says 9.94". It says 0.04, and the reading was
              * correct about the screen being wrong. Two causes compounded.
              * IBM Plex Mono sets a dotted zero, which at 12px bold fills in
              * and reads as a nine — fine for the whole numbers the rest of the
              * app puts in mono, and not for a two-decimal scoring rate. And
              * thirty-five value-and-name pairs wrapped inline were separated
              * by less space than the eye needs to pair them, so which number
              * belonged to which rule was a guess.
              *
              * So each rule is its own cell in a grid, which makes the pairing
              * structural rather than spatial, and the value is set in the body
              * face, whose zero cannot be read as anything else.
              */}
            <div className="season-scoring">
              {scored.map((rule) => (
                <span key={rule.statId} className="season-rule">
                  <b>{rule.points}</b>
                  <span className="hint">{rule.name || rule.abbr || rule.statId}</span>
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
                  pooled={league.joined.pool}
                  slots={league.slots}
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
