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
  stale: boolean;
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
}

/**
 * How much of a Yahoo draft room has been posted, while the app waits for one.
 *
 * The one question about a Yahoo league whose ordinary answer is "not yet", and
 * so the one that reports rather than refusing.
 */
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
    /** How much of that goes if you wait a turn, when the wait is yours. */
    urgency: number;
    /** Whether he fills a starting slot you have still to fill. */
    fillsStarter: boolean;
  } | null;
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
