export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

export const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * The feeds that can price a player, in the order they are offered.
 *
 * `what` is the part that is easy to get wrong when choosing. Sleeper and
 * Fantasy Football Calculator both measure where players actually go, over
 * different populations. ESPN's is a judgement rather than a measurement, so it
 * is the only one that can disagree with the market for a reason. Your own
 * room measures the people you are literally drafting against.
 */
export interface AdpFeed {
  id: string;
  label: string;
  /** A shorter name, where one screen has no room for the full one. */
  short?: string;
  what: string;
}

export const ADP_FEEDS: AdpFeed[] = [
  {
    id: 'sleeper',
    label: 'Sleeper',
    what: 'Where players go in Sleeper drafts. Ranks about twice as many players as anyone else, so the late rounds stay real.',
  },
  {
    id: 'ffc',
    label: 'Fantasy Football Calculator',
    short: 'FFC',
    what: 'Where players go in its own drafts. The only feed with a separate ADP per league size, and the only one that measures how far real drafts disagree, which is what sets the reaching.',
  },
  {
    id: 'espn',
    label: 'ESPN',
    what: 'A draft rank set by people rather than measured, put on the market’s own scale. The only opinion here, so the only one that can disagree for a reason. It abstains on kickers and defences.',
  },
  {
    id: 'room',
    label: 'Your draft room',
    what: 'What the people you are actually drafting against do. Only your own browser can read it, so it needs a live Yahoo draft and is not available in this app’s own mock draft.',
  },
];

/** How the chosen feeds are put together. */
export const ADP_RULES = [
  { id: 'avg', label: 'Averaged', what: 'The mean of every feed that puts him inside a draft.' },
  { id: 'order', label: 'In order', what: 'The first feed that has heard of him. The rest only fill its gaps.' },
];

/**
 * How the player pool is ordered.
 *
 * `split` sorts by how far the feeds disagree and has no control that reaches
 * it. It is left alone here rather than removed: the comparator that reads it
 * is not this change's to delete.
 */
export type SortKey = 'adp' | 'mine' | 'worth' | 'odds' | 'split';

/**
 * The orders the pool offers, in the order it offers them.
 *
 * Here rather than in the pool because the setup screen now names one as the
 * order a draft opens on, and a second list of the same four would be a second
 * place for them to disagree. The pool's own chips keep their own wording:
 * they say "Least likely to last" on a wide screen and "Going soon" on a
 * narrow one, which a single label cannot carry.
 *
 * `mine` needs a ranking file. Where there is none it is not offered and not
 * honoured, because an order over a ranking nobody uploaded is no order at all.
 */
export const POOL_SORTS: { id: SortKey; label: string }[] = [
  { id: 'adp', label: 'ADP' },
  { id: 'mine', label: 'My rank' },
  { id: 'worth', label: 'Worth' },
  { id: 'odds', label: 'Going soon' },
];

export interface AdpChoice {
  rule: string;
  feeds: string[];
}

/**
 * Read an `adpSource` string into the chips to light up.
 *
 * The server decides what a source string *means* for the board; this decides
 * only what the control shows, which is why the two are not one function. The
 * four bare words are what saved leagues held before the list was selectable,
 * and that table is closed: no new one will ever be added to it.
 */
export function parseAdpChoice(raw: string): AdpChoice {
  const legacy: Record<string, string> = {
    sleeper: 'order:sleeper,ffc',
    ffc: 'order:ffc,sleeper',
    blend: 'avg:sleeper,ffc',
    consensus: 'avg:sleeper,ffc,espn',
  };
  const text = legacy[raw] ?? raw ?? '';
  const at = text.indexOf(':');
  const rule = at > 0 ? text.slice(0, at) : 'order';
  const feeds = (at > 0 ? text.slice(at + 1) : text)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ADP_FEEDS.some((f) => f.id === s));

  if (!feeds.length) return { rule: 'order', feeds: ['sleeper', 'ffc'] };
  return { rule: ADP_RULES.some((r) => r.id === rule) ? rule : 'order', feeds };
}

/** Turn a choice back into the string the board is asked for. */
export function adpChoiceId({ rule, feeds }: AdpChoice): string {
  return rule + ':' + feeds.join(',');
}

export interface Player {
  id: string;
  key: string;
  name: string;
  position: Position;
  team: string;
  bye: number | null;
  adp: number;
  adpRank: number;
  adpStdev: number;
  stdevMeasured: boolean;
  points: number | null;
  /** Set when this player has no ADP in the chosen format and one was borrowed. */
  adpBorrowedFrom: string | null;
  /**
   * True where no feed you chose had a view of him and the rest answered.
   *
   * Kickers and defences under an ESPN-only board are the ordinary case: ESPN
   * abstains on both, and dropping them would leave a league that starts one of
   * each unable to fill a roster.
   */
  adpOutsideChoice?: boolean;
  ffcAdp: number | null;
  sleeperAdp: number | null;
  injuryStatus: string | null;
  /**
   * NFL seasons behind him. Zero is a rookie, and null is a player Sleeper
   * holds no history for at all.
   *
   * Not carried as a projection input — it is context for one. A first-year
   * player's points have nothing under them to have been measured against.
   */
  yearsExp?: number | null;
  timesDrafted: number;
  sources: string[];
  /** ESPN's published draft rank, over every player ESPN ranks. */
  espnRank?: number | null;
  /** That rank read as a pick on this board's scale, which is what averages. */
  espnPick?: number | null;
  /** False for kickers and defences, where ESPN's rank is roster convention. */
  espnVotes?: boolean;
  /** ESPN's own ADP, carried for display and left out of the average. */
  espnAdp?: number | null;
  espnAuction?: number | null;
  /** What the room being followed drafts him at. Null unless one is being read. */
  roomAdp?: number | null;
  /** The mean of the sources that had an opinion, in picks. */
  consensus?: number | null;
  /** How far apart they are, in picks. Null when only one source voted. */
  consensusSpread?: number | null;
  /** How many of the three voted. One is not a consensus. */
  consensusVotes?: number;
}

export interface BoardMeta {
  source: string;
  sourceUrl: string;
  format: string;
  formatLabel: string;
  adpSource: string;
  adpSourceLabel: string;
  /** How the feeds below were combined: `avg` or `order`. */
  adpRule: string;
  /** Which feeds priced this board, after unknown and unavailable ones were dropped. */
  adpFeeds: string[];
  /** Which feeds this board could have used. `room` is absent unless one is live. */
  adpOffered: string[];
  adpLeagueSize: number;
  requestedLeagueSize: number;
  year: number;
  totalDrafts: number | null;
  window: string | null;
  poolSize: number;
  positionCounts: Record<string, number>;
  ffcPoolSize: number;
  sleeperPoolSize: number;
  joinMatched: number;
  joinRate: number;
  withProjectedPoints: number;
  /** How many players carry an ADP read from a format other than this one. */
  adpBorrowed: number;
  /** How many no chosen feed had a view about, so the others priced them. */
  adpOutsideChoice: number;
  /** How many the room being followed has an ADP for. Zero when none is. */
  roomRanked: number;
  fetchedAt: number;
  /** True where a feed whose age counts is working from an old copy. */
  stale: boolean;
  /** How old each fetched feed's copy is. Read where the pick is being made. */
  feeds: FeedAge[];
}

/**
 * One feed's freshness.
 *
 * `counts` is whether this feed's age is the board's own: Sleeper and Fantasy
 * Football Calculator always are, since the projections, the deviations and the
 * byes come from them whatever prices the board, and ESPN only where it was
 * asked to price. A feed that never answered has no `fetchedAt` rather than an
 * age of now.
 */
export interface FeedAge {
  source: string;
  fetchedAt: number | null;
  stale: boolean;
  counts: boolean;
}

export interface Board {
  players: Player[];
  meta: BoardMeta;
}

/** Starting slots plus bench. The sum is how many rounds the draft runs. */
export interface RosterSlots {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SUPERFLEX: number;
  K: number;
  DEF: number;
  BENCH: number;
}

export type DraftType = 'snake' | 'linear' | 'third-round-reversal';

/**
 * What a run of this app is.
 *
 *   mock       a simulated room drafts against you, so you can rehearse
 *   assistant  nothing is simulated; the board mirrors your real Sleeper draft
 */
export type AppMode = 'mock' | 'assistant';

export interface LeagueConfig {
  teams: number;
  rounds: number;
  mySlot: number;
  draftType: DraftType;
  scoring: string;
  adpSource: string;
  year: number;
  roster: RosterSlots;
  seed: number;
  /**
   * What each seat is really called, index 0 being slot 1.
   *
   * Read from the league when there is one. A board that says "The Waiver
   * Wire Warriors" tells you who just took the back at your turn; a board
   * that says "Team 4" does not.
   */
  teamNames: string[] | null;
  /**
   * Picks that changed hands, read from the league. Null in a plain mock.
   *
   * These decide who is on the clock at every pick, so they belong beside the
   * draft type rather than off to one side: both answer the same question.
   */
  tradedPicks: TradedPick[] | null;
}

/** Every dial that changes how the computer teams draft. */
export interface CpuConfig {
  /** Per position, -5 avoids the position and +5 forces it. 0 follows ADP. */
  positionBias: Record<Position, number>;
  /** 0 drafts the board exactly. 3 matches real draft variance. 10 is chaos. */
  randomness: number;
  /** 0 ignores the roster. 5 balances it. 10 fills starting slots first. */
  needWeight: number;
  /** Let the computer teams draft from your uploaded rankings too. */
  cpuUsesMyRankings: boolean;
}

export interface DraftPick {
  overall: number;
  round: number;
  slotInRound: number;
  teamIndex: number;
  playerId: string;
  auto: boolean;
  /** Set when the pick was fixed in advance rather than made here. */
  preset: PresetSource | null;
}

/**
 * Why a pick was already decided before the simulator reached it.
 *
 *   keeper  a player kept from last season, off the board before pick one
 *   live    a pick that really happened in your Sleeper draft
 *   manual  a pick you entered to catch up to a draft in progress
 */
export type PresetSource = 'keeper' | 'live' | 'manual';

/**
 * A pick that is settled before the draft runs.
 *
 * Keepers, a real draft being followed, and catching up to a draft already
 * under way are the same thing to the engine: somebody else already decided
 * this slot, so nobody simulates it.
 */
export interface PresetPick {
  overall: number;
  playerId: string;
  source: PresetSource;
}

/**
 * A pick that changed hands before the draft. Both slots are 1 based.
 *
 * A traded pick does not move in the order. It stays where the seat that
 * originally owned it sits, and somebody else makes it. That distinction is the
 * whole of this: the board still has one pick per seat per round, and a team
 * can arrive at a round holding two of them, or none.
 */
export interface TradedPick {
  round: number;
  /** The seat the pick belongs to by right, which fixes where it sits. */
  fromSlot: number;
  /** The seat that will actually make it. */
  toSlot: number;
}

/**
 * A keeper the import knows everything about except what he costs.
 *
 * Sleeper publishes who is kept and by whom, never the round. Most of them are
 * priced off last season's draft, and the ones that cannot be are the ones you
 * picked up on waivers or the ones whose round another keeper already holds.
 * They used to be counted in a sentence and dropped. They wait here instead,
 * with everything already filled in, until you say which round.
 */
export interface PendingKeeper {
  playerId: string;
  /** The draft slot that keeps him, 1 based. */
  slot: number;
  name: string;
  position: string;
  team: string;
  /** Why the import could not settle it: no history, or the round was taken. */
  reason: 'no-history' | 'round-taken';
  /** The round that was tried and found occupied, when that is the reason. */
  triedRound: number | null;
}

export interface RankingEntry {
  id: string;
  key: string;
  name: string;
  position: Position;
  rank: number;
  tier: number | null;
  /** What you wrote about this player, when the file carried a notes column. */
  note: string | null;
  /** The name as your file wrote it, which is not always the board's name. */
  sourceName: string;
  /** Which tier found this player. Anything but `exact` is worth a glance. */
  matchedBy: 'override' | 'exact' | 'name' | 'team' | 'nickname' | 'loose';
  overrideKey: string;
}

/** A player the board holds who might be the one a failed name meant. */
export interface Suggestion {
  id: string;
  name: string;
  position: Position;
  team: string;
  adp: number;
}

export interface UnmatchedName {
  name: string;
  position: string | null;
  team: string | null;
  rank: number;
  /** The key an override is saved under. Survives case and punctuation. */
  key: string;
  suggestions: Suggestion[];
}

export interface RankingColumns {
  detectedHeader: boolean;
  name: string;
  position: string | null;
  team: string | null;
  rank: string;
  /** Which column index the rank was read from. -1 when the file had no header. */
  rankIndex: number;
  /** True when you picked the rank column yourself rather than letting it detect. */
  rankWasChosen: boolean;
  tier: string | null;
  /** The header the note was read from, or null when the file had none. */
  note: string | null;
  headers: string[];
}

export interface RankingSet {
  label: string;
  entries: RankingEntry[];
  unmatched: UnmatchedName[];
  ignored: { name: string; position: string | null; key: string }[];
  tiers: Record<string, number>;
  duplicates: number;
  matchRate: number;
  columns: RankingColumns;
}

/**
 * Your own name to player mapping. A player id maps the name to that player.
 * An explicit null means "leave this name out and stop asking".
 */
export type Overrides = Record<string, string | null>;

/**
 * A file of notes, matched onto the board.
 *
 * A notes file is a ranking file with the ranking left out, so it goes through
 * the same six matching tiers and reports the same unmatched names.
 */
export interface NoteSet {
  label: string;
  notes: { id: string; name: string; note: string }[];
  unmatched: UnmatchedName[];
  ignored: { name: string; position: string | null; key: string }[];
  matchRate: number;
  columns: RankingColumns;
}

/**
 * Which league platform a league is read from.
 *
 * Sleeper is the default and needs nothing of the user. Yahoo needs the bridge
 * userscript running in their own draft room, because Yahoo's endpoints answer
 * a session cookie the service must never hold. See `DECISIONS.md`.
 */
export type Platform = 'sleeper' | 'yahoo';

/**
 * What to call a platform on screen.
 *
 * Here rather than in the panel that lists them, because two screens name a
 * platform and one of them was naming Sleeper while a Yahoo league was loaded.
 */
export const PLATFORM_LABEL: Record<Platform, string> = {
  sleeper: 'Sleeper',
  yahoo: 'Yahoo',
};

/**
 * A league you draft in, with its settings kept.
 *
 * A league's shape barely moves once the season is set, so the settings are
 * pulled once and then read from here. Loading a league is instant and works
 * with the network down. `Refresh` pulls again when you have actually changed
 * something over there.
 */
export interface SavedLeague {
  id: string;
  name: string;
  /**
   * Where the league is read from. Absent on a league saved before there was
   * more than one platform, which is why every read of it falls back to
   * Sleeper rather than treating the gap as an error.
   */
  platform?: Platform;
  settings: LeagueImport | null;
  fetchedAt: number | null;
  /**
   * Everything that belongs to this league and not to the app.
   *
   * Your three leagues are standard, half PPR and PPR, and every ranking site
   * publishes a separate file per format, so a single ranking set would mean
   * re-uploading on every switch. Keepers are per league for the same reason.
   */
  rankingSource: import('../storage').RankingSource | null;
  keepers: PresetPick[];
  /** Imported keepers still waiting on the one thing Sleeper does not publish. */
  pendingKeepers: PendingKeeper[];
  /** Picks that changed hands, kept so a mock of this league runs true. */
  tradedPicks: TradedPick[];
  /** Which Sleeper manager is you, so a real draft knows which picks are yours. */
  myUserId: string | null;
  /** The seats and their team names, read from the league. */
  slots: LeagueSlot[];
}

/** Draft settings read straight out of a real Sleeper league. */
export interface LeagueImport {
  id: string;
  name: string;
  season: string | null;
  status: string | null;
  teams: number;
  rounds: number;
  /**
   * The roster shape and the scoring, or null where the platform does not
   * publish them. Yahoo's draft room carries neither, so a Yahoo import leaves
   * both as the user set them rather than inventing a league that is not
   * theirs, and says so in `warnings`.
   */
  roster: RosterSlots | null;
  scoring: string | null;
  draftType: DraftType;
  receptionPoints: number;
  draftId: string | null;
  isKeeper: boolean;
  maxKeepers: number;
  warnings: string[];
}

export interface LeagueMember {
  userId: string;
  name: string;
  teamName: string | null;
}

/** What a real Sleeper draft looks like right now. */
export interface LiveDraftState {
  draftId: string;
  status: string;
  type: string;
  started: boolean;
  complete: boolean;
  rounds: number;
  teams: number;
  slotByUser: Record<string, number>;
  orderIsSet: boolean;
  /**
   * The seat belonging to whoever is watching, where the platform settles it.
   *
   * Yahoo does: the draft room address the bridge runs in names the team, so
   * there is nothing to work out. Sleeper has no equivalent and leaves this
   * absent, which is why it is optional rather than nullable everywhere.
   */
  mySeat?: number | null;
}

export interface LivePick {
  overall: number;
  round: number;
  slot: number;
  rosterId: number | null;
  pickedBy: string | null;
  isKeeper: boolean;
  playerId: string;
  /** True when this board has never heard of the player who was taken. */
  offBoard: boolean;
  name: string;
  position: string;
  team: string;
}

/** One seat in a real league: who owns it and what they call the team. */
export interface LeagueSlot {
  slot: number;
  rosterId: number | null;
  userId: string | null;
  manager: string | null;
  name: string;
  named: boolean;
}

/** A keeper a manager has declared, before the draft turns it into a pick. */
export interface DeclaredKeeper {
  slot: number | null;
  rosterId: number;
  sleeperId: string;
  playerId: string | null;
  name: string | null;
  position: string | null;
  team: string | null;
  /** Where he went last season. Evidence for the cost, never a statement of it. */
  suggestedRound: number | null;
  suggestedFrom: string;
}

/** Everything a real league can tell us before its draft opens. */
export interface LeagueSetup {
  leagueId: string;
  teams: number;
  slots: LeagueSlot[];
  keepers: DeclaredKeeper[];
  keepersDeclared: number;
  maxKeepers: number;
  isKeeper: boolean;
  /** Picks traded before the draft, in this season only. */
  tradedPicks: TradedPick[];
  draft: (LiveDraftState & { startTime: number | null }) | null;
  namedTeams: number;
}

export interface LivePicks {
  picks: LivePick[];
  matched: number;
  unknown: { name: string; position: string; team: string }[];
  poolSize: number;
  /**
   * What this room's own site says its drafters do, by board player id.
   *
   * Only Yahoo sends it, and only for the few hundred players it reports a pick
   * for. Absent everywhere else, which is why every reader of it treats an
   * empty list as "no reading" rather than as "no lean".
   */
  roomAdp?: { id: string; adp: number }[];
  /**
   * The queue the room itself holds, in its own order.
   *
   * Yahoo only, and null until the room has said. That is not the same as an
   * empty queue, and the difference decides whether the app may write one at
   * all: the frame that sets a queue replaces it, so writing without knowing
   * what is there deletes the rest. See `DECISIONS.md`.
   *
   * `id` is null for a queued player this board does not hold. He keeps his
   * place rather than being dropped, because he is holding one in the room.
   */
  queue?: { id: string | null; name: string }[] | null;
  /**
   * What the service makes of the queue this app asked it to write.
   *
   * Yahoo only, and the same reading the panel over the draft room shows. `off`
   * is the one worth acting on: while the setting is on it means the service is
   * holding no wanted list, which is what a restart mid-draft leaves behind.
   */
  queueState?: QueueState;
}

/**
 * Whether the app writes your queue into the draft room, and what fills it.
 *
 * Off is the default and the state everything behaved as before the app could
 * write anything at all. `mirror` sends the players you starred. `autodraft`
 * sends those and tops them up from the board's own chain, so a clock that runs
 * out takes a player worth having rather than whatever Yahoo would have picked.
 */
export type QueueWrite = 'off' | 'mirror' | 'autodraft';

/**
 * What the service is doing with the queue, as it reports it.
 *
 * `off` is nothing asked for, `first` is a write into a room that has never
 * said what its own queue holds, and `ready` is one merged with a queue that
 * has been read. The room's own queue survives a restart, because the bridge
 * says it again; the list this app asked for does not, because this app is the
 * only place it exists.
 */
export type QueueState = 'off' | 'first' | 'ready';

/**
 * Whose entries lead when the app's queue and the room's are merged.
 *
 * Neither setting ever drops the other side's players. The app's list and the
 * room's are concatenated and de-duplicated, and this only says which block
 * goes first — which is to say, which gets drafted first if a clock expires.
 */
export type QueuePriority = 'app' | 'yahoo';

/**
 * How much of a Yahoo draft room has been posted, while the app waits for one.
 *
 * The one question about a Yahoo league whose ordinary answer is "not yet", and
 * so the one that reports rather than refusing.
 */
/**
 * Which copy of the Yahoo bridge is posting, and whether it is the one this
 * build expects.
 *
 * Null on a room nothing has posted to. `tooOld` is a copy that posted without
 * naming itself, which is every version before the stamp existed; `fromSource`
 * is one run straight from the repository, which cannot be behind anything.
 */
export interface BridgeStatus {
  version: string | null;
  build: string | null;
  tooOld: boolean;
  fromSource: boolean;
  stale: boolean;
  /**
   * When it last posted, by this machine's own clock, or null if nothing has.
   *
   * The one field here about now rather than about which copy is installed, and
   * the app needs both: a bridge posts every few seconds from inside a draft
   * room and from nowhere else, so none of the flags above expires on its own
   * and "current" outlives the browser that earned it.
   */
  heardAt: number | null;
  current: { version: string | null; build: string };
}

/**
 * What the service says about the bridge, league-independent.
 *
 * `version` and `build` are the copy this build expects; `running` is what is
 * actually installed, or null until something has posted.
 */
export interface BridgeReport {
  version: string | null;
  build: string;
  running: BridgeStatus | null;
  /**
   * Where to install the current copy from.
   *
   * Said by the service rather than written into the client, which reaches it
   * as a proxied `/api` and so cannot name the port it is really on. `PORT` is
   * a setting, and a reinstall link pointing at a port nobody is listening on
   * is offered exactly when the user has been told to use it.
   */
  installUrl: string;
}

export interface RoomState {
  orderIsSet: boolean;
  mySeat: number | null;
  /**
   * Whether the room holds an ADP the board could be priced on.
   *
   * Asked after the draft has opened as well as before it. A board says which
   * feeds it could have used as of when it was built, and a room arrives on its
   * own schedule, so this is the only thing that says the answer has changed.
   */
  pricesBoard: boolean;
  /** Which userscript is feeding the room. Null until something has posted. */
  bridge: BridgeStatus | null;
}

/**
 * What the board makes of a room, in the few lines a panel over a draft can
 * hold without getting in the way of it.
 *
 * Deliberately flat and already worded. The bridge that shows this runs inside
 * a page this project does not own, so it is given something to paint rather
 * than something to work out: nothing here needs the board, the engine, or a
 * second opinion about what a number means.
 */
export interface RoomAdvice {
  /** Whether the seat running the bridge is the one on the clock. */
  onClock: boolean;
  /** The pick this reading runs to, as the draft room itself numbers it. */
  pickLabel: string;
  /** What the room is leaning towards, when it is leaning hard enough to say. */
  lean: string | null;
  /**
   * The pick this turn is for, when there is one and it is yours to make.
   *
   * Null is a real answer: two positions within a field goal of each other is
   * not a decision, and the panel says nothing rather than inventing one.
   */
  pick: {
    name: string;
    position: string;
    /** Points over a replacement starter at his own position. */
    worth: number;
    /** What your next turn is still expected to bring once he is taken. */
    nextTurn: number;
    /** Which starting slot he fills: `own`, `flex`, `superflex`, or none. */
    slot: 'own' | 'flex' | 'superflex' | null;
  } | null;
  /**
   * Who the pick is instead, once the name above has gone.
   *
   * Read off the same board with him removed, so they are answers rather than
   * runners-up: a run at one position puts the next man at it second, ahead of
   * every other position's leader. Empty whenever `pick` is null.
   */
  alternates: {
    name: string;
    position: string;
    /** Points over a replacement starter at his own position. */
    worth: number;
  }[];
  /**
   * Where the numbers came from, which changes what they mean.
   *
   * ADP is what an average room does. Once enough real picks exist the room is
   * simulated forward from them, and a run already under way moves these
   * numbers where ADP cannot see it. The panel says which it is reading.
   */
  source: { kind: 'room'; sims: number } | { kind: 'adp' };
  rows: {
    position: string;
    /** The best player left at that position. */
    name: string;
    /** What that player is worth over a replacement starter. */
    worth: number;
    /** Points over a replacement starter given up by waiting one turn. */
    cost: number;
    /** The chance that player is still there at your next pick. */
    odds: number;
    /** How many are left at the position before the biggest drop in value. */
    beforeCliff: number;
  }[];
}

/*
 * A YAHOO LEAGUE IN SEASON, AS THE SERVICE HANDS IT BACK.
 *
 * The draft types above describe a board and a draft. These describe a league
 * that already happened: rosters as they stand, the slots and scoring the
 * commissioner set, and how old each feed behind them is.
 *
 * Nothing here is a projection or a recommendation. Phase 8 shows a league.
 */

/** One slot in a league's roster shape, and what the published vocabulary says it takes. */
export interface SeasonSlot {
  position: string;
  count: number;
  /** The league's own answer, from `is_starting_position`. */
  starting: boolean;
  /**
   * The positions this slot accepts, resolved from Yahoo's published slot list.
   *
   * Null on bench and IR, which take anybody and have nothing to resolve, and
   * null on a starting slot this app could not explain — which is what
   * `unresolved` separates from the first case.
   */
  accepts: string[] | null;
  /**
   * Whether this is a starting slot the app cannot reason about.
   *
   * Null where the published slot list never arrived, because then nothing is
   * known either way and calling it unresolved would blame the league for the
   * network.
   */
  unresolved: boolean | null;
}

/** One scoring rule: what is counted, and what it is worth. */
export interface SeasonScoring {
  statId: string;
  name: string | null;
  abbr: string | null;
  group: string | null;
  enabled: boolean;
  /** Null where the league counts a stat and sets no value on it. */
  points: number | null;
}

/** What Yahoo's public pool says about a player, or null where it never matched him. */
export interface SeasonPoolRecord {
  /**
   * Yahoo's own status code, carried and never interpreted.
   *
   * NOT AN INJURY FLAG. `NA` is 44% of the pool and means unrostered, so which
   * codes make a player unstartable is a question about a league's rules. See
   * `server/src/sources/yahooPlayers.js` for the nine codes.
   */
  status: string | null;
  statusFull: string | null;
  injuryNote: string | null;
  byeWeek: number | null;
  percentOwned: number | null;
  /** What ownership did over the last week, which is the part that is a signal. */
  percentOwnedDelta: number | null;
  percentOwnedWeek: number | null;
}

export interface SeasonPlayer {
  playerKey: string;
  playerId: string;
  name: string | null;
  team: string | null;
  displayPosition: string | null;
  primaryPosition: string | null;
  /** Every position Yahoo says he is eligible at, kept whole. */
  positions: string[];
  /** What he is started in right now, bench and IR included. */
  selectedPosition: string | null;
  isFlex: boolean;
  byeWeek: number | null;
  isKeeper: boolean;
  /** Which of the league's starting slots he may fill, by slot name. */
  fills: string[];
  /**
   * The two joins, nested rather than spread.
   *
   * Null means this join never found him, which is a different thing from a
   * field being empty: a spread record would leave "healthy" and "never found"
   * both reading as null.
   */
  pool: SeasonPoolRecord | null;
  board: Player | null;
}

export interface SeasonRoster {
  teamKey: string | null;
  week: number | null;
  editable: boolean;
  /** Whether this is the user's own team, from the guid and never from a seat. */
  own: boolean;
  players: SeasonPlayer[];
  /**
   * How many joined, per feed, and **null where that join could not run**.
   *
   * Null and not zero. A feed that did not answer has said nothing about
   * anybody, so a count of zero would be a false claim that reads as a finding
   * about the league rather than as a failed fetch.
   */
  matched: { pool: number | null; board: number | null; of: number };
  /**
   * Named rather than counted, so a miss points at a player to go and look at.
   * Null on the same rule as `matched`: not a list of everybody.
   */
  unmatched: { pool: string[] | null; board: string[] | null };
}

export interface SeasonTeam {
  teamKey: string;
  teamId: string;
  name: string | null;
  waiverPriority: number | null;
  moves: number | null;
  trades: number | null;
  managers: { guid: string | null; nickname: string | null }[];
}

/** The league as the browser read it, before anything was joined to it. */
export interface LeagueSnapshot {
  leagueKey: string;
  leagueId: string;
  name: string | null;
  gameCode: string | null;
  season: string;
  numTeams: number | null;
  scoringType: string | null;
  week: {
    current: number | null;
    start: number | null;
    end: number | null;
    matchup: number | null;
    deadline: string | null;
  };
  slots: { position: string; count: number; starting: boolean }[];
  scoring: SeasonScoring[];
  waivers: { type: string | null; rule: string | null; days: string | null; usesFaab: boolean };
  trades: { endDate: string | null; ratifyType: string | null };
  ownGuid: string | null;
  ownTeamKey: string | null;
  teams: SeasonTeam[];
  rosters: { teamKey: string | null; week: number | null; players: unknown[] }[];
  /**
   * Whether the copy of the reader that posted this can read every roster.
   *
   * A bookmarklet carries its whole source in the address it was dragged from
   * and cannot update itself, so an old copy sends one roster. Said out loud,
   * because one roster in an eight-team league otherwise looks like Yahoo
   * having failed rather than like a bookmark to re-drag.
   */
  readerBehind: boolean;
  readAt: number;
}

/** One feed's age, and whether it answered at all. */
export interface SeasonFeed {
  fetchedAt: number | null;
  stale: boolean;
  error: string | null;
}

export interface SeasonRead {
  /** False before the bookmarklet has ever been run, which is not a fault. */
  read: boolean;
  hint?: string;
  /**
   * Where to install the reader bookmarklet.
   *
   * From the service, on the same reasoning as the bridge's `installUrl`: the
   * client reaches the service as a proxied `/api` and cannot name the port it
   * is really on, and `PORT` is a documented setting.
   */
  readerUrl: string;
  snapshot?: LeagueSnapshot | null;
  league: {
    slots: SeasonSlot[];
    /**
     * Starting slots this app cannot reason about, named rather than counted.
     *
     * Null where the published slot list never arrived. An empty list is the
     * positive statement that every slot was explained, so it must not be what
     * a failed fetch produces.
     */
    unresolvedSlots: string[] | null;
    rosters: SeasonRoster[];
    matched: { pool: number | null; board: number | null; of: number; rosters: number };
    /** Which joins ran at all, so a caller can tell no count from a count of zero. */
    joined: { pool: boolean; vocabulary: boolean; board: boolean };
  } | null;
  /**
   * Per feed rather than one age for the lot.
   *
   * They are fetched apart, so a single age would report whichever happened to
   * refresh last. `league` is dated by when the browser read it, since it was
   * never a feed.
   */
  feeds: {
    league: SeasonFeed;
    pool: SeasonFeed;
    vocabulary: SeasonFeed;
    board: SeasonFeed;
  } | null;
}

/** One league the service is holding a reading of, enough to name it on a button. */
export interface SeasonLeagueHeld {
  leagueId: string;
  name: string | null;
  season: string;
  numTeams: number | null;
  readAt: number;
}

/**
 * The leagues the service has snapshots for, newest first.
 *
 * How the in-season screen offers a league without being told a number, and it
 * exists because the first answer was wrong: the screen borrowed the app's
 * *active* league, which is a draft setting and needs a posted draft room to be
 * set at all. In season there is none.
 */
export interface SeasonLeagueList {
  leagues: SeasonLeagueHeld[];
}

/**
 * One seat of the league's starting lineup, and who is in it.
 *
 * `id` distinguishes two seats of the same slot, which a slot name cannot: a
 * league starting two backs has two `RB` seats and they are not the same seat.
 */
export interface LineupSeat {
  id: string;
  slot: string;
  index: number;
  accepts: string[];
}

/** A move from the current lineup to the best one, as a seat the user edits. */
export interface LineupMove {
  slot: string;
  /** Null where the seat was empty, which is a start rather than a swap. */
  out: { playerKey: string; name: string } | null;
  in: { playerKey: string; name: string };
}

/** Why a player in a starting slot cannot be counted or kept there. */
export interface LineupSat {
  player: string;
  slot: string;
  reason: string;
}

/** One projection desk's answer: its best lineup and what it would take. */
export interface LineupDesk {
  lineup: { seat: LineupSeat; player: SeasonPlayer }[];
  points: number;
  currentPoints: number;
  /**
   * The projected difference, and **null where a starter has no projection**.
   *
   * The difference between two totals is only a difference if both are totals.
   * One built over a player this desk never scored is missing a term of unknown
   * size, so a number here would be confidently wrong in an unknown direction.
   */
  gain: number | null;
  seats: LineupSeat[];
  moves: LineupMove[];
  /** Starting seats nothing could legally fill. */
  empty: string[];
  /** Starting slots this app could not read, so it refused to reason about them. */
  unresolved: string[];
  /**
   * Starting slots no desk projects, which today means kickers and defences.
   *
   * A permanent limit rather than a defect: Y9.1 could not reproduce either
   * position's components against a feed's own published points.
   */
  unscoreable: string[];
  unscoredStarters: LineupSat[];
  benched: LineupSat[];
  /** Null where nothing is known about which players have locked. */
  locked: string[] | null;
}

/** A seat the two desks fill differently, reported rather than decided. */
export interface LineupDispute {
  slot: string;
  picks: {
    desk: string;
    player: string | null;
    points: Record<string, number | null>;
  }[];
  /** The widest gap any one desk sees between the players it is choosing between. */
  spread: number;
  /** Whether that gap is past the three points Y9.0 measured between the desks. */
  material: boolean;
}

/** A rostered player with both desks' numbers and what he could actually fill. */
export interface LineupRosterPlayer {
  playerKey: string;
  name: string | null;
  team: string | null;
  positions: string[];
  selectedPosition: string | null;
  byeWeek: number | null;
  /**
   * Which starting slots he may fill, by slot name.
   *
   * Empty is the answer to "why not him", and it is the common one: a
   * quarterback on a roster with no quarterback slot outprojects the flex
   * starter and still cannot play there.
   */
  fills: string[];
  points: { sleeper: number | null; espn: number | null };
}

/**
 * This week's lineup advice for the user's own team.
 *
 * BOTH DESKS, NEVER AVERAGED, which is Y9.0's measurement and not a
 * preference: a mean showed a player at 13.0 where the desks said 15.29 and
 * 10.75, which is a start reported as a sit.
 */
export interface LineupRead {
  read: boolean;
  hint?: string;
  /** Why there is no advice, where the league was read but a lineup cannot be. */
  error?: string;
  week: number | null;
  teamKey?: string;
  editable?: boolean;
  advice: {
    desks: Record<string, LineupDesk>;
    agreed: { slot: string; player: string }[];
    disputed: LineupDispute[];
    /** Which desks answered at all. One desk's advice is not two agreeing. */
    answered: string[];
    /**
     * Whether anything is known about which players have locked.
     *
     * False is the ordinary case, not an edge one: Yahoo publishes no kickoff
     * time at any scope. The screen has to say so, because advice given as
     * though nothing had locked is advice to make moves that may be refused.
     */
    locksKnown: boolean;
  } | null;
  roster?: LineupRosterPlayer[];
  /** The league's own rules each desk cannot score, per desk rather than per player. */
  unsupported?: {
    sleeper: { statId: string; name: string; points: number; reason: string }[];
    espn: { statId: string; name: string; points: number; reason: string }[];
  };
  /** Rostered players a desk never projected, named rather than counted. */
  unprojected?: { sleeper: string[] | null; espn: string[] | null };
  feeds: {
    league: SeasonFeed;
    sleeper: SeasonFeed;
    espn: SeasonFeed;
    vocabulary: SeasonFeed;
  } | null;
  /**
   * Sleeper's oldest record in the week, and the desk behind it.
   *
   * A fetch age cannot show this. Y9.0 found a future week comes back as a
   * stale vintage inside a fresh fetch, its own points contradicting its own
   * components by about two points at quarterback.
   */
  vintage?: { sleeper: number | null; desk: string | null };
}
