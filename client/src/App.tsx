import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  fetchBoard, fetchBridge, fetchDraftPicks, fetchLeague, fetchLeagueSetup, fetchRoomState,
  fetchSeason, matchNotes, matchRankings,
} from './api';
import { maskLeague } from './anon';
import { keeperPicksIn } from './engine/order';
import { livePresets, mergePresets, offBoardPlayer } from './engine/live';
import DraftScreen from './components/DraftScreen';
import ResultsScreen from './components/ResultsScreen';
import SeasonScreen from './components/SeasonScreen';
import SetupScreen from './components/SetupScreen';
import { createDraft, runToUserTurn } from './engine/draft';
import type { DraftEngine } from './engine/draft';
import { YAHOO_MOCK_ROSTER, rosterSize } from './engine/roster';
import type {
  AppMode, Board, BridgeStatus, CpuConfig, DeclaredKeeper, LeagueConfig, LeagueImport, LeagueSetup,
  NoteSet, Overrides, PendingKeeper, Platform, PresetPick, RankingSet, SavedLeague, SeasonRead,
  SortKey,
} from './engine/types';
import type { RankingSource, Theme } from './storage';
import { load, save } from './storage';

/**
 * `season` is a fourth screen rather than a third mode, decided with the
 * repository owner rather than assumed. The mode badge says how a *draft* runs,
 * mock against assistant, and a league in season is not a draft, so the draft
 * flow is untouched and this sits beside it.
 */
type Screen = 'setup' | 'draft' | 'results' | 'season';

/** How often a Yahoo mock named before its room exists is asked about. */
const ROOM_WAIT_MS = 5000;

/**
 * How long a bridge that was posting may go quiet before the app says so.
 *
 * The bridge posts every three seconds while a draft room is open, and this asks
 * every five. Fifteen is a gap no dropped beat reaches and no working bridge
 * produces, which is what a warning about silence has to clear to be worth
 * showing at all.
 */
const BRIDGE_QUIET_MS = 15000;

/** One button, three states, so the machine stays an option after an override. */
const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = {
  system: 'Theme: auto', light: 'Theme: light', dark: 'Theme: dark',
};
const THEME_TITLE: Record<Theme, string> = {
  system: 'Following your system setting. Click to force light.',
  light: 'Light. Click to force dark.',
  dark: 'Dark. Click to follow your system setting again.',
};

/**
 * How long a bridge has gone without posting, or null while it is still talking.
 *
 * Null for a bridge nothing has ever heard from too. That is not silence, it is
 * a draft room that has not been opened yet, and the banners keep the two apart.
 */
function quiet(bridge: BridgeStatus | null): string | null {
  if (!bridge?.heardAt) return null;
  const seconds = Math.round((Date.now() - bridge.heardAt) / 1000);
  if (seconds * 1000 <= BRIDGE_QUIET_MS) return null;
  if (seconds < 90) return seconds + ' seconds ago';
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'a minute ago' : minutes + ' minutes ago';
}

export default function App() {
  const saved = useRef(load()).current;

  const [league, setLeague] = useState<LeagueConfig>(saved.league);
  const [cpu, setCpu] = useState<CpuConfig>(saved.cpu);
  const [preset, setPreset] = useState(saved.cpuPreset);
  const [pace, setPace] = useState(saved.pace);

  const [poolSort, setPoolSort] = useState<SortKey>(saved.poolSort);

  const [mode, setMode] = useState<AppMode>(saved.mode);
  const [anonymous, setAnonymous] = useState(saved.anonymous);
  const [theme, setTheme] = useState<Theme>(saved.theme);

  const [rankings, setRankings] = useState<RankingSet | null>(saved.rankings);
  const [rankingSource, setRankingSource] = useState<RankingSource | null>(saved.rankingSource);
  const [noteSource, setNoteSource] = useState<RankingSource | null>(saved.noteSource);
  const [noteSet, setNoteSet] = useState<NoteSet | null>(null);
  const [notesBusy, setNotesBusy] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>(saved.overrides);
  const [rankingsBusy, setRankingsBusy] = useState(false);

  const [savedLeagues, setSavedLeagues] = useState<SavedLeague[]>(saved.savedLeagues);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(saved.activeLeagueId);
  const [myManager, setMyManager] = useState<string | null>(saved.myManager);

  /*
   * RESUMING A MOCK FROM THE REAL DRAFT
   *
   * Once a draft is under way, the useful question stops being "how might this
   * whole draft go" and becomes "how might the next three rounds go, from here".
   * This reads what the room has actually taken and simulates only the rest.
   */
  const [resumeLive, setResumeLive] = useState(saved.resumeLive);
  const [yahooMock, setYahooMock] = useState(saved.yahooMock);
  /*
   * WRITING THE QUEUE BACK INTO THE DRAFT ROOM
   *
   * The one thing this app changes outside the browser, and so the one thing it
   * waits to be asked for. Off, the bridge reads a Yahoo room and writes
   * nothing to it; on, the players starred here are set as the queue Yahoo
   * picks from when a clock expires. See `DECISIONS.md`.
   */
  const [queueWrite, setQueueWrite] = useState(saved.queueWrite);
  const [queuePriority, setQueuePriority] = useState(saved.queuePriority);
  /**
   * A Yahoo mock named from the lobby, before its draft room exists.
   *
   * The lobby hands out the league number two or three minutes before the room
   * tab opens, and nothing about a Yahoo league can be read until the bridge in
   * that tab posts. So the number is held here and the room asked about on a
   * beat, rather than refused once and forgotten, which is the only thing "the
   * board is up when the room is" can mean when the number arrives first.
   */
  const [waitingRoom, setWaitingRoom] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState<{ picks: number; at: number } | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /*
   * The league you had loaded comes back with the page.
   *
   * This used to start empty on every reload while the league it describes was
   * saved and restored around it. The keepers you entered were still there and
   * the panel that shows them was not, because that panel only appears for a
   * keeper league and only this told it that it was one. Refreshing the page
   * looked exactly like losing the lot.
   */
  const [importedLeague, setImportedLeague] = useState<LeagueImport | null>(
    () => saved.savedLeagues.find((l) => l.id === saved.activeLeagueId)?.settings ?? null,
  );
  const [leagueBusy, setLeagueBusy] = useState(false);
  const [leagueError, setLeagueError] = useState<string | null>(null);

  const [setup, setSetup] = useState<LeagueSetup | null>(null);
  const [keeperImportBusy, setKeeperImportBusy] = useState(false);
  const [keeperImportNote, setKeeperImportNote] = useState<string | null>(null);

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  /**
   * Which press of Refresh ADP has already been spent on a board.
   *
   * The token only ever counts up, so testing it against zero made every later
   * fetch of the session a forced one: press Refresh once at setup and a board
   * re-asked for mid-draft would go back out to all three upstream feeds and
   * throw away the cache it should have been reading. A press is one forced
   * fetch, and this is what says which press that was.
   */
  const spentRefresh = useRef(0);

  const [engine, setEngine] = useState<DraftEngine | null>(null);
  const [screen, setScreen] = useState<Screen>('setup');

  /*
   * The league in season, read only when the screen asking for it is open.
   *
   * Nothing in season is on a clock, so this is never polled: it changes when
   * the user runs the bookmarklet, and pressing Read again is how they say so.
   *
   * THE LEAGUE IT IS FOR IS HELD WITH IT, in one piece of state rather than
   * two. Kept apart, a league switched on the setup screen left the last
   * league's rosters on screen until a fetch returned -- and left them there
   * for good if it failed, since a failure sets the error and does not clear
   * the reading.
   */
  const [season, setSeason] = useState<{ leagueId: string; read: SeasonRead } | null>(null);
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [seasonError, setSeasonError] = useState<string | null>(null);
  /**
   * Whether the service has forgotten a league it had read.
   *
   * Snapshots live in the service's memory alone, so a restart loses them, and
   * the service cannot tell "never read" from "read and then forgotten" --
   * memory is memory. The app can, because it was holding the reading. Worth
   * saying: "nothing has been read yet" about a league read five minutes ago
   * reads as the app having lost it rather than as a bookmarklet to run again.
   */
  const [seasonForgotten, setSeasonForgotten] = useState(false);
  /** The last league a read actually succeeded for, which is the evidence above. */
  const seasonEverRead = useRef<string | null>(null);
  /**
   * Which read is the current one.
   *
   * Two can be in flight after a switch and the slower must not win. Counted
   * rather than compared against the league, because the callback closes over
   * the league it was made for and cannot see a later one.
   */
  const seasonAsked = useRef(0);

  // A different scoring format is a different board, and a different board can
  // match a different set of names. Run the file again rather than leave a
  // stale list of misses on screen.
  const lastMatched = useRef('');
  const lastNoted = useRef('');

  useEffect(() => {
    save({
      league, cpu, rankings, rankingSource, noteSource, overrides, savedLeagues, activeLeagueId,
      cpuPreset: preset, pace, mode, anonymous, theme, myManager, resumeLive, yahooMock,
      poolSort, queueWrite, queuePriority,
    });
  }, [league, cpu, rankings, rankingSource, noteSource, overrides, savedLeagues, activeLeagueId,
    preset, pace, mode, anonymous, theme, myManager, resumeLive, yahooMock, poolSort,
    queueWrite, queuePriority]);

  /*
   * The resolved theme goes on <html> rather than into the tree, because what
   * it has to reach is the body's felt and the scrollbars the browser draws,
   * neither of which React renders.
   *
   * Following the machine means listening to it, not reading it once: a desk
   * that turns dark at sunset should take the app with it mid draft. An
   * explicit choice opts out of that until it is set back to auto.
   *
   * Before paint rather than after it, so the first frame is already the right
   * colour instead of a flash of the wrong one.
   */
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme !== 'system') {
      root.dataset.theme = theme;
      return undefined;
    }
    const machine = window.matchMedia('(prefers-color-scheme: light)');
    const follow = () => { root.dataset.theme = machine.matches ? 'light' : 'dark'; };
    follow();
    machine.addEventListener('change', follow);
    return () => machine.removeEventListener('change', follow);
  }, [theme]);

  const activeLeague = savedLeagues.find((l) => l.id === activeLeagueId) || null;
  /** A league saved before there was a choice of platform is a Sleeper league. */
  const activePlatform: Platform = activeLeague?.platform ?? 'sleeper';
  const keepers = activeLeague?.keepers ?? [];
  const pendingKeepers = activeLeague?.pendingKeepers ?? [];
  const liveDraftId = importedLeague?.draftId ?? null;
  // Only a draft that has opened has picks to resume from.
  const liveStarted = !!setup?.draft?.started;

  const leagueLabel = useMemo(() => {
    if (!activeLeague) return 'your league';
    return maskLeague(activeLeague.name, savedLeagues.indexOf(activeLeague), anonymous);
  }, [activeLeague, savedLeagues, anonymous]);

  /** Change one field on the league that is loaded. */
  const patchLeague = useCallback((id: string, patch: Partial<SavedLeague>) => {
    setSavedLeagues((list) => list.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  // The board depends only on the four things that change it. Changing your
  // draft slot or the roster shape must not throw the pool away.
  //
  // The room is named whatever the platform, rather than only for the one that
  // publishes an ADP. Which platforms do is the service's business, and asking
  // is how the board comes back saying whether `room` was on offer at all.
  const boardRoom = liveDraftId ? activePlatform + ':' + liveDraftId : undefined;

  /**
   * Whether the room being followed can price a board yet.
   *
   * A board answers with the feeds it *could* have used, and that answer is
   * true of the moment it was built and of no other. A room arrives on its own
   * schedule and on both sides of that moment: the bridge is installed after
   * the app is open, a service restarted mid-draft is sent the pool again, a
   * page is reloaded between rounds. None of those move anything the board is
   * keyed on, so without this the room feed is offered once or never, and a
   * live Yahoo draft runs behind a control greyed out for saying there is none.
   *
   * Asked on a beat rather than once, because it goes both ways, and dropped at
   * the first refusal: a platform read from its own feed keeps no room and says
   * so with a refusal rather than a false, and there is nothing to ask it again.
   */
  const [roomPrices, setRoomPrices] = useState(false);

  /**
   * Which userscript is feeding the room, and whether it is the one this build
   * expects.
   *
   * Asked from here rather than from the draft screen because a stale bridge is
   * a condition of the whole app rather than of one screen, and because the
   * answer is worth most before a draft opens, while there is still time to
   * reinstall. It rides on the room state the app already reads.
   */
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);

  /**
   * How long the bridge has been silent, as of the last time it was asked.
   *
   * A bridge that was posting and has stopped, which the reading above cannot
   * say: it names the copy that is installed, and 2026-09-07 needed a second
   * lesson to show that this is a different question. The gate that allows user
   * scripts at all went back off mid-session, so the copy named in the masthead
   * was current, correct, and an hour stale, and the app went on saying picks
   * would mirror while nothing was being injected into the room at all.
   *
   * Worded where the reading is taken rather than at render, because the clock
   * is what is being consulted here and a render is not an event. It ages on
   * the poll below, which is the same beat that notices the silence starting.
   */
  const [silence, setSilence] = useState<string | null>(null);

  /**
   * Where the stale-bridge banner sends you to reinstall.
   *
   * Kept rather than written into the banner because `PORT` is a setting and
   * this half cannot see it: the client meets the service as a proxied `/api`
   * and never learns which port answered. Null only before the first answer,
   * which is also before there is any reading to raise a banner about.
   */
  const [installUrl, setInstallUrl] = useState<string | null>(null);

  /**
   * Asked whenever Yahoo is the platform, on any screen and in either mode.
   *
   * The first version of this asked only while an assistant draft was being
   * followed, which is after the point where the answer is worth anything: what
   * a stale bridge costs is the draft you are about to start, and by then the
   * room is already being mirrored by the wrong copy. It is also why the service
   * keeps the last bridge it heard from rather than one per room — the question
   * is about the install, not about a league. See `server/src/bridge.js`.
   */
  const watchBridge = activePlatform === 'yahoo';

  useEffect(() => {
    if (!watchBridge) return undefined;
    let alive = true;
    const ask = async () => {
      const report = await fetchBridge().catch(() => null);
      // A refusal says nothing about the bridge, so the last answer stands
      // rather than a dropped request reading as a bridge that went away.
      if (!alive || !report) return;
      setBridge(report.running);
      setSilence(quiet(report.running));
      setInstallUrl(report.installUrl);
    };
    void ask();
    const timer = setInterval(() => { void ask(); }, ROOM_WAIT_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [watchBridge]);

  /** What the masthead and the banner read. Absent where it does not apply. */
  const bridgeSeen = watchBridge ? bridge : null;

  /** The same, and on the same terms: nothing to say where none applies. */
  const bridgeSilence = watchBridge ? silence : null;

  useEffect(() => {
    // Left as it was where there is no room to ask about. What it is worth is
    // decided by the next room's own answer, and a board is re-asked for on the
    // change of name anyway, so clearing it here would buy a render and nothing.
    if (!boardRoom || !liveDraftId) return undefined;
    let alive = true;
    let timer = 0;

    const ask = async () => {
      const room = await fetchRoomState(activePlatform, liveDraftId).catch(() => null);
      // A refusal ends it. A platform read from its own feed keeps no room to
      // report and says so by refusing, which is not an answer that changes.
      if (!alive || !room) return;
      setRoomPrices(room.pricesBoard);
      timer = window.setTimeout(() => { void ask(); }, ROOM_WAIT_MS);
    };

    void ask();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [boardRoom, activePlatform, liveDraftId]);

  useEffect(() => {
    const control = new AbortController();
    const force = refreshToken > spentRefresh.current;
    spentRefresh.current = refreshToken;
    setLoading(true);
    setError(null);
    fetchBoard(
      {
        scoring: league.scoring,
        teams: league.teams,
        adpSource: league.adpSource,
        year: league.year,
        room: boardRoom,
        force,
      },
      control.signal,
    )
      .then((next) => { setBoard(next); setLoading(false); })
      .catch((err) => {
        if (control.signal.aborted) return;
        setError(String(err.message || err));
        setLoading(false);
      });
    return () => control.abort();
    // `roomPrices` is not sent and does not change the request. It is here
    // because it is the one thing that changes the *answer* to the same
    // request, and a board fetched before a room turned up is a board that
    // will not offer it.
  }, [league.scoring, league.teams, league.adpSource, league.year, boardRoom, roomPrices,
    refreshToken]);

  /**
   * Run a ranking file against the board with the current overrides applied.
   *
   * Every path that changes either the file or the overrides comes through
   * here, so a mapping takes effect the moment it is saved rather than at the
   * next upload.
   */
  const runMatch = useCallback(async (source: RankingSource, withOverrides: Overrides) => {
    setRankingsBusy(true);
    try {
      const set = await matchRankings(
        {
          scoring: league.scoring,
          teams: league.teams,
          adpSource: league.adpSource,
          year: league.year,
        },
        source.text,
        source.label,
        withOverrides,
        source.rankColumn,
      );
      setRankings(set);
      setRankingSource(source);
      // A ranking file belongs to the league it was published for. Your leagues
      // are standard, half PPR and PPR, and every site ships one file per
      // format, so a single shared set would mean re-uploading on every switch.
      if (activeLeagueId) patchLeague(activeLeagueId, { rankingSource: source });
    } catch (err) {
      setError('Your rankings could not be matched. ' + String((err as Error).message));
    } finally {
      setRankingsBusy(false);
    }
  }, [league.scoring, league.teams, league.adpSource, league.year, activeLeagueId, patchLeague]);

  const loadRankings = useCallback((text: string, label: string) => {
    // A new file gets a fresh look at its columns. The column you chose for the
    // last file says nothing about this one.
    void runMatch({ text, label, rankColumn: null }, overrides);
  }, [runMatch, overrides]);

  const setRankColumn = useCallback((index: number) => {
    if (!rankingSource) return;
    void runMatch({ ...rankingSource, rankColumn: index }, overrides);
  }, [rankingSource, overrides, runMatch]);

  const setOverride = useCallback((key: string, playerId: string | null) => {
    const next = { ...overrides, [key]: playerId };
    setOverrides(next);
    if (rankingSource) void runMatch(rankingSource, next);
  }, [overrides, rankingSource, runMatch]);

  /**
   * Run a notes file against the board with the current overrides applied.
   *
   * Mirrors `runMatch`, and for the same reason: a name mapping you saved has
   * to reach your notes too, or a player you already taught the app about
   * comes back unmatched here.
   */
  const runNotes = useCallback(async (source: RankingSource, withOverrides: Overrides) => {
    setNotesBusy(true);
    try {
      const set = await matchNotes(
        {
          scoring: league.scoring,
          teams: league.teams,
          adpSource: league.adpSource,
          year: league.year,
        },
        source.text,
        source.label,
        withOverrides,
      );
      setNoteSet(set);
      setNoteSource(source);
    } catch (err) {
      setError('Your notes could not be matched. ' + String((err as Error).message));
    } finally {
      setNotesBusy(false);
    }
  }, [league.scoring, league.teams, league.adpSource, league.year]);

  const loadNotes = useCallback((text: string, label: string) => {
    void runNotes({ text, label, rankColumn: null }, overrides);
  }, [runNotes, overrides]);

  const clearNotes = useCallback(() => {
    setNoteSource(null);
    setNoteSet(null);
  }, []);

  /**
   * Every note that applies to a player, from both places one can come from.
   *
   * The ranking file seeds them and the notes file wins. A ranking export is
   * replaced whenever its publisher updates, and if it won it would silently
   * undo a note you wrote yourself.
   */
  const notes = useMemo(() => {
    const out = new Map<string, string>();
    for (const e of rankings?.entries ?? []) if (e.note) out.set(e.id, e.note);
    for (const n of noteSet?.notes ?? []) out.set(n.id, n.note);
    return out.size ? out : null;
  }, [rankings, noteSet]);

  const forgetOverride = useCallback((key: string) => {
    const next = { ...overrides };
    delete next[key];
    setOverrides(next);
    if (rankingSource) void runMatch(rankingSource, next);
  }, [overrides, rankingSource, runMatch]);

  useEffect(() => {
    if (!rankingSource || !board || rankingsBusy) return;
    const stamp = [league.scoring, league.teams, league.adpSource, league.year].join('|');
    if (lastMatched.current === stamp) return;
    lastMatched.current = stamp;
    void runMatch(rankingSource, overrides);
  }, [board, rankingSource, league.scoring, league.teams, league.adpSource, league.year]);

  // The notes are matched against the same board, so they go stale for the
  // same reasons and are re-run on the same signal.
  useEffect(() => {
    if (!noteSource || !board || notesBusy) return;
    const stamp = [league.scoring, league.teams, league.adpSource, league.year].join('|');
    if (lastNoted.current === stamp) return;
    lastNoted.current = stamp;
    void runNotes(noteSource, overrides);
  }, [board, noteSource, league.scoring, league.teams, league.adpSource, league.year]);

  /** Apply a Sleeper league to the settings, keeping the draft slot you chose. */
  const applyImport = useCallback((imported: LeagueImport) => {
    setImportedLeague(imported);
    setActiveLeagueId(imported.id);
    setSetup(null);
    setKeeperImportNote(null);

    // Swap to this league's own ranking file. The effect below re-matches it
    // against the new board, so a league in a different scoring format arrives
    // with the rankings that were written for that format.
    const stored = savedLeagues.find((l) => l.id === imported.id)?.rankingSource ?? null;
    setRankingSource(stored);
    if (!stored) setRankings(null);
    lastMatched.current = '';

    setLeague((current) => ({
      ...current,
      teams: imported.teams,
      rounds: imported.rounds,
      // A platform that does not publish these leaves what you set alone. Yahoo
      // keeps neither in its draft room, and a roster invented here would look
      // exactly like one that had been read.
      roster: imported.roster ?? current.roster,
      scoring: imported.scoring ?? current.scoring,
      draftType: imported.draftType,
      mySlot: Math.min(current.mySlot, imported.teams),
    }));
  }, [savedLeagues]);

  /**
   * Pull a league from Sleeper and keep what comes back.
   *
   * A league's shape does not move once the season is set, so this runs on the
   * first use of a league and then only when you press Refresh.
   */
  const pullLeague = useCallback(async (platform: Platform, id: string, force = false) => {
    setLeagueBusy(true);
    setLeagueError(null);
    try {
      const imported = await fetchLeague(platform, id, force);
      applyImport(imported);
      void loadSetup(platform, id, force);
      const stamp = Date.now();
      setSavedLeagues((list) => (list.some((l) => l.id === imported.id)
        ? list.map((l) => (l.id === imported.id
          ? { ...l, name: imported.name, platform, settings: imported, fetchedAt: stamp }
          : l))
        : [...list, {
          id: imported.id,
          name: imported.name,
          platform,
          settings: imported,
          fetchedAt: stamp,
          rankingSource: null,
          keepers: [],
          pendingKeepers: [],
          tradedPicks: [],
          myUserId: null,
          slots: [],
        }]));
    } catch (err) {
      setLeagueError(String((err as Error).message));
    } finally {
      setLeagueBusy(false);
    }
  }, [applyImport]);

  /**
   * Read a real league: its seats, their team names, and the keepers declared
   * so far. Also sets the draft slot, once Sleeper has drawn the order.
   *
   * Called on every league load, because all of it moves. Managers rename
   * teams, keepers get declared right up to the deadline, and the draft order
   * appears at some point before the draft.
   */
  const loadSetup = useCallback(async (
    platform: Platform, leagueId: string, force = false,
  ) => {
    setLeagueBusy(true);
    setLeagueError(null);
    try {
      const got = await fetchLeagueSetup(platform, leagueId, {
        scoring: league.scoring,
        teams: league.teams,
        adpSource: league.adpSource,
        year: league.year,
      }, force);
      setSetup(got);

      const names = got.slots.map((s2) => s2.name);
      const trades = got.tradedPicks ?? [];
      patchLeague(leagueId, { slots: got.slots, tradedPicks: trades });
      setLeague((current) => ({
        ...current,
        teamNames: names.length ? names : null,
        // A traded pick changes who is on the clock, so it belongs to the draft
        // the moment the league is read rather than at start.
        tradedPicks: trades.length ? trades : null,
      }));

      /*
       * Your seat follows from who you said you are, once the order exists.
       *
       * A league you have not answered for yet is matched on your Sleeper name
       * instead. You are the same manager in all three of your leagues and the
       * seat is different in each, so the name is what carries across and the
       * seat is what it finds. Say you are somebody else and that answer wins,
       * here and in every league you load after it.
       */
      const mine = savedLeagues.find((l) => l.id === leagueId)?.myUserId;
      let seat = mine ? got.slots.find((s2) => s2.userId === mine) : null;
      if (!seat && myManager) {
        const wanted = myManager.toLowerCase();
        seat = got.slots.find((s2) => s2.manager?.toLowerCase() === wanted) ?? null;
        if (seat?.userId) patchLeague(leagueId, { myUserId: seat.userId });
      }
      if (seat) setLeague((current) => ({ ...current, mySlot: seat!.slot }));
      return got;
    } catch (err) {
      setLeagueError(String((err as Error).message));
      return null;
    } finally {
      setLeagueBusy(false);
    }
  }, [league.scoring, league.teams, league.adpSource, league.year, savedLeagues, patchLeague,
    myManager]);

  /**
   * Turn the keepers a league has declared into settled picks.
   *
   * Sleeper publishes who is kept and by whom, and does not publish what a
   * keeper costs. The round is taken from where the player went last season,
   * which is what most leagues charge, and is left for you to correct. A
   * player nobody drafted here has no suggestion at all and needs a round.
   */
  const importKeepers = useCallback(async () => {
    if (!activeLeagueId) return;
    setKeeperImportBusy(true);
    setKeeperImportNote(null);
    try {
      const got = setup?.leagueId === activeLeagueId
        ? setup
        : await loadSetup(activePlatform, activeLeagueId, true);
      if (!got) return;

      const teams = got.teams || league.teams;
      const onBoard = got.keepers.filter((k: DeclaredKeeper) => k.playerId && k.slot);

      /*
       * A keeper is settled only when a round is known and that round's pick is
       * still free. Everything else that names a real player in a real seat is
       * kept as pending rather than dropped: the import already knows who, and
       * whose, and the only thing missing is the one field Sleeper never
       * publishes. Reporting those in a sentence and throwing them away made
       * you find each player again by hand.
       */
      const settled: PresetPick[] = [];
      const pending: PendingKeeper[] = [];
      const taken = new Set<number>();

      const describe = (k: DeclaredKeeper, reason: PendingKeeper['reason'], tried: number | null) => ({
        playerId: k.playerId!,
        slot: k.slot!,
        name: k.name || 'Unknown player',
        position: k.position || '',
        team: k.team || '',
        reason,
        triedRound: tried,
      });

      const trades = got.tradedPicks ?? [];

      for (const k of onBoard) {
        if (!k.suggestedRound) {
          pending.push(describe(k, 'no-history', null));
          continue;
        }
        // A keeper spends a pick that team actually holds. Trade your fifth
        // away and you cannot charge a keeper to the fifth, and a round you
        // traded into gives you a pick to charge one to.
        const held = keeperPicksIn(
          league.draftType, teams, k.suggestedRound, k.slot! - 1, trades,
        );
        const free = held.find((overall) => !taken.has(overall));
        if (free == null) {
          // Either the seat holds nothing in that round, or every pick it does
          // hold is already spent on an earlier keeper.
          pending.push(describe(k, held.length ? 'round-taken' : 'no-history', k.suggestedRound));
          continue;
        }
        taken.add(free);
        settled.push({ overall: free, playerId: k.playerId!, source: 'keeper' });
      }

      patchLeague(activeLeagueId, { keepers: settled, pendingKeepers: pending });

      const noPlayer = got.keepers.filter((k) => !k.playerId).length;
      const parts = ['Read ' + settled.length + ' of ' + got.keepers.length
        + ' declared keepers. Rounds are taken from last season and are a guess.'];
      if (pending.length) {
        parts.push(pending.length === 1
          ? 'One needs a round from you, below.'
          : pending.length + ' need a round from you, below.');
      }
      if (noPlayer) {
        parts.push(noPlayer + (noPlayer === 1 ? ' is' : ' are') + ' not on this board.');
      }
      setKeeperImportNote(parts.join(' '));
    } catch (err) {
      setKeeperImportNote(String((err as Error).message));
    } finally {
      setKeeperImportBusy(false);
    }
  }, [activeLeagueId, activePlatform, setup, loadSetup, league, patchLeague]);

  /**
   * Settle a pending keeper by saying which round he costs.
   *
   * The seat is already known, so the round is the whole answer: it decides
   * which of that seat's picks the keeper spends. A round whose pick is already
   * spent is refused rather than taken, and the panel says which round to try.
   */
  const setKeeperRound = useCallback((playerId: string, round: number) => {
    if (!activeLeagueId || !activeLeague) return;
    const waiting = activeLeague.pendingKeepers.find((k) => k.playerId === playerId);
    if (!waiting) return;

    const held = keeperPicksIn(
      league.draftType, league.teams, round, waiting.slot - 1, league.tradedPicks,
    );
    const overall = held.find((at) => !activeLeague.keepers.some((k) => k.overall === at));
    if (overall == null) return;

    patchLeague(activeLeagueId, {
      keepers: [...activeLeague.keepers, { overall, playerId, source: 'keeper' }],
      pendingKeepers: activeLeague.pendingKeepers.filter((k) => k.playerId !== playerId),
    });
  }, [activeLeagueId, activeLeague, league.draftType, league.teams, league.tradedPicks,
    patchLeague]);

  /** Leave a pending keeper out. He goes back into the pool for the room. */
  const dropPendingKeeper = useCallback((playerId: string) => {
    if (!activeLeagueId || !activeLeague) return;
    patchLeague(activeLeagueId, {
      pendingKeepers: activeLeague.pendingKeepers.filter((k) => k.playerId !== playerId),
    });
  }, [activeLeagueId, activeLeague, patchLeague]);

  /** Load a saved league from what is already kept, pulling only if it is new. */
  const loadSavedLeague = useCallback((id: string) => {
    const existing = savedLeagues.find((l) => l.id === id);
    const platform: Platform = existing?.platform ?? 'sleeper';
    if (existing?.settings) {
      setLeagueError(null);
      applyImport(existing.settings);
    } else {
      void pullLeague(platform, id);
    }
    // Team names, keepers and the draft order all move, so they are read every
    // time even though the league's own shape is cached.
    void loadSetup(platform, id);
  }, [savedLeagues, applyImport, pullLeague, loadSetup]);

  /**
   * Begin a mock, optionally from where the real draft has got to.
   *
   * Resuming reads the picks that have actually been made and hands them to the
   * engine as settled, then simulates only what is left. It is the same claim a
   * keeper makes, so the two go in together and the real pick wins where they
   * disagree: a keeper entry is what was expected, and a pick is what happened.
   */
  const startMock = useCallback(async () => {
    if (!board) return;

    let presets = keepers;
    let players = board.players;

    if (resumeLive && liveDraftId) {
      setStartError(null);
      setStarting(true);
      try {
        const live = await fetchDraftPicks(activePlatform, liveDraftId, {
          scoring: league.scoring,
          teams: league.teams,
          adpSource: league.adpSource,
          year: league.year,
        });
        presets = mergePresets(keepers, livePresets(live.picks));
        // A player the real draft took who this board does not rank still owns
        // his slot, or every pick after him sits one column out of place.
        players = [...board.players, ...live.picks.filter((p) => p.offBoard).map(offBoardPlayer)];
        setLiveCount({ picks: live.picks.length, at: Date.now() });
      } catch (err) {
        setStartError('The live draft could not be read. ' + String((err as Error).message));
        setStarting(false);
        return;
      } finally {
        setStarting(false);
      }
    }

    setEngine(runToUserTurn(
      createDraft(league, cpu, players, rankings?.entries ?? null, presets),
    ));
    setScreen('draft');
  }, [board, league, cpu, rankings, keepers, resumeLive, liveDraftId, activePlatform]);

  /** Ask how far the real draft has got, without starting anything. */
  const checkLive = useCallback(async () => {
    if (!liveDraftId) return;
    setLiveBusy(true);
    setStartError(null);
    try {
      const live = await fetchDraftPicks(activePlatform, liveDraftId, {
        scoring: league.scoring,
        teams: league.teams,
        adpSource: league.adpSource,
        year: league.year,
      });
      setLiveCount({ picks: live.picks.length, at: Date.now() });
    } catch (err) {
      setStartError('The live draft could not be read. ' + String((err as Error).message));
    } finally {
      setLiveBusy(false);
    }
  }, [liveDraftId, activePlatform, league.scoring, league.teams, league.adpSource, league.year]);

  /**
   * Read the league in season, joined to the feeds behind it.
   *
   * A refusal is an error to show; "nothing read yet" is not, and comes back as
   * an ordinary answer with `read: false`, which the screen turns into the
   * bookmarklet instructions rather than a fault.
   */
  const loadSeason = useCallback(async () => {
    const asked = activeLeagueId;
    if (!asked) return;
    const ticket = seasonAsked.current + 1;
    seasonAsked.current = ticket;

    // A different league is a different league. What is held goes now rather
    // than when the answer arrives, so nothing of the last one is ever on
    // screen under this one's name. The same league is left alone, so pressing
    // Read again does not blink through the empty state.
    setSeason((held) => (held && held.leagueId === asked ? held : null));
    setSeasonBusy(true);
    setSeasonError(null);
    try {
      const got = await fetchSeason(activePlatform, asked, {
        scoring: league.scoring,
        teams: league.teams,
        adpSource: league.adpSource,
        year: league.year,
      });
      if (ticket !== seasonAsked.current) return;

      /*
       * The answer has to be about the league that was asked for.
       *
       * `putSnapshot` already refuses a snapshot filed under the wrong league,
       * so this should be unreachable -- which is the reason to check it rather
       * than not to. Showing one league's rosters under another's name is the
       * failure Phase 8's exit criteria single out, and it would be invisible.
       */
      const answered = got.snapshot?.leagueId;
      if (answered && answered !== asked) {
        setSeason(null);
        setSeasonError('The service answered about league ' + answered + ', not '
          + asked + '. Nothing is shown rather than the wrong league.');
        return;
      }

      // A league that was read and now is not is a service that has forgotten
      // it, which a restart does. Held in a ref because the answer has to be
      // compared with what came before it, and a callback closes over a state
      // value as it was when the callback was made.
      if (got.read) seasonEverRead.current = asked;
      setSeasonForgotten(!got.read && seasonEverRead.current === asked);
      setSeason({ leagueId: asked, read: got });
    } catch (err) {
      if (ticket !== seasonAsked.current) return;
      setSeasonError('Your league could not be read. ' + String((err as Error).message));
    } finally {
      if (ticket === seasonAsked.current) setSeasonBusy(false);
    }
  }, [activeLeagueId, activePlatform, league.scoring, league.teams, league.adpSource, league.year]);

  // How far along the draft is goes stale by the minute once it opens, so it is
  // read when you ask for it and whenever the league changes under it.
  useEffect(() => {
    setLiveCount(null);
    if (mode === 'mock' && resumeLive && liveDraftId && liveStarted) void checkLive();
  }, [mode, resumeLive, liveDraftId, liveStarted]);

  const start = useCallback(() => {
    if (!board) return;
    if (mode === 'assistant') {
      // Nothing is simulated here. The board fills from Sleeper and waits.
      setEngine(createDraft(league, cpu, board.players, rankings?.entries ?? null, []));
      setScreen('draft');
      return;
    }
    void startMock();
  }, [board, league, cpu, rankings, mode, startMock]);

  /**
   * Ticking the mock box fills in the two things Yahoo will not.
   *
   * Its draft room carries the seats, the order and every pick, and no roster
   * shape at all, so a mock imported from it otherwise keeps whatever was last
   * set for a real league. Every Yahoo mock runs the same nine starters, so the
   * one thing the import cannot answer is the one thing the tick can.
   */
  const applyYahooMock = useCallback((on: boolean) => {
    setYahooMock(on);
    // The tick is also the off switch for the wait below. It is what armed it,
    // so it is what stops it; nothing else does.
    if (!on) {
      setWaitingRoom(null);
      return;
    }
    setLeague((current) => ({
      ...current,
      roster: { ...YAHOO_MOCK_ROSTER },
      rounds: rosterSize(YAHOO_MOCK_ROSTER),
    }));
  }, []);

  /**
   * Add a league, or hold on to one that cannot be read yet.
   *
   * A ticked mock box means the number was copied out of the lobby, so the room
   * it names may still be minutes from existing. Holding it and asking is what
   * the tick is for. Every other league is read now or not at all, because
   * every other league is one the service can already answer for.
   *
   * Only the assistant holds. A Yahoo mock is a public room of real people and
   * the assistant is what follows one, so waiting for a room is waiting for
   * something this app's own mock draft will never open. There the tick means
   * only the roster shape, and an ID is read now or refused now.
   */
  const addLeague = useCallback((platform: Platform, id: string) => {
    if (platform === 'yahoo' && yahooMock && mode === 'assistant') {
      setLeagueError(null);
      setWaitingRoom(id);
      return;
    }
    void pullLeague(platform, id);
  }, [yahooMock, mode, pullLeague]);

  /**
   * Ask a held Yahoo mock whether its room is there yet, and read it when it is.
   *
   * The two things it waits for are the two the route's own answer explains: a
   * seat means the bridge is posting, and the order means it has finished
   * introducing itself, so an import reads Yahoo's seat and round counts rather
   * than the defaults it falls back on. A service that has stopped answering
   * altogether is nothing to report while waiting; the next beat asks again.
   */
  useEffect(() => {
    if (!waitingRoom || !yahooMock || screen !== 'setup') return undefined;
    // Switching to the mock draft mid-wait stops it rather than ends it. What
    // is being waited for is a room only the assistant opens, and switching
    // back is the one action that says you still want it.
    if (mode !== 'assistant') return undefined;
    let alive = true;

    const ask = async () => {
      const room = await fetchRoomState('yahoo', waitingRoom).catch(() => null);
      if (!alive || !room?.orderIsSet || !room.mySeat) return;
      setWaitingRoom(null);
      void pullLeague('yahoo', waitingRoom);
    };

    void ask();
    const timer = setInterval(() => { void ask(); }, ROOM_WAIT_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [waitingRoom, yahooMock, mode, screen, pullLeague]);

  /**
   * Open the board the moment a Yahoo mock's room can be read.
   *
   * A mock is worth joining on a whim, and the two clicks between joining one
   * and watching it are the ones that make it not worth bothering.
   *
   * What starts it is the setup read for this league carrying a seat, not the
   * league ID being set. The ID comes back with the page from the last session
   * and so says nothing about any room; the seat is written only by a post from
   * the bridge, so it says a room is being watched now, and it says which one
   * is yours, which is the whole reason this can start without asking anything.
   *
   * The seat is applied on one pass and the draft started on the next. A draft
   * is built from the league in hand, so setting the seat and starting in the
   * same breath would build it from the seat that was there before.
   *
   * Once per room, and never over a draft already on screen.
   */
  const followedRoom = useRef<string | null>(null);
  useEffect(() => {
    if (!yahooMock || mode !== 'assistant' || screen !== 'setup') return;
    if (activePlatform !== 'yahoo' || !board || !liveDraftId) return;
    if (followedRoom.current === liveDraftId) return;
    if (setup?.leagueId !== liveDraftId) return;

    const seat = setup.draft?.mySeat;
    if (!seat) return;
    if (league.mySlot !== seat) {
      setLeague((current) => ({ ...current, mySlot: seat }));
      return;
    }

    followedRoom.current = liveDraftId;
    start();
  }, [yahooMock, mode, screen, activePlatform, board, liveDraftId, setup, league.mySlot, start]);

  // A new seed, drawn once and used for both the saved settings and the draft
  // that runs off them. Two draws here would mean the settings no longer
  // describe the draft on screen.
  const restart = useCallback(() => {
    if (!board) return;
    const seed = Math.floor(Math.random() * 1e9);
    const next = { ...league, seed };
    setLeague(next);
    setEngine(runToUserTurn(
      createDraft(next, cpu, board.players, rankings?.entries ?? null, keepers),
    ));
    setScreen('draft');
  }, [board, league, cpu, rankings, keepers]);

  return (
    <div className="shell">
      <header className="masthead">
        <span className="wordmark">
          Draft
          <span>·</span>
          Room
        </span>
        <span className={'mode-badge' + (mode === 'assistant' ? ' is-live' : '')}>
          {mode === 'assistant' ? 'Draft assistant' : 'Mock'}
        </span>

        {/*
          * The way in to the league in season.
          *
          * On the setup screen only, and only for the platform that can be read
          * in season. A draft under way is exactly when a navigation button is
          * a hazard rather than a convenience, and leaving mid-draft is not a
          * click anyone should make by accident.
          */}
        {screen === 'setup' && activePlatform === 'yahoo' && activeLeagueId && (
          <button
            type="button"
            className="chip"
            title="Your Yahoo league as it stands: every roster, the slots and the scoring."
            onClick={() => { setScreen('season'); void loadSeason(); }}
          >
            My league in season
          </button>
        )}

        {/*
          * The bridge's own account of itself, shown whenever one is talking.
          *
          * Not only on a mismatch: a version on screen while things work is how
          * the next stale copy is spotted in seconds rather than in a session,
          * which is the whole lesson of 2026-09-07.
          */}
        {bridgeSeen && (
          <span
            className="hint"
            style={bridgeSeen.stale || bridgeSilence ? { color: 'var(--te)' } : undefined}
          >
            {/*
              * "unknown" was the first wording and it said nothing worth
              * reading. A copy too old to name itself is not an unknown
              * version: it is a known state with a name, and saying which is
              * the difference between a readout and a shrug.
              */}
            {bridgeSeen.tooOld
              ? 'bridge too old to say'
              : `bridge ${bridgeSeen.version ?? 'unversioned'}${
                bridgeSeen.fromSource ? ' · from source'
                  : bridgeSeen.build ? ` · ${bridgeSeen.build}` : ''}`}
            {/*
              * Said here as well as in the banner because the banner is kept
              * off the draft screen and this is not: a draft under way is
              * exactly when a bridge going quiet costs something.
              */}
            {bridgeSilence ? ` · silent, last heard ${bridgeSilence}` : ''}
          </span>
        )}

        {board && (
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {board.meta.year}
            {' · '}
            {board.meta.formatLabel}
            {' · '}
            {board.meta.poolSize}
            {' players'}
          </span>
        )}
        {/*
          * Who the numbers on screen came from.
          *
          * ESPN is named only when it is voting. It contributes to the
          * consensus board and to no other, so crediting it on all of them
          * would claim a source the board in front of you did not use.
          */}
        <span className="hint attribution">
          ADP from Sleeper and
          {' '}
          <a href="https://fantasyfootballcalculator.com" target="_blank" rel="noreferrer" style={{ color: 'var(--chalk-2)' }}>
            Fantasy Football Calculator
          </a>
          {board?.meta.adpFeeds?.includes('espn') && (
            <>
              {', with draft ranks from '}
              <a href="https://fantasy.espn.com" target="_blank" rel="noreferrer" style={{ color: 'var(--chalk-2)' }}>
                ESPN
              </a>
            </>
          )}
          . Projections from Rotowire via Sleeper.
        </span>

        <button
          type="button"
          className="theme-toggle"
          title={THEME_TITLE[theme]}
          onClick={() => setTheme(THEME_NEXT[theme])}
        >
          {THEME_LABEL[theme]}
        </button>

        {/*
          * One click before you record anything. League names, league IDs and
          * every manager's Sleeper name are replaced on screen. Nothing stored
          * changes, so it turns off again with nothing lost.
          */}
        <button
          type="button"
          className="anon-toggle"
          aria-pressed={anonymous}
          title={anonymous
            ? 'Real league and manager names are hidden. Click to show them.'
            : 'Hide league names, league IDs and manager names, for sharing.'}
          onClick={() => setAnonymous((v) => !v)}
        >
          {anonymous ? 'Names hidden' : 'Hide names'}
        </button>
      </header>

      {/*
        * Four states, said where each is worth reading.
        *
        * A bridge that is behind still mirrors picks, which is what makes it
        * dangerous: the board looks right while the half that writes your queue
        * is missing. On 2026-09-07 a copy three versions old ran a whole
        * session that way with its manager reporting it as current, and the
        * silence when nothing was injected at all read as the app being broken
        * rather than as nothing having spoken to it.
        *
        * So the warning shows on every screen, and the reassurance shows on
        * setup only. A permanent row over the draft screen would be taking
        * space from the pool to say nothing is wrong.
        */}
      {/*
        * Nothing is arriving, which reads as everything working.
        *
        * This is the one the second half of 2026-09-07 went to. The install was
        * current, the masthead said so, and the browser had quietly taken the
        * permission to inject it back off, so the board sat with its seats
        * numbered and no picks on it while the app reassured. Said before the
        * staleness below rather than after it, and instead of it: a bridge that
        * is not running is not mirroring picks either, and the version it would
        * have been running is the smaller of the two complaints.
        */}
      {bridgeSilence && (
        <div className="banner is-bad" role="status" style={{ margin: '10px 18px 0' }}>
          <span>
            <b>The Yahoo bridge has stopped posting.</b>
            {` It was last heard ${bridgeSilence}, so nothing is mirroring picks`}
            {' onto this board now, and any seat it has not named is numbered'}
            {' rather than empty.'}
            {' If your draft room tab is closed, that is all this is.'}
            {' If it is open, nothing is being injected into it: check that the'}
            {' browser still allows user scripts for your userscript manager, on'}
            {' that extension\'s own details page rather than the global'}
            {' developer-mode switch. That gate can go back off on its own, and'}
            {' nothing else reports it: the manager still lists the script and'}
            {' still holds the right copy. A draft room console logging no'}
            {' bridge version is the check.'}
            {' Re-open the room from the lobby rather than reloading the tab:'}
            {' Yahoo\'s auth token is single use, and a reload leaves the draft.'}
          </span>
        </div>
      )}

      {bridgeSeen?.stale && !bridgeSilence && (
        <div className="banner is-bad" role="status" style={{ margin: '10px 18px 0' }}>
          <span>
            <b>The Yahoo bridge in your browser is out of date.</b>
            {' '}
            {bridgeSeen.tooOld
              ? 'It is too old to say which build it is'
              : `It is build ${bridgeSeen.build}`}
            {bridgeSeen.version ? ` (version ${bridgeSeen.version})` : ''}
            {`, and this app expects ${bridgeSeen.current.version} (build ${bridgeSeen.current.build}).`}
            {' Picks will still mirror, but your queue will not be written.'}
            {' Reinstall from '}
            <a
              href={installUrl ?? undefined}
              style={{ color: 'var(--chalk-2)' }}
            >
              the service
            </a>
            {', then re-open the draft room from the lobby rather than'}
            {' reloading the tab: Yahoo\'s auth token is single use, and a reload'}
            {' leaves the draft. The room\'s console should name the build above.'}
          </span>
        </div>
      )}

      {screen === 'setup' && watchBridge && bridgeSeen && !bridgeSeen.stale && !bridgeSilence && (
        <div className="banner is-good" role="status" style={{ margin: '10px 18px 0' }}>
          <span>
            <b>The Yahoo bridge is current.</b>
            {` Version ${bridgeSeen.version ?? 'unversioned'}`}
            {bridgeSeen.fromSource
              ? ', run from the repository rather than installed.'
              : `, build ${bridgeSeen.build}.`}
            {' Picks will mirror and your queue can be written.'}
          </span>
        </div>
      )}

      {/*
        * Nothing has spoken. Not an error — a draft room that has not been
        * opened yet looks exactly like this — but saying so is the difference
        * between "no bridge is talking to me" and "this app is broken", which
        * is a distinction a whole evening turned on.
        */}
      {screen === 'setup' && watchBridge && !bridgeSeen && (
        <div className="banner" role="status" style={{ margin: '10px 18px 0' }}>
          <span>
            <b>No Yahoo bridge has reported yet.</b>
            {' Open your draft room with the userscript installed and this will'}
            {' name the version it is running. If it stays empty once a room is'}
            {' open, nothing is being injected: check that the browser allows'}
            {' user scripts for your userscript manager.'}
          </span>
        </div>
      )}

      {screen === 'setup' && (
        <SetupScreen
          league={league}
          cpu={cpu}
          preset={preset}
          pace={pace}
          board={board}
          loading={loading}
          error={error}
          rankings={rankings}
          overrides={overrides}
          rankingsBusy={rankingsBusy}
          noteSet={noteSet}
          notesBusy={notesBusy}
          onNotes={loadNotes}
          onClearNotes={clearNotes}
          savedLeagues={savedLeagues}
          activeLeagueId={activeLeagueId}
          importedLeague={importedLeague}
          leagueBusy={leagueBusy}
          leagueError={leagueError}
          onLeague={(next) => {
            // A hand edit means the settings no longer describe the league that
            // was loaded, so the loaded badge comes off.
            const shapeChanged = next.teams !== league.teams
              || next.scoring !== league.scoring
              || next.draftType !== league.draftType
              || rosterSize(next.roster) !== rosterSize(league.roster);
            if (shapeChanged) { setActiveLeagueId(null); setImportedLeague(null); }
            setLeague(next);
          }}
          onCpu={(next, id) => { setCpu(next); setPreset(id); }}
          onPace={setPace}
          poolSort={poolSort}
          onPoolSort={setPoolSort}
          onRankings={loadRankings}
          onOverride={setOverride}
          onForgetOverride={forgetOverride}
          onRankColumn={setRankColumn}
          onClearRankings={() => {
            setRankings(null);
            setRankingSource(null);
            lastMatched.current = '';
            setCpu((c) => ({ ...c, cpuUsesMyRankings: false }));
          }}
          onLoadLeague={loadSavedLeague}
          onAddLeague={addLeague}
          onRefreshLeague={(id) => {
            const at = savedLeagues.find((l) => l.id === id)?.platform ?? 'sleeper';
            void pullLeague(at, id, true);
          }}
          onRemoveLeague={(id) => {
            setSavedLeagues((list) => list.filter((l) => l.id !== id));
            if (activeLeagueId === id) { setActiveLeagueId(null); setImportedLeague(null); }
          }}
          onStart={start}
          onRefreshBoard={() => setRefreshToken((n) => n + 1)}

          mode={mode}
          onMode={setMode}
          anonymous={anonymous}
          leagueLabel={leagueLabel}

          keepers={keepers}
          onAddKeeper={(pick) => {
            if (!activeLeagueId) return;
            patchLeague(activeLeagueId, { keepers: [...keepers, pick] });
          }}
          onRemoveKeeper={(overall) => {
            if (!activeLeagueId) return;
            patchLeague(activeLeagueId, { keepers: keepers.filter((k) => k.overall !== overall) });
          }}
          onClearKeepers={() => activeLeagueId
            && patchLeague(activeLeagueId, { keepers: [], pendingKeepers: [] })}
          pendingKeepers={pendingKeepers}
          onKeeperRound={setKeeperRound}
          onDropPending={dropPendingKeeper}
          onImportKeepers={() => { void importKeepers(); }}
          keeperImportBusy={keeperImportBusy}
          keeperImportNote={keeperImportNote}
          canImport={(setup?.keepersDeclared ?? 0) > 0}
          declared={setup?.keepersDeclared ?? 0}

          resumeLive={resumeLive}
          onResumeLive={setResumeLive}
          liveCount={liveCount}
          liveBusy={liveBusy || starting}
          liveStarted={liveStarted}
          hasDraft={!!liveDraftId}
          startError={startError}
          onCheckLive={() => { void checkLive(); }}

          setup={setup}
          yahooMock={yahooMock}
          onYahooMock={applyYahooMock}
          waitingRoom={waitingRoom}
          myUserId={activeLeague?.myUserId ?? null}
          onMyUser={(userId) => {
            if (!activeLeagueId) return;
            patchLeague(activeLeagueId, { myUserId: userId });
            const seat = setup?.slots.find((s2) => s2.userId === userId);
            if (seat) setLeague((current) => ({ ...current, mySlot: seat.slot }));
            // The name follows you to your other leagues.
            if (seat?.manager) setMyManager(seat.manager);
          }}
          onCheckDraft={() => {
            if (activeLeagueId) void loadSetup(activePlatform, activeLeagueId, true);
          }}
        />
      )}

      {screen === 'draft' && engine && board && (
        <DraftScreen
          engine={engine}
          board={board}
          pace={pace}
          mode={mode}
          anonymous={anonymous}
          draftId={importedLeague?.draftId ?? null}
          platform={activePlatform}
          rankingEntries={rankings?.entries ?? null}
          notes={notes}
          adpSource={league.adpSource}
          onAdpSource={(adpSource) => setLeague({ ...league, adpSource })}
          poolSort={poolSort}
          queueWrite={queueWrite}
          onQueueWrite={setQueueWrite}
          queuePriority={queuePriority}
          onQueuePriority={setQueuePriority}
          onEngine={setEngine}
          onFinish={() => setScreen('results')}
          onLeave={() => setScreen('setup')}
        />
      )}

      {screen === 'results' && engine && (
        <ResultsScreen
          engine={engine}
          anonymous={anonymous}
          onRestart={restart}
          onNewSettings={() => setScreen('setup')}
        />
      )}

      {screen === 'season' && (
        <SeasonScreen
          // Rendered only where the reading is for the league now selected. The
          // pair is held together for this reason, so the two cannot disagree.
          read={season?.leagueId === activeLeagueId ? season.read : null}
          forgotten={seasonForgotten}
          loading={seasonBusy}
          error={seasonError}
          anonymous={anonymous}
          onRefresh={() => { void loadSeason(); }}
          onBack={() => setScreen('setup')}
        />
      )}
    </div>
  );
}
