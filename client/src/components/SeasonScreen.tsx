import { useState } from 'react';
import { maskLeague, maskTeam } from '../anon';
import type {
  DeskKey, LineupDesk, LineupRead, LineupTeam,
  SeasonFeed, SeasonLeagueHeld, SeasonPoolRecord, SeasonRead, SeasonRoster, SeasonSlot,
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
  /**
   * This week's advice for the user's own team, or null before it lands.
   *
   * Held apart from `read` because it is a second request waiting on two
   * projection desks: the league renders first and this arrives under it, and a
   * desk that failed leaves the league on screen rather than the screen empty.
   */
  lineup: LineupRead | null;
  lineupLoading: boolean;
  lineupError: string | null;
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
function inSlotOrder<T extends { selectedPosition: string | null }>(
  players: T[], slots: SeasonSlot[],
): T[] {
  const rank = new Map(slots.map((slot, at) => [slot.position, at]));
  const at = (p: T) => rank.get(p.selectedPosition ?? '') ?? slots.length;
  return [...players].sort((a, b) => at(a) - at(b));
}

function Roster({ roster, name, anonymous, index, pooled, slots, desks, team, opponent }: {
  roster: SeasonRoster; name: string; anonymous: boolean; index: number;
  /** Whether the pool answered at all, which decides what a miss may be called. */
  pooled: boolean;
  /** The league's slots, which is what puts the roster in a readable order. */
  slots: SeasonSlot[];
  /**
   * Which projection columns this table carries, in the order they are shown.
   *
   * Passed in rather than worked out here, because every roster on the page has
   * to carry the same columns: these tables are read down as much as across,
   * and a team whose desk failed cannot be one column narrower than the rest.
   */
  desks: DeskColumn[];
  /** This team's projections, or null before the lineup request has answered. */
  team: LineupTeam | null;
  /** Whether this is the team the user plays this week. */
  opponent: boolean;
}) {
  const held = roster.players.length;
  const ordered = inSlotOrder(roster.players, slots);
  return (
    <div className="season-roster">
      <div className="season-roster-head">
        <b>{maskTeam(name, index, roster.own, anonymous)}</b>
        {roster.own && <span className="chip" aria-pressed="true">yours</span>}
        {/*
          * WHY THE ORDERING IS LABELLED AND NOT LEFT TO BE INFERRED. This team
          * is first among the rivals because it is the one being played, and a
          * list reordered with nothing saying why is a list the reader has to
          * take on trust -- indistinguishable from the league's own order
          * happening to start there. Not `aria-pressed`, which is the mark for
          * the user's own team and the thing `shots` counts.
          */}
        {opponent && <span className="chip">this week&rsquo;s opponent</span>}
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
        {/*
          * EVERY TEAM IS ITS OWN TABLE, SO THE WIDTHS HAVE TO BE STATED. A
          * table left to size itself measures its own contents and nothing
          * else, so a roster holding "Amon-Ra St. Brown" set a wider player
          * column than the one below it holding "Bo Nix", and stacked down
          * the page, a dozen rosters put their headings in a dozen places. It
          * read as a rendering fault, which is roughly what it was.
          *
          * Declared here beside the columns they size rather than in the
          * stylesheet, because the two have to be changed together: a column
          * added to the row below and not to this list silently takes its
          * width from whatever is left over.
          */}
        <colgroup>
          <col style={{ width: '7%' }} />
          <col style={{ width: '23%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '5%' }} />
          <col style={{ width: '8%' }} />
          {/*
            * Status takes whatever the projection columns leave, which is why
            * it alone is unsized. The table is `table-layout: fixed`, so one
            * unsized column is the remainder exactly rather than a measurement
            * of its own contents -- and the count of desk columns is the same
            * for every roster on the page, so they all still line up.
            */}
          <col />
          {desks.map((desk) => <col key={desk.key} style={{ width: '9%' }} />)}
        </colgroup>
        <thead>
          <tr>
            <th>Slot</th>
            <th>Player</th>
            <th>Elig.</th>
            <th>Team</th>
            <th className="num">Bye</th>
            <th className="num">Owned</th>
            <th>Status</th>
            {desks.map((desk) => (
              <th key={desk.key} className="num">{deskName(desk.key)}</th>
            ))}
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
              {desks.map((desk) => (
                <td key={desk.key} className="mono num">
                  {deskCell(team, p.playerKey, desk)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {/*
          * THE TOTALS, AND WHY THEY ARE A `tfoot` AND NOT TWO MORE ROWS. The
          * body of this table is the roster, one row per player, and `shots`
          * reads its first column to prove the starting lineup is contiguous.
          * A total sitting in `tbody` would be a row whose slot is not a slot,
          * in the check that exists to catch exactly that.
          */}
        {!!desks.length && !!team && (
          <tfoot>
            <tr>
              {/*
                * "Starters" and not "Total", because the number is the lineup
                * as it stands with the bench left out -- and with the seats no
                * desk projects left out too, which is the kicker and the
                * defence. The column above it shows those as no projection at
                * all rather than as nothing scored, so the two agree.
                */}
              <td colSpan={7}>Starters</td>
              {desks.map((desk) => (
                <td key={desk.key} className="mono num">{pts(totalNow(team, desk))}</td>
              ))}
            </tr>
            <tr>
              <td colSpan={7} className="hint">Best possible</td>
              {desks.map((desk) => (
                <td key={desk.key} className="mono num hint">
                  {/*
                    * A dash against Yahoo where only its published team total
                    * is in hand: a best lineup is a re-seating and a re-seating
                    * needs a number against each player. Where the roster page
                    * was scraped there is one, and this is a real best.
                    */}
                  {pts(totalBest(team, desk))}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>

      {!roster.players.length && <p className="hint">This roster came back empty.</p>}
    </div>
  );
}

/** A number of points, at the precision a projection deserves and no more. */
const pts = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1));

/**
 * How the desks are labelled, so a column heading is a desk and not a field.
 *
 * Yahoo is here and is not a projection desk in the sense the other two are.
 * It publishes a total for a team and no number against a player -- see
 * `LineupTeam` -- so it heads a column that is blank all the way down and
 * carries a total underneath. That is worth a column rather than a footnote:
 * it is the figure on Yahoo's own matchup card, and it is the one number the
 * user can check this screen against without leaving it.
 */
const DESK_NAMES: Record<string, string> = { sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo' };
const deskName = (key: string) => DESK_NAMES[key] || key;

/**
 * A projection column: which desk, and whether that desk actually answered.
 *
 * The two are not the same question and the difference is a whole class of
 * wrong cell. Yahoo can be a column on a roster where no per-player number was
 * ever scraped -- an older reader, or a page that would not come -- and it
 * still carries a total from the scoreboard. So the column exists and the desk
 * did not answer, and a cell in it means "nothing was read" rather than
 * "nobody projected him".
 */
interface DeskColumn { key: DeskKey; answered: boolean }

/**
 * One desk's number for one player, or the reason there is not one.
 *
 * Three outcomes, not two. A number; `none` where the desk answered and had
 * nothing for this player, which is a claim about the player; and blank where
 * the desk never answered at all, which is a claim about the desk. Collapsing
 * the last two would print fifteen dashes down a Yahoo column that simply was
 * not read, and every one of them would read as a finding.
 */
function deskCell(team: LineupTeam | null, playerKey: string, desk: DeskColumn) {
  if (!team || !desk.answered) return '';
  const value = team.points[playerKey]?.[desk.key] ?? null;
  // Not zero. Nobody projected him, which is a different statement from a
  // projection of nothing -- the same rule the week's own table follows.
  return value == null ? <span className="hint">none</span> : pts(value);
}

/**
 * What a team's lineup scores now under one column, and at best.
 *
 * Yahoo has two numbers that are not the same number -- see `LineupTeam` --
 * and this is where the choice between them is made. Where the roster page was
 * scraped, Yahoo is an ordinary desk with an ordinary best. Where it was not,
 * the scoreboard's published team total is all there is: a real total, and no
 * best, because there is nothing per player to re-seat.
 */
const totalNow = (team: LineupTeam, desk: DeskColumn) => (
  desk.key === 'yahoo' && !team.totals.yahoo
    ? team.totals.yahooPublished
    : team.totals[desk.key]?.now ?? null);

const totalBest = (team: LineupTeam, desk: DeskColumn) => (
  team.totals[desk.key]?.best ?? null);

/**
 * One desk's answer: what the lineup scores now, what the best one scores, and
 * the moves between them.
 *
 * THE TWO DESKS ARE NEVER AVERAGED, and Y9.0 is the reason rather than taste:
 * a mean showed a player at 13.0 where the desks said 15.29 and 10.75, which is
 * a start reported as a sit. So each gets its own column, and a seat they fill
 * differently is reported below as disputed.
 */
function DeskAdvice({ desk, name }: { desk: LineupDesk; name: string }) {
  const sat = desk.benched.filter((s) => s.reason !== 'not projected');
  /*
   * Its own classes rather than the roster's, though the shape is alike. A desk
   * is not a roster, and sharing the class would have conflated them for
   * anything selecting on it -- `shots` counts `.season-roster-head .chip` to
   * prove exactly one roster is marked as yours, and reads the first
   * `.season-roster` to prove the starting lineup is contiguous. Both would
   * have started reading this block instead.
   */
  return (
    <div className="season-desk">
      <div className="season-desk-head">
        <b>{name}</b>
        <span className="hint">
          {pts(desk.currentPoints) + ' now · ' + pts(desk.points) + ' best'}
        </span>
        {/*
          * A GAIN OF NULL IS NOT A GAIN OF ZERO. It means a player in the
          * lineup has no projection from this desk, so the difference is
          * missing a term of unknown size. Printing 0.0 there would be a
          * confident claim that the lineup is already right.
          */}
        {desk.gain == null ? (
          <span className="chip">gain unknown</span>
        ) : desk.gain > 0 ? (
          <span className="chip" aria-pressed="true">{'+' + pts(desk.gain)}</span>
        ) : (
          <span className="chip">no change</span>
        )}
      </div>

      {desk.moves.length ? (
        <table className="season-table">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Bench</th>
              <th>Start</th>
            </tr>
          </thead>
          <tbody>
            {desk.moves.map((move) => (
              <tr key={move.slot + move.in.playerKey}>
                <td className="mono">{move.slot}</td>
                <td>{move.out ? move.out.name : <span className="hint">nobody</span>}</td>
                <td><b>{move.in.name}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !desk.moved.length && (
        <p className="hint">
          {desk.gain == null
            ? 'No move can be recommended, because a player in this lineup has no projection.'
            : 'This desk would leave the lineup exactly as it is.'}
        </p>
      )}

      {/*
        * A PLAYER MOVED RATHER THAN SWAPPED, and its own block rather than a
        * row of the table above. He starts either way, so nobody is coming out
        * of the lineup for him and both of that table's columns would be wrong
        * about him -- which is exactly what they were, twice, until the swaps
        * were computed over the whole lineup instead of slot by slot.
        *
        * Not a `.season-table`, deliberately: `shots` reads the rows of that
        * table to prove nobody is benched and started at once, and a relocation
        * showing up there would be the thing it is checking for.
        */}
      {!!desk.moved.length && (
        <p className="hint">
          {'Move '}
          {desk.moved.map((move, at) => (
            <span key={move.playerKey}>
              {at > 0 && ', '}
              <b>{move.name}</b>
              {' from '}
              <span className="mono">{move.from}</span>
              {' to '}
              <span className="mono">{move.to}</span>
            </span>
          ))}
          {'. Still starting either way — a slot change, not a swap.'}
        </p>
      )}

      {/*
        * A starter this desk cannot score, named. It is the reason the gain
        * above is unknown, so the two belong beside each other.
        */}
      {!!desk.unscoredStarters.length && (
        <p className="hint">
          {'No projection for ' + desk.unscoredStarters.map((s) => s.player).join(', ')
            + ', so nothing is claimed about '
            + (desk.unscoredStarters.length === 1 ? 'that seat' : 'those seats') + '.'}
        </p>
      )}

      {!!sat.length && (
        <p className="hint">
          {sat.map((s) => s.player + ' is ' + s.reason).join('; ') + '.'}
        </p>
      )}

      {!!desk.empty.length && (
        <p className="hint">
          {'Nothing on this roster can legally fill: ' + desk.empty.join(', ') + '.'}
        </p>
      )}
    </div>
  );
}

/**
 * This week's advice, and every limit on it beside the thing it limits.
 *
 * The one screen in this project that recommends anything, which is why the
 * limits are not in a footnote: a kicker slot no desk projects, a league rule
 * no desk publishes, a player nobody projected, and the fact that nothing is
 * known about which players have locked all change what the advice is worth.
 * Each is said where it applies.
 */
function Advice({ lineup, loading, error, team, slots, pool, pooled }: {
  lineup: LineupRead | null; loading: boolean; error: string | null;
  /**
   * Whose team this is, masked like any other, or null where the league read
   * has not identified one.
   *
   * NAMED HERE BECAUSE IT IS NAMED NOWHERE ELSE. The rosters below are the rest
   * of the league and this is the only place the user's own team appears, so
   * without this the screen advises at length on a team it never names. It is
   * also the standing evidence that the guid match worked: a wrong name here is
   * advice about somebody else's roster.
   */
  team: string | null;
  /** The league's slots, which is what puts the roster in a readable order. */
  slots: SeasonSlot[];
  /**
   * What Yahoo's pool says about each rostered player, by key.
   *
   * The lineup and the league are two fetches and this table wants both: the
   * projections come from the desks and the injury and the ownership come from
   * the pool, which only the league read asks for. Joining them here rather
   * than fetching the pool twice keeps one answer per feed, and the keys are
   * the same keys -- both sides came out of the one snapshot the browser read.
   */
  pool: Map<string, SeasonPoolRecord | null>;
  /** Whether the pool answered at all, which decides what a miss may be called. */
  pooled: boolean;
}) {
  if (error) {
    return (
      <section className="panel">
        <div className="panel-head"><h2 className="eyebrow">This week</h2></div>
        <div className="setup-body"><p className="banner is-bad">{error}</p></div>
      </section>
    );
  }
  // Nothing read yet is the picker's business, not an absence to report twice.
  if (!lineup && !loading) return null;
  if (lineup && !lineup.read) return null;

  const advice = lineup?.advice ?? null;
  const desks = advice ? advice.answered : [];
  const first = desks.length ? advice!.desks[desks[0]] : null;
  const unsupported = desks.length
    ? lineup?.unsupported?.[desks[0] as DeskKey] ?? []
    : [];
  const missed = desks
    .map((key) => ({ key, names: lineup?.unprojected?.[key as DeskKey] ?? [] }))
    .filter((entry) => entry.names && entry.names.length);

  const ownTeam = lineup?.teams?.find((t) => t.teamKey === lineup.teamKey) ?? null;

  /*
   * YAHOO ARRIVES BY TWO ROUTES AND THEY ARE NOT INTERCHANGEABLE.
   *
   * As a desk, when the reader scraped each roster page: a number against every
   * player, so it seats a lineup, has a best, and belongs in the disputed table
   * with the other two. As a published total, always, off the league scoreboard
   * -- one figure for the team and nothing per player.
   *
   * Both can be in hand at once, and then they are a check on each other: the
   * scrape has no contract, and the published figure is the only thing that can
   * catch it drifting. Where only the published one is there -- a reader older
   * than 2026-09-09, or roster pages that would not come -- Yahoo is still a
   * column, carrying its total under a run of blanks.
   */
  const yahooIsDesk = desks.includes('yahoo');
  const published = ownTeam?.totals.yahooPublished ?? null;

  /*
   * The columns the roster table below carries. Not the same list as the desks
   * that answered, because Yahoo can be a column without being a desk -- see
   * above. `answered` is carried per column rather than inferred, so a cell
   * can say "not read" where the desk is absent and "none" where it answered
   * and had nothing, which are different claims.
   */
  const tableDesks: DeskColumn[] = [
    ...desks.map((key) => ({ key: key as DeskKey, answered: true })),
    ...(!yahooIsDesk && published != null
      ? [{ key: 'yahoo' as DeskKey, answered: false }]
      : []),
  ];

  /*
   * The starting lineup as one block, then the bench, on the league's own slot
   * list and the same `inSlotOrder` the rosters below use.
   *
   * IT USED TO RANK BY THE SEATS, AND THE SEATS ARE NOT THE SLOTS. `seats` is
   * what `startingSeats` could seat somebody in, so it deliberately drops the
   * two slots no desk can project -- the kicker and the defence -- along with
   * any slot this app could not resolve. A slot missing from the ranking sorts
   * last, which put a started kicker and a started defence below the bench, in
   * the one table on this screen that is meant to read as a lineup. They are
   * exactly the players there is least to say about and exactly the ones the
   * old order buried furthest down.
   *
   * The league's slot list has all of them, unscoreable and unresolved alike,
   * in the order the league itself starts them, so ranking on that puts every
   * starter above every bench player whatever any desk can score.
   */
  const roster = inSlotOrder(lineup?.roster ?? [], slots);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="eyebrow">This week</h2>
        {team && <b>{team}</b>}
        {team && <span className="chip" aria-pressed="true">yours</span>}
        <span className="hint mono">
          {loading ? 'working it out…' : lineup?.week != null ? 'week ' + lineup.week : ''}
        </span>
      </div>
      <div className="setup-body">
        {/*
          * A league whose own team could not be identified, or a week the
          * snapshot does not name. Stated rather than rendered as an empty
          * lineup, because advice about a team this app cannot identify is
          * advice about somebody else's team.
          */}
        {lineup?.error && <p className="banner is-bad">{lineup.error}</p>}

        {loading && !advice && (
          <p className="hint">
            Fetching both projection desks and scoring them under your league&rsquo;s own rules.
          </p>
        )}

        {advice && !desks.length && (
          <p className="banner is-bad">
            Neither projection desk answered, so there is no advice at all. The league above is
            unaffected &mdash; it came from your browser, not from those feeds.
          </p>
        )}

        {/*
          * LOCKS ARE UNKNOWN AND THAT IS THE ORDINARY CASE, not an edge one:
          * Yahoo publishes no kickoff time at any scope. Said plainly, because
          * advice offered as though nothing had locked is advice to make moves
          * Yahoo may refuse.
          */}
        {advice && !advice.locksKnown && !!desks.length && (
          <p className="hint">
            Whether a player has already locked is not known &mdash; Yahoo publishes no kickoff
            time. Check each move is still allowed before setting it.
          </p>
        )}

        {/*
          * The two desks' ages, here rather than in the panel of ages above,
          * because they are the advice's freshness and not the league's. And
          * Sleeper's oldest record beside its fetch age, because Y9.0 found a
          * future week comes back as a stale vintage inside a fresh fetch --
          * its own points contradicting its own components by about two points
          * at quarterback. A fetch age cannot show that.
          */}
        {lineup?.feeds && !!desks.length && (
          <div className="stat-row">
            <FeedRow label="Sleeper" feed={lineup.feeds.sleeper} />
            <FeedRow label="ESPN" feed={lineup.feeds.espn} />
            {lineup.vintage?.sleeper != null && (
              <div>
                <span className="eyebrow">Oldest record</span>
                <b className="mono">{since(lineup.vintage.sleeper)}</b>
                <span className="hint">{lineup.vintage.desk || 'Sleeper'}</span>
              </div>
            )}
          </div>
        )}

        {(!!desks.length || published != null) && (
          <div className="season-advice">
            {desks.map((key) => (
              <DeskAdvice key={key} desk={advice!.desks[key]} name={deskName(key)} />
            ))}
            {/*
              * Yahoo where it is only a published total: a block rather than a
              * desk, because it recommends nothing and cannot. Said out loud
              * rather than left as a missing "best", since a total with no best
              * beside it otherwise reads as a desk that failed.
              */}
            {!yahooIsDesk && published != null && (
              <div className="season-desk">
                <div className="season-desk-head">
                  <b>{deskName('yahoo')}</b>
                  <span className="hint">{pts(published) + ' projected'}</span>
                </div>
                <p className="hint">
                  Yahoo&rsquo;s own figure for the whole team, from its matchup card. No
                  number against each player was read, so there is nothing here to re-seat
                  and no best lineup of its own &mdash; only the total, to check the two
                  desks against. Reinstall the league reader and it will scrape one.
                </p>
              </div>
            )}
          </div>
        )}

        {/*
          * THE ONE CHECK THERE IS ON A SCRAPE.
          *
          * Yahoo's per-player column is read off a page, and a page has no
          * contract: the day a heading moves or a column is inserted, the
          * numbers can be wrong while looking perfectly reasonable. The
          * scoreboard's own team total is computed by Yahoo and arrives by a
          * different route, so adding up the scraped starters and comparing is
          * the only way this app can catch that from the outside.
          *
          * Half a point of slack, because the two are rounded differently and
          * a lineup with a kicker or a defence in it is not comparable at all
          * -- Yahoo counts them and no desk here can, so the published figure
          * is legitimately the larger. That case is named rather than flagged.
          */}
        {yahooIsDesk && published != null && !!advice?.desks.yahoo && (() => {
          /*
           * THE ONE CHECK THERE IS ON A SCRAPE, AND IT HAS TO IGNORE SEATING.
           *
           * Yahoo totals the lineup the user has actually set. This app totals
           * the seats it can advise on, which is a smaller thing: it drops the
           * kicker and the defence because no other desk projects them, and it
           * drops a player started where the league has no free seat for him.
           * Comparing `currentPoints` against Yahoo's card therefore reports a
           * difference on a lineup that is perfectly fine, which is a warning
           * that cries wolf and would be ignored within a week.
           *
           * So the comparison is made over the starters themselves, seating
           * left out of it entirely: add up Yahoo's own number for everyone in
           * a starting slot and it must equal what Yahoo's own card says. Both
           * sides are then Yahoo's arithmetic over the same set of players, and
           * a difference can only mean the scrape read the wrong column or the
           * wrong rows -- which is exactly the failure a page with no contract
           * invites, and the only one this can catch from the outside.
           */
          const starting = new Set(slots.filter((s_) => s_.starting).map((s_) => s_.position));
          const summed = roster
            .filter((p) => starting.has(p.selectedPosition ?? ''))
            .reduce((n, p) => n + (p.points.yahoo ?? 0), 0);
          const gap = published - summed;
          return (
            <p className="hint">
              {'Yahoo\u2019s matchup card puts this team at ' + pts(published)
                + ', and its own numbers for the players you are starting add up to '
                + pts(summed) + '. '}
              {Math.abs(gap) < 0.5
                ? 'They agree, which is the only check there is on a column read off a page.'
                : 'They differ by ' + pts(Math.abs(gap)) + ', and both are Yahoo\u2019s own '
                  + 'arithmetic over the same players \u2014 so the column above has been read '
                  + 'off the wrong part of the page. Treat it as unreliable until it agrees.'}
            </p>
          );
        })()}

        {/*
          * A PLAYER THE DESKS DISAGREE ABOUT, NOT A SEAT THEY FILL DIFFERENTLY,
          * and the difference is one this table got wrong twice. A set of
          * startable players scores the same however it is seated, so two desks
          * recommending the same set agree -- whatever slots their two matchings
          * happened to use. Comparing seats named a player both desks start on
          * both sides of this table, first in two `RB` seats and then as an `RB`
          * against a flex, which reads as a decision the user does not have.
          *
          * So the slot sits beside each pick rather than over the row: it says
          * where that desk would put him, which is where the change is made.
          * The spread is shown because it is what says whether the disagreement
          * is two desks splitting hairs or a real difference of opinion.
          */}
        {!!advice?.disputed.length && (
          <>
            <p>
              <b>
                {advice.disputed.length === 1
                  ? 'One player'
                  : advice.disputed.length + ' players'}
              </b>
              {' the two desks disagree about. Both are shown rather than averaged, because '
                + 'an average is an opinion neither desk holds.'}
            </p>
            <table className="season-table">
              <thead>
                <tr>
                  {desks.map((key) => <th key={key}>{deskName(key) + ' starts'}</th>)}
                  <th className="num">Apart</th>
                </tr>
              </thead>
              <tbody>
                {advice.disputed.map((row) => (
                  <tr key={row.picks.map((p) => p.player).join()}>
                    {row.picks.map((pick) => (
                      <td key={pick.desk}>
                        {pick.player ?? <span className="hint">nobody</span>}
                        {pick.slot && <span className="hint mono">{' ' + pick.slot}</span>}
                      </td>
                    ))}
                    <td className="mono num">
                      {pts(row.spread)}
                      {!row.material && <span className="hint"> close</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/*
          * Who both desks start, which is the other half of the same statement
          * and was computed and thrown away until now. It is what makes the
          * table above readable: a player who is not in it is not missing, he
          * is agreed, and a reader who saw him named there yesterday needs to
          * be told which of the two it is.
          */}
        {!!advice?.agreed.length && (
          <p className="hint">
            {'Both desks start ' + advice.agreed.map((a) => a.player).join(', ') + '.'}
          </p>
        )}

        {/*
          * EVERY PLAYER, WITH BOTH DESKS' NUMBERS AND WHAT HE COULD FILL,
          * because the question a user actually asks is why *not* the other
          * one. An empty eligibility column is the answer surprisingly often: a
          * quarterback on a roster with no quarterback slot outprojects the
          * flex starter and still cannot play there, and without that column the
          * advice looks as though it overlooked him.
          *
          * IT NO LONGER WAITS ON A DESK, because it is now the only place the
          * user's own roster appears at all -- the list below is the rest of
          * the league. A desk that failed costs its own column and nothing
          * else; the banner above says so, and every other column here came out
          * of the league the browser read rather than out of a feed. Gated on a
          * desk, a week where both of them fell over showed the user every
          * rival's roster and not their own.
          */}
        {!!roster.length && (
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
                {tableDesks.map((desk) => (
                  <th key={desk.key} className="num">{deskName(desk.key)}</th>
                ))}
                <th>Can fill</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => {
                /*
                 * WHY THE POOL AND NOT THE PROJECTION SAYS WHETHER TO START
                 * HIM. A desk projects a hurt player perfectly happily, so a
                 * lineup read off the numbers alone will start a man who is
                 * out, and the roster tables below carried the one column that
                 * would have said so. It belongs beside the numbers it
                 * qualifies rather than three panels further down.
                 */
                const held = pool.get(p.playerKey) ?? null;
                return (
                  <tr
                    key={p.playerKey}
                    data-bench={p.selectedPosition === 'BN' || p.selectedPosition === 'IR'}
                  >
                    <td className="mono">{p.selectedPosition ?? '—'}</td>
                    <td>{p.name ?? p.playerKey}</td>
                    {/*
                      * Every eligible position, which is not the same question
                      * as `Can fill` beside it: a quarterback on a roster with
                      * no quarterback slot is eligible at QB and fills nothing.
                      */}
                    <td className="mono">{p.positions.join(', ') || '—'}</td>
                    <td className="mono">{p.team ?? '—'}</td>
                    <td className="mono num">{held?.byeWeek ?? p.byeWeek ?? '—'}</td>
                    <td className="mono num">
                      {held ? (held.percentOwned == null ? '—' : held.percentOwned + '%') : ''}
                    </td>
                    <td className="hint">
                      {held
                        // Yahoo's own code, spelt out where it spelt it out.
                        // Never read as an injury: `NA` is 44% of the pool and
                        // means unrostered rather than hurt.
                        ? (held.statusFull || held.status || 'nothing reported')
                        // "Not in the pool" is a claim about the player, and it
                        // can only be made when the pool actually answered.
                        : pooled ? 'not in the pool' : ''}
                    </td>
                    {tableDesks.map((desk) => (
                      <td key={desk.key} className="mono num">
                        {/*
                          * Blank where the desk never answered, `none` where it
                          * answered and had nothing for this player, and the
                          * number otherwise. The rival tables draw the same
                          * three states through `deskCell`; this one reads its
                          * own roster, which carries the points per player
                          * rather than per team.
                          */}
                        {!desk.answered ? '' : p.points[desk.key] == null
                          ? <span className="hint">none</span>
                          : pts(p.points[desk.key])}
                      </td>
                    ))}
                    <td className="mono">
                      {p.fills.length
                        ? p.fills.join(', ')
                        : <span className="hint">no starting slot</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/*
              * THE SAME TOTALS THE RIVALS CARRY, AND FROM THE SAME PLACE.
              *
              * The desk blocks above already say "8.9 now, 12.5 best", so this
              * is not the only place the numbers appear -- but it is the only
              * place they sit under the column they are a total of, which is
              * what makes this roster comparable with the eleven below it. A
              * table that made the reader scroll up to a different layout to
              * find its total is one they cannot put beside another.
              *
              * Read off `lineup.teams` rather than off `advice.desks`, though
              * both hold it, so that this roster and every rival get their
              * totals by one path. Two paths agreeing today is not the same as
              * one path.
              */}
            {!!tableDesks.length && !!ownTeam && (
              <tfoot>
                <tr>
                  <td colSpan={7}>Starters</td>
                  {tableDesks.map((desk) => (
                    <td key={desk.key} className="mono num">{pts(totalNow(ownTeam, desk))}</td>
                  ))}
                  <td />
                </tr>
                <tr>
                  <td colSpan={7} className="hint">Best possible</td>
                  {tableDesks.map((desk) => (
                    <td key={desk.key} className="mono num hint">
                      {pts(totalBest(ownTeam, desk))}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {/*
          * The permanent limits, last, because they qualify everything above
          * rather than any one row of it. A kicker slot gets no advice at all
          * and the screen has to say so: Y9.1 could not reproduce a kicker's or
          * a defence's components against either feed's own published points,
          * and a ruleset fitted by least squares returned a 30-39 yard field
          * goal at -0.29 points while fitting all 32 kickers to within 0.008.
          */}
        {(!!first?.unscoreable.length || !!unsupported.length || !!missed.length) && (
          <p className="hint">
            {!!first?.unscoreable.length && (
              'No desk projects ' + first.unscoreable.join(' or ') + ', so '
              + (first.unscoreable.length === 1 ? 'that slot gets' : 'those slots get')
              + ' no advice and ' + (first.unscoreable.length === 1 ? 'its' : 'their')
              + ' points are not in the totals above. ')}
            {!!unsupported.length && (
              'This league scores ' + unsupported.map((rule) => rule.name).join(', ')
              + ', which no desk publishes, so '
              + (unsupported.length === 1 ? 'that rule is' : 'those rules are')
              + ' missing from every total rather than counted as zero. ')}
            {missed.map((entry) => deskName(entry.key) + ' projected nothing for '
              + entry.names!.join(', ') + '. ').join('')}
          </p>
        )}
      </div>
    </section>
  );
}

export default function SeasonScreen({
  read, leagueId, held, forgotten, loading, error, anonymous,
  lineup, lineupLoading, lineupError, onRead, onBack,
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
  /*
   * The pool's word on the user's own players, for the week's table to read.
   * Keyed off the roster the league read marked as yours rather than off the
   * lineup's `teamKey`, because `own` is settled by the guid and a key match
   * would be the seat guess Y7.1 exists to avoid.
   */
  const ownPool = new Map(
    (league?.rosters.find((r) => r.own)?.players ?? []).map((p) => [p.playerKey, p.pool]),
  );

  /*
   * WHERE THE USER'S OWN ROSTER APPEARS, WHICH IS ONE PLACE AND NOT TWO.
   *
   * The week's table is that roster in full -- every player, the slot he is in,
   * what the pool says about him, and both desks' numbers besides -- so listing
   * it again among the rivals said everything twice and put the copy with less
   * on it further down the page.
   *
   * The fallback is the point of the flag rather than a guard on it. The week's
   * table comes from a second request, and when that request fails there is no
   * table to have moved the roster into: dropping it from the list regardless
   * would show every rival's roster and not the reader's own, which is worse
   * than the duplicate this removes. So the condition here is exactly the one
   * `Advice` renders the table on.
   */
  const ownAbove = !lineupError && !!lineup?.read && !!lineup.roster?.length;
  const ownAt = league?.rosters.findIndex((r) => r.own) ?? -1;
  const ownName = ownAt < 0 ? null : maskTeam(
    teamNames.get(league!.rosters[ownAt].teamKey ?? '') || 'Team ' + (ownAt + 1),
    ownAt,
    true,
    anonymous,
  );
  /*
   * The rosters to list, each still carrying the place it holds in the league's
   * own list. The index is what names a team when names are hidden, so taking
   * it from the filtered array would renumber every team below the user's.
   *
   * THE TEAM BEING PLAYED COMES FIRST, which is the one departure from the
   * league's own order and is worth it: of the eleven rosters below, one is the
   * roster this week is actually decided against, and leaving it in team order
   * puts it anywhere. A stable partition rather than a sort, so everything else
   * keeps the order Yahoo gave it, and `at` is untouched -- the label a masked
   * team wears is its place in the league and not its place in this list.
   *
   * The key can come from either request. `/lineup` carries it so a screen
   * showing the week's advice need not have fetched the league, and the
   * snapshot carries it because that is where it was read; whichever answered
   * first is right, and both are null where the installed reader sent no
   * scoreboard.
   */
  const opponentKey = lineup?.opponentTeamKey ?? snapshot?.opponentTeamKey ?? null;
  const shown = (league?.rosters ?? [])
    .map((roster, at) => ({ roster, at }))
    .filter(({ roster }) => !(ownAbove && roster.own));
  const isOpponent = (roster: SeasonRoster) => !!opponentKey && roster.teamKey === opponentKey;
  const listed = [
    ...shown.filter(({ roster }) => isOpponent(roster)),
    ...shown.filter(({ roster }) => !isOpponent(roster)),
  ];

  /*
   * The projection columns every roster below carries, and the same set for all
   * of them: these tables are read down the page as much as across, so a team
   * whose desk happened to fail must not be a column narrower than the rest.
   *
   * Yahoo is appended only where a scoreboard actually came, because its column
   * is blank down the roster and carries a total alone -- an empty one with no
   * total under it would be a column that says nothing at all.
   */
  const teamsByKey = new Map((lineup?.teams ?? []).map((team) => [team.teamKey, team]));
  const answeredDesks = lineup?.advice?.answered ?? [];
  /*
   * Yahoo as a column without being a desk: some team has a published total
   * off the scoreboard, but no roster page was scraped for per-player numbers.
   * `answered: false` is what makes those cells read as "not read" rather than
   * as "nobody projected him".
   */
  const anyPublished = (lineup?.teams ?? []).some((team) => team.totals.yahooPublished != null);
  const rosterDesks: DeskColumn[] = [
    ...answeredDesks.map((key) => ({ key: key as DeskKey, answered: true })),
    ...(!answeredDesks.includes('yahoo') && anyPublished
      ? [{ key: 'yahoo' as DeskKey, answered: false }]
      : []),
  ];
  const yahooScraped = answeredDesks.includes('yahoo');
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

        {/*
          * The advice comes first, above the ages and the rosters, because it
          * is what the screen is now for. The banners stay above it: a reader
          * too old to send every roster, or a slot list that never arrived,
          * both change what the advice below is worth.
          */}
        <Advice
          lineup={lineup}
          loading={lineupLoading}
          error={lineupError}
          team={ownName}
          slots={league?.slots ?? []}
          pool={ownPool}
          pooled={!!league?.joined.pool}
        />

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
            <h2 className="eyebrow">{ownAbove ? 'Other rosters' : 'Rosters'}</h2>
            {/*
              * Counted over what is listed rather than over the league, because
              * a league-wide total printed beside a list one team short is a
              * number that does not add up on the screen carrying it.
              */}
            <span className="hint mono">
              {listed.length
                ? listed.reduce((n, { roster }) => n + roster.matched.of, 0) + ' players'
                : ''}
            </span>
          </div>
          <div className="setup-body">
            {/*
              * Said once, above the lot, rather than under each of eleven
              * tables. What it has to explain is the shape of the totals: they
              * leave out the bench, and they leave out the kicker and the
              * defence too, which no desk projects at all.
              */}
            {!!rosterDesks.length && (
              <p className="hint">
                {'Each total is that team’s starters only. The seats no desk projects '
                  + '— kicker and defence — are left out of it rather than counted as '
                  + 'nothing, so a total is lower than the week Yahoo will actually score.'}
                {rosterDesks.some((d) => d.key === 'yahoo') && (yahooScraped
                  ? ' Yahoo\u2019s numbers are read off each team\u2019s own roster page, which '
                    + 'is the only place it publishes them.'
                  : ' Yahoo published a total for each team and no number against each player, '
                    + 'so its column carries the total alone.')}
              </p>
            )}
            {league && listed.length
              ? listed.map(({ roster, at }) => (
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
                  desks={rosterDesks}
                  team={teamsByKey.get(roster.teamKey ?? '') ?? null}
                  opponent={isOpponent(roster)}
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
