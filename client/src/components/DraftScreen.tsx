import { useEffect, useMemo, useRef, useState } from 'react';
import DraftBoard from './DraftBoard';
import PlayerPool from './PlayerPool';
import ValuePanel from './ValuePanel';
import { describeLean, forecast, pricedPositions, priorLean } from '../engine/forecast';
import RosterPanel from './RosterPanel';
import {
  autoDraftRest, availablePlayers, createDraft, currentPick, currentTeam, draftPlayer,
  nextUserChoice, playersOf, presetFor, runCpuPick, runPresetsOnly, runToUserTurn,
  undoPick, undoToMyLastPick,
} from '../engine/draft';
import type { DraftEngine } from '../engine/draft';
import { fetchDraftPicks, postRoomAdvice } from '../api';
import { maskTeam } from '../anon';
import { pickLabel, pickLabelWithOverall } from '../picks';
import { livePresets, offBoardPlayer } from '../engine/live';
import { recommendPick, replacementPoints } from '../engine/value';
import { emptyCounts } from '../engine/roster';
import AdpSourcePicker from './AdpSourcePicker';
import type { AppMode, Board, Platform, Player } from '../engine/types';

/** How often the assistant asks Sleeper for new picks. */
const POLL_MS = 8000;

/**
 * How many times the room is played out to read the odds off it.
 *
 * The numbers stop moving somewhere under this: at 120 runs and again at 240
 * the mean picks per position agree to a tenth.
 */
const FORECAST_RUNS = 150;

interface Props {
  engine: DraftEngine;
  board: Board;
  pace: number;
  mode: AppMode;
  anonymous: boolean;
  draftId: string | null;
  /** Which platform the followed draft is on. Sleeper unless a league says so. */
  platform: Platform;
  rankingEntries: import('../engine/types').RankingEntry[] | null;
  /** What you wrote about a player, by player id. Null when you wrote none. */
  notes: Map<string, string> | null;
  /**
   * Which ADP the app is asking for, which is not yet which one the board
   * holds. The two differ for as long as the new board is in flight.
   */
  adpSource: string;
  onAdpSource: (next: string) => void;
  onEngine: (next: DraftEngine) => void;
  onFinish: () => void;
  onLeave: () => void;
}

type Pane = 'pool' | 'board' | 'roster';

export default function DraftScreen(props: Props) {
  const {
    engine, board, pace, mode, anonymous, draftId, platform, rankingEntries, notes,
    adpSource, onAdpSource, onEngine, onFinish, onLeave,
  } = props;

  const [queue, setQueue] = useState<string[]>([]);
  const [pane, setPane] = useState<Pane>('pool');
  const [paused, setPaused] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  /**
   * Players the real draft took who this board does not hold. Kept rather
   * than counted because a rebuild needs them back: drop them and every pick
   * after one of them sits a slot out of place.
   */
  /**
   * What this room's own site says its drafters do, when it says anything.
   *
   * Only Yahoo publishes it, and only to the bridge, so it arrives with the
   * picks rather than from a feed this app could fetch itself. Kept as it
   * comes: what it is worth is decided in the engine.
   */
  const [roomAdp, setRoomAdp] = useState<Map<string, number> | null>(null);
  const [offBoard, setOffBoard] = useState<Player[]>([]);
  /**
   * Entering the room's picks yourself instead of reading them off a feed.
   *
   * The engine records a pick against whoever is on the clock, so a pick you
   * type is the same pick to everything downstream: the rosters fill, the board
   * fills, and the grade at the end reads them like any other. It stops the poll
   * while it is on, because a feed rebuilding the board underneath you would
   * throw away what you just typed.
   */
  const [manual, setManual] = useState(!draftId);
  const assistant = mode === 'assistant';

  const { state } = engine;
  const teams = state.league.teams;
  const pick = currentPick(state);
  const onClock = currentTeam(state);
  // A pick of yours that is already settled is not your turn. It is a keeper,
  // or a pick the real draft has already made, and the board should move past
  // it rather than sit waiting for a decision that was taken weeks ago.
  const settledNow = presetFor(engine, pick);
  const yourTurn = !!onClock?.isUser && !settledNow;
  /** In manual entry every pick is yours to record, not just your own. */
  const canPick = (yourTurn || (assistant && manual)) && !state.done;
  const myNext = nextUserChoice(engine);

  // The survival bar always answers "will this player last until the next time
  // I pick". On your own turn that is the pick after this one, not this one,
  // and pointing it at the current pick would read 100 per cent for everybody.
  const oddsTarget = yourTurn ? nextUserChoice(engine, pick + 1) : myNext;

  // The clock reads the same pick the bar is measured against. On your turn
  // "your next pick" used to repeat the pick you were making, which on a phone
  // with the labels stripped out was the same number printed twice.
  const away = oddsTarget == null ? null : oddsTarget - pick;

  const available = useMemo(() => availablePlayers(engine), [engine]);
  const myTeam = state.teams.find((t) => t.isUser)!;
  const myPlayers = useMemo(() => playersOf(engine, myTeam), [engine, myTeam]);

  /** What you already hold, by position. The roster half of a recommendation. */
  const myCounts = useMemo(() => {
    const counts = emptyCounts();
    for (const p of myPlayers) counts[p.position] += 1;
    return counts;
  }, [myPlayers]);

  const myRank = engine.rankOverride;

  // Which of your players you kept rather than drafted.
  const keptIds = useMemo(() => {
    const out = new Set<string>();
    for (const [overall, preset] of engine.presets) {
      if (preset.source !== 'keeper') continue;
      if (state.teams[state.order[overall - 1]]?.isUser) out.add(preset.playerId);
    }
    return out;
  }, [engine]);

  /*
   * FOLLOWING A REAL DRAFT
   *
   * Nothing is simulated. Every few seconds the assistant asks Sleeper what has
   * happened and rebuilds the board from those picks alone, so the board is
   * never ahead of the room. Rebuilding rather than appending is deliberate: a
   * pick can be undone by a commissioner, and a board that only ever grows
   * would keep a pick that no longer exists.
   */
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    if (!assistant || !draftId || paused || manual) return undefined;
    let alive = true;

    const poll = async () => {
      try {
        const live = await fetchDraftPicks(platform, draftId, {
          scoring: state.league.scoring,
          teams: state.league.teams,
          // The board in hand, not the one the engine was built from. Which
          // players are off it is answered against the board about to be used,
          // or a player missing from only one of the two lands twice.
          adpSource: board.meta.adpSource,
          year: state.league.year,
        });
        if (!alive) return;

        const presets = livePresets(live.picks);
        const extras = live.picks.filter((p) => p.offBoard).map(offBoardPlayer);

        setOffBoard(extras);
        setRoomAdp(live.roomAdp?.length
          ? new Map(live.roomAdp.map((r) => [r.id, r.adp]))
          : null);
        setLiveError(null);
        setLiveAt(Date.now());

        const current = engineRef.current;
        if (current.state.picks.length === presets.length) return;

        onEngine(runPresetsOnly(createDraft(
          { ...current.state.league, adpSource: board.meta.adpSource },
          current.state.cpu,
          [...board.players, ...extras],
          rankingEntries,
          presets,
        )));
      } catch (err) {
        if (alive) setLiveError(String((err as Error).message));
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [assistant, draftId, platform, paused, manual, board, rankingEntries,
    state.league.scoring, state.league.teams, state.league.year]);

  /*
   * A different ADP is a different board, and the engine keeps its own copy of
   * the pool. Every pick that has happened is handed back as settled, so what
   * changes is only what the players left are worth, never what was taken.
   *
   * The poll above would arrive at the same place on its next tick, but it does
   * not run while the draft is paused or is being entered by hand, and the
   * choice has to land in those too. Waiting on the board rather than on what
   * was asked for means the swap happens once, when the new numbers are here.
   */
  useEffect(() => {
    if (!assistant) return;
    const current = engineRef.current;
    if (current.state.league.adpSource === board.meta.adpSource) return;

    onEngine(runPresetsOnly(createDraft(
      { ...current.state.league, adpSource: board.meta.adpSource },
      current.state.cpu,
      [...board.players, ...offBoard],
      rankingEntries,
      current.state.picks.map((p) => ({
        overall: p.overall,
        playerId: p.playerId,
        // A pick entered by hand is one you relayed from the real room, which
        // is what the engine already calls manual.
        source: p.preset ?? ('manual' as const),
      })),
    )));
  }, [assistant, board, offBoard, rankingEntries, onEngine]);

  // Run the room. One pick per tick so the board reads like a draft, or the
  // whole gap at once when the pace is set to instant.
  useEffect(() => {
    if (assistant || state.done || yourTurn || paused) return undefined;
    if (pace === 0) {
      // runToUserTurn stops at a pick you actually choose. Its own copy of that
      // rule used to live here and only checked whose pick it was, so a keeper
      // of yours halted the board and no amount of waiting moved it.
      onEngine(runToUserTurn(engine));
      return undefined;
    }
    const timer = setTimeout(() => onEngine(runCpuPick(engine)), pace);
    return () => clearTimeout(timer);
  }, [engine, yourTurn, paused, pace, state.done]);

  useEffect(() => {
    // A real draft ending is a result worth reading. A mock ending is too.
    if (state.done) onFinish();
  }, [state.done]);

  /*
   * The room, played forward from where it actually is.
   *
   * Only when following a real one, for two separate reasons.
   *
   * It would be wrong in a mock. The lean is measured off the picks and then
   * added to the dials, which is right for a room whose bias is unknown and
   * double counting for one you set yourself: a room dialled to force backs at
   * +4 measures at +3.6 and would then be simulated at +5. There is nothing to
   * discover about a room you configured.
   *
   * It would also be too slow. One run costs 100ms to 230ms, rising with the
   * distance to your turn, and a mock takes a pick every 140ms at the default
   * pace, so it would more than double the time each pick takes and block the
   * frame for most of it. Following a real draft the engine changes only when a
   * pick actually lands, a poll apart at most, so there is nothing to throttle.
   */
  /*
   * Where the room publishes its own ADP, that is the lean until the picks can
   * speak for themselves. `observedLean` reads nothing at all until a full
   * round is in, which in a 14 team league is the whole of the first round, and
   * the first round is not the part of a draft worth flying blind through.
   */
  const prior = useMemo(
    () => (roomAdp ? priorLean(board.players, roomAdp) : null),
    [board.players, roomAdp],
  );

  const room = useMemo(
    () => (assistant ? forecast(engine, FORECAST_RUNS, prior) : null),
    [engine, assistant, prior],
  );

  /**
   * What a replacement starter at each position is projected to score.
   *
   * The pool shows every player's points above it, which is the number that
   * answers "is he worth taking" where the raw projection does not: 240 points
   * is a poor starting back and an outstanding tight end, and nothing on the
   * row said which. Measured against the whole board rather than what is left,
   * because replacement level is a fact about the league's shape.
   */
  const replacement = useMemo(
    () => replacementPoints(board.players, teams, state.league.roster),
    [board.players, teams, state.league.roster],
  );

  /** Every position priced for this pick, drawn by the panel and sent to the room. */
  const priced = useMemo(
    () => pricedPositions(
      available, board.players, teams, state.league.roster, pick, oddsTarget, room,
    ),
    [available, board.players, teams, state.league.roster, pick, oddsTarget, room],
  );

  /*
   * The pick this turn is for, named only while it is yours to make.
   *
   * Out of turn it would be a recommendation about a pick somebody else is
   * making, which is a different question and not one worth answering.
   */
  const recommended = useMemo(
    () => (canPick ? recommendPick(priced, myCounts, state.league.roster) : null),
    [canPick, priced, myCounts, state.league.roster],
  );

  /*
   * The same reading, handed to the draft room it is about.
   *
   * Yahoo answers only the tab the user is already sitting in, so the bridge
   * that follows the picks is also the only thing that can put an answer back
   * in front of them. It shows what arrives here and works nothing out itself,
   * which keeps one implementation of the pricing rather than two.
   *
   * Only for a Yahoo draft being followed. A mock has no room to talk to, and
   * a Sleeper draft is read from a feed with no tab of ours in it.
   */
  useEffect(() => {
    if (!assistant || platform !== 'yahoo' || !draftId) return;
    if (oddsTarget == null) return;

    void postRoomAdvice(platform, draftId, {
      onClock: yourTurn,
      pickLabel: pickLabelWithOverall(oddsTarget, teams),
      lean: room ? describeLean(room.lean) : null,
      pick: recommended && {
        name: recommended.player.name,
        position: recommended.player.position,
        worth: recommended.worth,
        urgency: recommended.urgency,
        fillsStarter: recommended.fillsStarter,
      },
      source: room ? { kind: 'room', sims: room.sims } : { kind: 'adp' },
      // Three is what fits over a draft room without covering it. They are
      // already sorted by what waiting costs, so these are the three worth
      // spending the pick on.
      rows: priced.slice(0, 3).map((row) => ({
        position: row.position,
        name: row.best?.name ?? '',
        worth: row.now,
        cost: row.cost,
        odds: row.odds,
        beforeCliff: row.beforeCliff,
      })),
    }).catch(() => {
      // The board on this screen is unaffected, and the panel in the other tab
      // simply keeps the last thing it was given.
    });
  }, [assistant, platform, draftId, oddsTarget, yourTurn, teams, room, priced, recommended]);

  const draft = (id: string) => {
    setQueue((q) => q.filter((x) => x !== id));
    onEngine(draftPlayer(engine, id));
  };

  const takeBest = () => {
    const queued = queue.map((id) => available.find((p) => p.id === id)).filter(Boolean);
    const target = queued[0] ?? available[0];
    if (target) draft(target.id);
  };

  const toggleQueue = (id: string) => {
    setQueue((q) => (q.includes(id) ? q.filter((x) => x !== id) : [...q, id]));
  };

  return (
    <>
      <div className={'clock' + (yourTurn ? ' is-yours' : '')}>
        <div className="clock-read">
          <div>
            <p className="eyebrow">Pick</p>
            <p className="clock-pick">
              {pickLabel(pick, teams)}
              <span className="clock-overall">{'#' + pick}</span>
            </p>
          </div>
          <div className="clock-team">
            <p className="eyebrow">
              {assistant ? (manual ? 'Recording for' : 'Waiting on') : 'On the clock'}
            </p>
            <p className="clock-who" style={yourTurn ? { color: 'var(--gold)' } : undefined}>
              {onClock
                ? maskTeam(onClock.name, onClock.index, onClock.isUser, anonymous)
                : 'Draft complete'}
            </p>
          </div>

          <div className="clock-next">
            <p className="eyebrow">Your next pick</p>
            {oddsTarget == null ? (
              <p className="clock-who">None left</p>
            ) : (
              <p className="clock-nextpick">
                {pickLabel(oddsTarget, teams)}
                <span className="clock-overall">{'#' + oddsTarget}</span>
                {away != null && away > 0 && (
                  <span className="hint" style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                    {away === 1 ? '1 pick away' : away + ' picks away'}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="clock-acts">
          {assistant ? (
            <>
              <span className={'live-dot' + (liveError || manual ? ' is-down' : '')}>
                <span className="on-wide">
                  {manual ? 'Entering picks by hand'
                    : (liveError ? 'Feed not answering' : 'Following live')}
                </span>
                <span className="on-narrow">
                  {manual ? 'By hand' : (liveError ? 'No answer' : 'Live')}
                </span>
              </span>
              {/* Only offered when there is a feed to go back to. Without one,
                  leaving manual entry would stop you recording picks and put
                  nothing in its place. */}
              {draftId && (
                <button
                  type="button"
                  className={'btn' + (manual ? ' is-primary' : '')}
                  onClick={() => setManual((m) => !m)}
                  title={manual
                    ? 'Go back to reading picks off the feed'
                    : 'Type the room’s picks in yourself'}
                >
                  <span className="on-wide">
                    {manual ? 'Follow the feed' : 'Enter picks by hand'}
                  </span>
                  <span className="on-narrow">{manual ? 'Feed' : 'By hand'}</span>
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={!state.picks.length}
                onClick={() => onEngine(undoPick(engine))}
              >
                <span className="on-wide">Undo last pick</span>
                <span className="on-narrow">Undo</span>
              </button>
              {!manual && (
                <button type="button" className="btn" onClick={() => setPaused((p) => !p)}>
                  {paused ? 'Resume' : 'Pause'}
                </button>
              )}
              <button type="button" className="btn is-quiet act-settings" onClick={onLeave}>
                Settings
              </button>
            </>
          ) : (
            <>
              {yourTurn && (
                <button type="button" className="btn is-primary" onClick={takeBest}>
                  <span className="on-wide">
                    {queue.length ? 'Take top of queue' : 'Take best available'}
                  </span>
                  <span className="on-narrow">{queue.length ? 'Take queued' : 'Take best'}</span>
                </button>
              )}
              {!yourTurn && !state.done && (
                <button type="button" className="btn" onClick={() => setPaused((p) => !p)}>
                  {paused ? 'Resume' : 'Pause'}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={!state.picks.length}
                onClick={() => onEngine(undoToMyLastPick(engine))}
              >
                <span className="on-wide">Undo my pick</span>
                <span className="on-narrow">Undo</span>
              </button>
              <button
                type="button"
                className="btn is-quiet"
                onClick={() => onEngine(autoDraftRest(engine))}
              >
                <span className="on-wide">Simulate to the end</span>
                <span className="on-narrow">Sim</span>
              </button>
              <button
                type="button"
                className="btn is-quiet act-settings"
                onClick={onLeave}
                aria-label="Back to settings"
              >
                <span className="on-wide">Settings</span>
                <span className="on-narrow" aria-hidden="true">⚙</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tabs">
        {(['pool', 'board', 'roster'] as Pane[]).map((p) => (
          <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)}>
            {p === 'pool' ? 'Players' : p === 'board' ? 'Board' : 'My team'}
          </button>
        ))}
      </div>

      <div className="stage">
        <div className={'panel pool-col' + (pane === 'pool' ? ' is-active' : '')}>
          <div className="panel-head">
            <h2 className="eyebrow">
              {available.length + ' available'}
            </h2>
            <span className="hint">
              {board.meta.formatLabel + ' · '}
              {board.meta.adpSourceLabel}
              {assistant && liveAt
                ? ' · read ' + Math.max(0, Math.round((Date.now() - liveAt) / 1000)) + 's ago'
                : ''}
            </span>
          </div>

          {/* Nothing is simulated here, so the ADP is only a lens on a real
              room and can be changed without making any pick incoherent. A mock
              draft would be running on it, so there it stays in settings. */}
          {assistant && (
            <AdpSourcePicker
              compact
              value={adpSource}
              offered={board.meta.adpOffered}
              onChange={onAdpSource}
            />
          )}

          {assistant && offBoard.length > 0 && (
            <p className="hint" style={{ padding: '6px 12px', color: 'var(--te)' }}>
              {offBoard.length + ' real pick' + (offBoard.length === 1 ? ' is' : 's are')
                + ' of players this board does not hold, so those slots read as open.'}
            </p>
          )}
          <PlayerPool
            players={available}
            myRank={myRank}
            notes={notes}
            currentPick={pick}
            myNextPick={oddsTarget}
            teams={teams}
            onDraft={draft}
            canDraft={canPick}
            queue={queue}
            onQueue={toggleQueue}
            formatLabel={board.meta.formatLabel}
            replacement={replacement}
            roomOdds={room?.survival ?? null}
            recommended={recommended}
          />
        </div>

        <div className={'panel board-col' + (pane === 'board' ? ' is-active' : '')}>
          <div className="panel-head">
            <h2 className="eyebrow">The board</h2>
            <span className="hint">
              {state.picks.length + ' of ' + state.order.length + ' picks made'}
            </span>
          </div>
          <DraftBoard engine={engine} currentPick={pick} anonymous={anonymous} />
        </div>

        <div className={'panel roster-col' + (pane === 'roster' ? ' is-active' : '')}>
          <ValuePanel
            rows={priced}
            teams={teams}
            myNextPick={oddsTarget}
            room={room}
          />
          <RosterPanel
            players={myPlayers}
            roster={state.league.roster}
            title="Your team"
            keptIds={keptIds}
          />
        </div>
      </div>
    </>
  );
}
