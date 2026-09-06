import { useMemo, useState } from 'react';
import { CERTAINLY_GONE, survivalOdds } from '../engine/survival';
import useNarrow from '../useNarrow';
import { pickLabelWithOverall } from '../picks';
import type { Recommendation } from '../engine/value';
import type { Player, Position, SortKey } from '../engine/types';
import { POOL_SORTS, POSITIONS } from '../engine/types';

/**
 * How far apart the sources have to be before it is worth marking, in picks.
 *
 * Two sources measuring the same drafts a few picks apart is noise. Most of a
 * round apart is a disagreement, and the reason to look at it is that one of
 * them is wrong about a player you might be about to take.
 */
const SPLIT_WORTH_MARKING = 12;

/**
 * WHERE THE SURVIVAL BAR IS WORTH DRAWING AT ALL.
 *
 * Measured on a real board: of 620 players, 593 read exactly 100 per cent and 7
 * read 0, leaving 20 anywhere in between. Several rounds in it was 547, 2 and
 * 34. The model is why — a player goes at his ADP with a spread of about a
 * ninth of it, so "might or might not last" is a band about twenty five players
 * wide and everyone outside it is certain either way.
 *
 * Drawn on every row, that is a bar which never moves. The list is sorted by
 * ADP or by worth, so the top of the screen is always the certainly-gone end
 * and scrolling past your own next pick only reaches hundreds of identical full
 * ones. It reads as a broken control rather than as a confident answer.
 *
 * So it is drawn where it says something and replaced by the word where it does
 * not, which is what this file already does with FELL and what the value panel
 * does when every position holds up. Certainty needs no bar: "gone" is the
 * whole reading, and "he will be there" is not worth a row of height paid six
 * hundred times.
 */
const CERTAINLY_THERE = 0.97;

interface Props {
  players: Player[];
  myRank: Map<string, number> | null;
  notes: Map<string, string> | null;
  currentPick: number;
  myNextPick: number | null;
  teams: number;
  onDraft: (id: string) => void;
  canDraft: boolean;
  queue: string[];
  onQueue: (id: string) => void;
  formatLabel: string;
  /**
   * What a replacement starter at each position is projected to score.
   *
   * The projection alone does not say whether a player is worth taking: 240
   * points is a poor starting back and an outstanding tight end. Subtracting
   * this is what makes the six positions comparable on one list.
   */
  replacement: Record<Position, number>;
  /**
   * The odds read off this room rather than off ADP, when a forecast exists.
   *
   * ADP answers what an average room does. Once real picks are on the board
   * the room simulates forward from them, and a receiver run that ADP cannot
   * see moves these numbers where it cannot move the other ones.
   */
  roomOdds: Map<string, number> | null;
  /**
   * The pick this turn is for, when there is one and it is yours to make.
   *
   * Null is a real answer and the common one late on: with the top two within
   * a field goal of each other there is no decision to report, and the sort
   * you already chose is the better guide.
   */
  recommended: Recommendation | null;
  /**
   * Who the pick is instead, once the one above has gone, deepest first out.
   *
   * The same board priced again with him removed rather than the leaders at
   * the other positions, which is what the cost of waiting panel already
   * lists. Empty whenever `recommended` is null: there is no second choice to
   * a choice nobody made.
   */
  alternates: Recommendation[];
  /**
   * The back you hold that an available back is the backup to, by his id.
   *
   * Only ever filled once your starting backs are, because that is the only
   * time a handcuff is the right use of a pick. See `handcuffsFor`.
   */
  handcuffs: Map<string, Player>;
  /** Whether the pick being made is your own. Decides how the flag is worded. */
  yourTurn: boolean;
  /**
   * The order the pool opens on, from settings.
   *
   * Only the opening one. Sorting is a thing you do to the list in front of
   * you, so the control stays where it is and this says nothing about it after
   * the first render.
   */
  openSort: SortKey;
}

/**
 * How long a note has to be before it is worth clamping.
 *
 * Short notes are the point of notes, and a control on "Handcuff, do not
 * reach" is a control that does nothing. Only a note that would actually be
 * cut gets a way to open it.
 */
const NOTE_CLAMP = 70;

/** What you wrote about a player, on the row where you have to act on it. */
function PlayerNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  if (text.length <= NOTE_CLAMP) {
    return <span className="player-note">{text}</span>;
  }

  return (
    <button
      type="button"
      className={'player-note is-toggle' + (open ? ' is-open' : '')}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <span className="player-note-text">{text}</span>
      <span className="player-note-more">{open ? 'LESS' : 'MORE'}</span>
    </button>
  );
}

/**
 * Which source said what, for the row you are hovering.
 *
 * The consensus is a mean, and a mean hides whether three sources agreed or
 * two disagreed violently. This is the way back to the numbers behind it.
 */
function sourceTitle(p: Player): string {
  const parts = [
    p.sleeperAdp != null ? 'Sleeper ' + p.sleeperAdp.toFixed(1) : null,
    p.ffcAdp != null ? 'FFC ' + p.ffcAdp.toFixed(1) : null,
    p.espnPick != null && p.espnVotes ? 'ESPN ' + p.espnPick.toFixed(1) : null,
    // Only ever set while a room is being read, and then only for the few
    // hundred it prices. Named so the hover is not silent about a feed that
    // moved the number above it.
    p.roomAdp != null ? 'Your room ' + p.roomAdp.toFixed(1) : null,
  ].filter(Boolean);
  if (!parts.length) return 'No source ranked him.';
  const head = parts.join(' · ');
  return p.consensusSpread != null
    ? head + '  (' + Math.round(p.consensusSpread) + ' picks apart)'
    : head + '  (one source only)';
}

/**
 * What to call an alternative, counting the named pick as the first.
 *
 * As long as the chain the screen asks for, which is `PICKS_DEEP` there and
 * three names in the key below. A deeper chain needs all three moved together.
 */
const ORDINALS = ['2nd', '3rd', '4th'];

export default function PlayerPool(props: Props) {
  const {
    players, myRank, notes, currentPick, myNextPick, teams, onDraft, canDraft, queue, onQueue,
    replacement, roomOdds, recommended, alternates, handcuffs, yourTurn, openSort,
  } = props;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Position | 'ALL' | 'QUEUE'>('ALL');
  // Your own ranking only orders a list while you have one loaded. Asked for
  // without one, it falls to ADP rather than to a column of nothing.
  const [sort, setSort] = useState<SortKey>(
    openSort === 'mine' && !myRank ? 'adp' : openSort,
  );
  const narrow = useNarrow();

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let out = players;

    if (filter === 'QUEUE') out = out.filter((p) => queue.includes(p.id));
    else if (filter !== 'ALL') out = out.filter((p) => p.position === filter);

    if (needle) {
      out = out.filter((p) => p.name.toLowerCase().includes(needle)
        || p.team.toLowerCase().includes(needle));
    }

    const scored = out.map((p) => ({
      player: p,
      odds: myNextPick
        ? (roomOdds?.get(p.id) ?? survivalOdds(p, currentPick, myNextPick))
        : 1,
      mine: myRank?.get(p.id) ?? Number.MAX_SAFE_INTEGER,
      // Null rather than zero where nobody projected him. Zero is a real
      // reading — a player worth exactly what anyone off the waiver wire is —
      // and sorting the unprojected in among them would invent that claim.
      worth: p.points == null ? null : p.points - replacement[p.position],
    }));

    scored.sort((a, b) => {
      if (sort === 'mine') return a.mine - b.mine || a.player.adp - b.player.adp;
      if (sort === 'worth') return (b.worth ?? -Infinity) - (a.worth ?? -Infinity);
      if (sort === 'odds') return a.odds - b.odds || a.player.adp - b.player.adp;
      if (sort === 'split') {
        return (b.player.consensusSpread ?? -1) - (a.player.consensusSpread ?? -1)
          || a.player.adp - b.player.adp;
      }
      return a.player.adp - b.player.adp;
    });

    /*
     * THE WHOLE POOL
     *
     * This used to stop at 300 rows and say nothing about it. With 550 players
     * left that hid 250 of them, and under the "Mine" sort the cap landed almost
     * exactly at the end of a 300 player ranking file, so every unranked player
     * was invisible. Going looking for one and not finding him reads as the
     * player being gone rather than the list being short.
     */
    return scored;
  }, [players, search, filter, sort, queue, myRank, currentPick, myNextPick, replacement,
    roomOdds]);

  return (
    <>
      <div className="pool-controls">
        {/*
          * On a phone the search box and the sort share a row, and the sort is
          * a select rather than four chips. The chips are the better control
          * and they cost a whole row of a screen whose job is the list under
          * them. Sort is set once a draft; the position filter is not, so that
          * one keeps its chips.
          */}
        <div className="pool-find">
          <input
            className="input"
            type="search"
            value={search}
            placeholder={narrow ? 'Search ' + players.length + ' players' : 'Search a player or team'}
            aria-label="Search the pool"
            onChange={(e) => setSearch(e.target.value)}
          />
          {narrow && (
            <select
              className="input pool-sort"
              aria-label="Sort the pool"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {POOL_SORTS
                .filter((k) => k.id !== 'mine' || myRank)
                .map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          )}
        </div>
        <div className="filter-row">
          <button type="button" className="chip" aria-pressed={filter === 'ALL'} onClick={() => setFilter('ALL')}>All</button>
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              className="chip"
              data-pos={pos}
              aria-pressed={filter === pos}
              onClick={() => setFilter(pos)}
            >
              {pos}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            aria-pressed={filter === 'QUEUE'}
            onClick={() => setFilter('QUEUE')}
          >
            <span className="on-wide">{'Queue ' + queue.length}</span>
            <span className="on-narrow">{'☆ ' + queue.length}</span>
          </button>
        </div>
        <div className="filter-row sort-row" style={{ alignItems: 'center', gap: 8 }}>
          <span className="eyebrow">Sort</span>
          <button type="button" className="chip" aria-pressed={sort === 'adp'} onClick={() => setSort('adp')}>ADP</button>
          {myRank && <button type="button" className="chip" aria-pressed={sort === 'mine'} onClick={() => setSort('mine')}>Mine</button>}
          <button type="button" className="chip" aria-pressed={sort === 'worth'} onClick={() => setSort('worth')}>Worth</button>
          <button type="button" className="chip" aria-pressed={sort === 'odds'} onClick={() => setSort('odds')}>
            <span className="on-wide">Least likely to last</span>
            <span className="on-narrow">Going soon</span>
          </button>
        </div>

        {/*
          * WHAT EVERY NUMBER ON A ROW MEANS
          *
          * Closed, so it costs one line of a screen whose job is the list under
          * it, and every row still carries the same reading on hover. It is here
          * rather than in the README because the question is asked on the clock,
          * with fifty seconds left, and nobody reads a README then.
          *
          * Each line says what the number is and what it implies, because the
          * first without the second is what made these unreadable: knowing that
          * CONS is a mean of three sources does not tell you to do anything.
          */}
        <details className="pool-legend">
          <summary>What these numbers mean</summary>
          <dl>
            <dt>ADP</dt>
            <dd>
              Where the feeds you chose say he goes. Lower is earlier. Take him much
              before it and you are reaching; find him well after it and the room has
              let a bargain slide.
            </dd>
            <dt>ALL 3</dt>
            <dd>
              The mean of all three feeds — Sleeper, Fantasy Football Calculator and
              ESPN — whichever of them you chose to price the board with. It is a second
              opinion on ADP rather than a restatement of it: where the two are far
              apart, the feeds you switched off disagree with the ones you left on.
              Choose Averaged with all three feeds and it is the same arithmetic as ADP,
              so the two columns read the same number and only one of them is telling
              you anything. Hover it to see what each feed said.
            </dd>
            <dt>SPLIT</dt>
            <dd>
              Replaces ALL 3 when those three are more than about a round apart about him.
              A warning rather than a verdict: one of them is wrong, and it is worth
              knowing which before you spend a pick finding out.
            </dd>
            <dt>WORTH</dt>
            <dd>
              Projected points above a replacement starter at his own position — the
              player you could have for nothing. This is the number that says whether he
              is worth taking, and the only one you can compare across positions. Below
              zero means the waiver wire has someone as good.
            </dd>
            <dt>FELL</dt>
            <dd>
              How far past his own ADP this pick is. It appears only once he has slid a
              full round, which is the market saying he should already be gone.
            </dd>
            <dt>The bar</dt>
            <dd>
              His chance of still being there at your next pick. Read off a simulation of
              this actual room once enough of it has been drafted, and off ADP before
              that. A low bar only matters if WORTH is high — the panel beside the pool
              is what tells you whether waiting actually costs anything.
            </dd>
            <dd>
              It appears only where the answer is in doubt, which is about twenty five
              players at any moment. Everyone above that band is certain to be there and
              says nothing; everyone below reads "gone by" your pick instead, because a
              bar pinned empty is not a reading, it is a bar that looks broken.
            </dd>
            <dt>R</dt>
            <dd>
              A rookie: no NFL season behind the projection. Read it as a wider spread
              than the number suggests, in both directions.
            </dd>
            <dt>2nd, 3rd, 4th choice</dt>
            <dd>
              Who this pick is for once the name above him has gone. Each one is the
              whole board priced again with everyone ahead of him removed, so it is an
              answer and not a runner-up: when one position is running, the next player
              at it comes second, ahead of every other position's best.
            </dd>
            <dt>HANDCUFF</dt>
            <dd>
              He is the backup to a running back you already hold. Worth almost nothing
              while the man in front of him plays and most of him when he does not,
              which is the one thing WORTH cannot tell you, because WORTH prices him as
              himself. It appears only once your starting backs are filled, since before
              then you need a back who plays. Inferred from the team sheet — no feed
              here publishes a depth chart — so it reads a committee as a starter and a
              backup.
            </dd>
            <dt>COVERS</dt>
            <dd>
              The same thing, where the back you hold is carrying an injury status. The
              insurance has stopped being hypothetical.
            </dd>
          </dl>
        </details>
      </div>

      <div className="pool-list" role="list">
        {rows.length === 0 && (
          <p className="hint" style={{ padding: '18px 12px' }}>
            Nobody left matching that.
          </p>
        )}

        {rows.map(({ player, odds, mine, worth }) => {
          const queued = queue.includes(player.id);
          const pick = recommended?.player.id === player.id ? recommended : null;
          const altAt = alternates.findIndex((a) => a.player.id === player.id);
          const cuff = handcuffs.get(player.id) ?? null;
          const pct = Math.round(odds * 100);
          const note = notes?.get(player.id) ?? null;
          const split = (player.consensusSpread ?? 0) >= SPLIT_WORTH_MARKING;
          // How far the room has let him slide, in picks. A full round past his
          // ADP is a player the market says should already be gone, which is
          // the one thing on this row that is only true right now.
          const fell = currentPick - player.adp;
          return (
            <div
              key={player.id}
              className={'player' + (pick ? ' is-pick' : '')
                + (altAt >= 0 ? ' is-alt' : '')
                + (cuff?.injuryStatus ? ' is-cover' : '')}
              data-pos={player.position}
              role="listitem"
            >
              <button
                type="button"
                className="star"
                aria-pressed={queued}
                aria-label={queued ? 'Take ' + player.name + ' off the queue' : 'Queue ' + player.name}
                onClick={() => onQueue(player.id)}
              >
                {queued ? '★' : '☆'}
              </button>

              <span className="pos-tag">{player.position}</span>

              <button
                type="button"
                onClick={() => canDraft && onDraft(player.id)}
                disabled={!canDraft}
                title={canDraft ? 'Draft ' + player.name : 'Not your pick'}
                style={{
                  background: 'none', border: 0, padding: 0, textAlign: 'left', minWidth: 0,
                  cursor: canDraft ? 'pointer' : 'default',
                }}
              >
                <span className="player-name">{player.name}</span>
                <span className="player-sub">
                  {player.team}
                  {altAt >= 0 && (
                    <span
                      className="player-alt"
                      title={'The ' + ORDINALS[altAt] + ' choice this pick, once everyone '
                        + 'named above him has gone.'}
                    >
                      {' · ' + ORDINALS[altAt] + ' choice'}
                    </span>
                  )}
                  {player.bye ? ' · BYE ' + player.bye : ''}
                  {mine !== Number.MAX_SAFE_INTEGER ? ' · MINE ' + mine : ''}
                  {fell >= teams && (
                    <span className="player-fell" title={'The market takes him around pick '
                      + player.adp.toFixed(0) + '. He is still here at ' + currentPick + '.'}>
                      {' · FELL ' + Math.round(fell)}
                    </span>
                  )}
                  {player.yearsExp === 0 && (
                    <span title="A rookie. No NFL season behind the projection.">
                      {' · R'}
                    </span>
                  )}
                  {player.injuryStatus ? ' · ' : ''}
                  {player.injuryStatus && <span className="injury">{player.injuryStatus}</span>}
                </span>
              </button>

              {/*
                * The spread and the sample belong on ADP rather than anywhere
                * else, because they are what the bar under this row is worked
                * out from. A number with no sense of its own width reads as
                * more certain than it is: 1,806 drafts agreeing to within half
                * a pick is a fact, and 40 agreeing to within twelve is not the
                * same kind of claim.
                */}
              <span
                className="player-num is-quiet"
                title={'Spread ' + (player.stdevMeasured ? '±' : 'about ±')
                  + player.adpStdev.toFixed(1) + ' picks'
                  + (player.stdevMeasured
                    ? ', measured across ' + player.timesDrafted.toLocaleString() + ' drafts.'
                    : '. No feed measures him, so this is estimated from his ADP.')}
              >
                <b>{player.adp.toFixed(1)}</b>
                <small>ADP</small>
              </span>

              <span
                className={'player-num is-quiet' + (split ? ' is-split' : '')}
                title={sourceTitle(player)}
              >
                <b>{player.consensus != null ? player.consensus.toFixed(1) : '—'}</b>
                <small>{split ? 'SPLIT ' + Math.round(player.consensusSpread!) : 'ALL 3'}</small>
              </span>

              {/*
                * What he is worth, not what he scores.
                *
                * This cell used to print the raw projection, which is the one
                * number on the row that cannot be read across positions: 240
                * points is a poor starting back and an outstanding tight end,
                * and nothing said which. Against a replacement starter at his
                * own position the six become one list, and the sign alone
                * answers whether he beats what the waiver wire holds.
                */}
              <span
                className={'player-num is-lead' + (worth != null && worth > 0 ? ' is-worth' : '')}
                title={player.points != null
                  ? Math.round(player.points) + ' projected points, against '
                    + Math.round(replacement[player.position]) + ' for a replacement '
                    + player.position + '.'
                  : 'Nobody projected him, so there is nothing to price.'}
              >
                <b>{worth == null ? '—' : (worth > 0 ? '+' : '') + Math.round(worth)}</b>
                <small>WORTH</small>
              </span>

              {/*
                * On the clock this is a verdict, and off it a heads-up: the
                * same arithmetic, but priced against your next turn rather
                * than the one after it. Naming it "take" while somebody else
                * picks would ask for a pick you do not have.
                */}
              {pick && (
                <p className="pick-flag">
                  <span className="pick-flag-tag">{yourTurn ? 'Take' : 'Target'}</span>
                  {'+' + Math.round(pick.worth) + ' over a replacement ' + player.position}
                  {pick.urgency >= 1
                    ? ', and ' + Math.round(pick.urgency) + ' of that goes '
                      + (yourTurn ? 'if you wait' : 'before your turn')
                    : ''}
                  {pick.fillsStarter
                    ? '. You still have to start one.'
                    : '. Your lineup is full, so this is on worth alone.'}
                </p>
              )}

              {/*
                * What to do when the name above is taken before you can take
                * him, which out of turn is the likeliest thing to happen next.
                * Each is the board priced again with everyone above him gone,
                * so reading down the line is reading a real sequence rather
                * than a top four.
                */}
              {pick && alternates.length > 0 && (
                <p className="pick-flag pick-alts">
                  <span className="pick-flag-tag">{yourTurn ? 'Or' : 'If he goes'}</span>
                  {alternates.map((alt) => (
                    <span className="pick-alt" key={alt.player.id}>
                      <b>{alt.player.name}</b>
                      {' ' + alt.player.position + ' '}
                      <span className="pick-alt-worth">
                        {(alt.worth > 0 ? '+' : '') + Math.round(alt.worth)}
                      </span>
                    </span>
                  ))}
                </p>
              )}

              {/*
                * A back is worth what he scores; a back behind one of yours is
                * worth what the man in front of him scores, on the week that
                * man is out. Nothing else on this row can say that, because
                * every other number here prices him as himself.
                */}
              {cuff && (
                <p className={'pick-flag pick-cuff' + (cuff.injuryStatus ? ' is-cover' : '')}>
                  <span className="pick-flag-tag">
                    {cuff.injuryStatus ? 'Covers' : 'Handcuff'}
                  </span>
                  {'Behind ' + cuff.name + ', who you hold.'}
                  {cuff.injuryStatus
                    // Whose status it is has to be said. The row itself carries
                    // this player's, and the one that makes him worth a pick
                    // belongs to somebody who is not on this row at all.
                    ? ' ' + cuff.name.split(' ').slice(-1)[0] + ' is ' + cuff.injuryStatus
                      + ', so this is the pick that covers him.'
                    : ' Worth little until he is out, and most of him when he is.'}
                </p>
              )}

              {note && <PlayerNote text={note} />}

              {myNextPick && odds > CERTAINLY_GONE && odds < CERTAINLY_THERE && (
                <span className="survival">
                  <span className="survival-track">
                    <span
                      className={'survival-fill' + (pct < 25 ? ' is-thin' : '')}
                      style={{ width: pct + '%' }}
                    />
                  </span>
                  <span className="survival-odds">
                    {pct + '% to ' + pickLabelWithOverall(myNextPick, teams)}
                    {roomOdds?.has(player.id) ? ' · room' : ''}
                  </span>
                </span>
              )}

              {/* No bar, because there is no doubt to draw. The one worth
                  saying is this one: he is not reaching your turn. */}
              {myNextPick && odds <= CERTAINLY_GONE && (
                <span className="survival is-gone">
                  <span className="survival-odds">
                    {'gone by ' + pickLabelWithOverall(myNextPick, teams)}
                    {roomOdds?.has(player.id) ? ' · room' : ''}
                  </span>
                </span>
              )}

            </div>
          );
        })}
      </div>
    </>
  );
}
