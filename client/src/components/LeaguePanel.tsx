import { useState } from 'react';
import { maskLeague, maskTeam } from '../anon';
import type { LeagueImport, LeagueSetup, Platform, SavedLeague } from '../engine/types';

interface Props {
  leagues: SavedLeague[];
  activeId: string | null;
  imported: LeagueImport | null;
  busy: boolean;
  error: string | null;
  onLoad: (id: string) => void;
  onAdd: (platform: Platform, id: string) => void;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  anonymous: boolean;
  setup: LeagueSetup | null;
  myUserId: string | null;
  onMyUser: (userId: string) => void;
  /** Whether the Yahoo league being added is one of Yahoo's own mock drafts. */
  yahooMock: boolean;
  onYahooMock: (on: boolean) => void;
}

/** How long ago a league's settings were pulled, in plain words. */
function pulledWhen(at: number | null): string {
  if (!at) return 'not pulled yet';
  const hours = (Date.now() - at) / 3600000;
  if (hours < 1) return 'pulled in the last hour';
  if (hours < 24) return 'pulled ' + Math.round(hours) + ' hours ago';
  const days = Math.round(hours / 24);
  return 'pulled ' + days + (days === 1 ? ' day ago' : ' days ago');
}

const SCORING_WORDS: Record<string, string> = {
  standard: 'standard', 'half-ppr': 'half PPR', ppr: 'PPR', '2qb': 'superflex', dynasty: 'dynasty',
};

/** What each platform costs a user, and what it can be asked for. */
const PLATFORMS: { id: Platform; label: string; hint: string }[] = [
  {
    id: 'sleeper',
    label: 'Sleeper',
    hint: 'The long number in the Sleeper web address of your league. Nothing else is needed.',
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    hint: 'The number in your Yahoo draft room address. Yahoo answers only your own browser, '
      + 'so this needs the bridge userscript running in your draft room; see the README. '
      + 'Yahoo does not publish the roster shape or the scoring, so set those yourself.',
  },
];

/**
 * Load the settings out of a league you actually play in.
 *
 * Sleeper publishes a league without a key, so the whole setup is a league ID.
 * Yahoo publishes nothing to anyone but your own browser, so a Yahoo league
 * arrives through the bridge instead and carries less with it.
 *
 * What neither can tell us before the draft is which slot is yours, so that one
 * field stays yours to pick.
 */
export default function LeaguePanel(props: Props) {
  const {
    leagues, activeId, imported, busy, error, onLoad, onAdd, onRefresh, onRemove, anonymous,
    setup, myUserId, onMyUser, yahooMock, onYahooMock,
  } = props;
  const seats = setup?.slots ?? [];
  const mySeat = seats.find((s2) => s2.userId === myUserId) || null;
  const shown = (id: string) => {
    const i = leagues.findIndex((l) => l.id === id);
    const found = leagues[i];
    return maskLeague(found ? found.name : 'Sleeper league', i < 0 ? 0 : i, anonymous);
  };
  const [typed, setTyped] = useState('');
  const [platform, setPlatform] = useState<Platform>('sleeper');
  const active = leagues.find((l) => l.id === activeId) || null;
  const chosen = PLATFORMS.find((p) => p.id === platform) || PLATFORMS[0];
  // A league saved before there was a choice is a Sleeper league.
  const activeLabel = PLATFORMS.find((p) => p.id === (active?.platform ?? 'sleeper'))?.label
    ?? 'Sleeper';

  // Trades change which picks are yours, so they change what a mock of this
  // league is worth. The seat alone no longer answers "when do I pick".
  const trades = setup?.tradedPicks ?? [];
  const myTrades = {
    bought: mySeat ? trades.filter((t) => t.toSlot === mySeat.slot).length : 0,
    sold: mySeat ? trades.filter((t) => t.fromSlot === mySeat.slot).length : 0,
  };

  return (
    <>
    <div className="preset-row">
      {leagues.map((l) => (
        <span className="league-chip" key={l.id} data-active={activeId === l.id}>
          <button
            type="button"
            className="preset"
            aria-pressed={activeId === l.id}
            disabled={busy}
            onClick={() => onLoad(l.id)}
          >
            {maskLeague(l.name, leagues.indexOf(l), anonymous)}
          </button>
          <button
            type="button"
            className="league-drop"
            aria-label={'Forget ' + maskLeague(l.name, leagues.indexOf(l), anonymous)}
            title={'Forget this league'}
            onClick={() => onRemove(l.id)}
          >
            ×
          </button>
        </span>
      ))}
      {leagues.length === 0 && <p className="hint">No leagues saved yet.</p>}
    </div>

    {seats.length > 0 && (
      <div className="field">
        <label htmlFor="myUser">Which manager are you</label>
        <select
          id="myUser"
          className="input"
          style={{ maxWidth: 380 }}
          value={myUserId || ''}
          onChange={(e) => onMyUser(e.target.value)}
        >
          <option value="">Pick your name…</option>
          {seats.filter((m) => m.userId).map((m) => (
            <option key={m.userId!} value={m.userId!}>
              {m.slot + '. ' + maskTeam(m.name, m.slot - 1, m.userId === myUserId, anonymous)
                + (anonymous || !m.manager || m.manager === m.name ? '' : ' — ' + m.manager)}
            </option>
          ))}
        </select>
        <p className="hint">
          {mySeat
            ? 'You draft from seat ' + mySeat.slot + '. A mock of this league sits you there '
              + 'too, so the picks you rehearse are the picks you get.'
            : 'This sets your draft slot, and marks your picks when following the real draft.'}
        </p>
        {trades.length > 0 && (
          <p className="hint">
            {trades.length + ' pick' + (trades.length === 1 ? ' has' : 's have')
              + ' changed hands here, and the board follows them. '}
            {mySeat && (myTrades.bought || myTrades.sold)
              ? 'You bought ' + myTrades.bought + ' and sold ' + myTrades.sold + '.'
              : ''}
            {mySeat && !myTrades.bought && !myTrades.sold ? 'None of them are yours.' : ''}
          </p>
        )}
      </div>
    )}

    <div className="grid-2">
      <div className="field">
        <label htmlFor="leagueId">Add a league by ID</label>
        <div className="preset-row" role="group" aria-label="Where the league is">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="preset"
              aria-pressed={platform === p.id}
              disabled={busy}
              onClick={() => setPlatform(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="leagueId"
            className="input"
            value={typed}
            inputMode="numeric"
            placeholder="the long number from your league address"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed.trim()) { onAdd(platform, typed.trim()); setTyped(''); }
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={!typed.trim() || busy}
            onClick={() => { onAdd(platform, typed.trim()); setTyped(''); }}
          >
            Add
          </button>
        </div>
        <p className="hint">{chosen.hint}</p>

        {/*
          * Yahoo's own mock rooms are all the same shape and never say so.
          * Ticking this fills in what Yahoo will not: the roster it runs, and
          * the decision to open the board the moment the room is readable,
          * which is what makes a mock worth joining on a whim.
          */}
        {platform === 'yahoo' && (
          /* Wrapped, so the tick is not a direct child of `.field`, whose own
             label rule would set it in small caps as a heading. */
          <div style={{ marginTop: 8 }}>
          <label className="resume-switch">
            <input
              type="checkbox"
              checked={yahooMock}
              disabled={busy}
              onChange={(e) => onYahooMock(e.target.checked)}
            />
            <span>
              <b>This is a Yahoo mock draft.</b>
              {' Sets the roster Yahoo mocks always run, QB, WR, WR, RB, RB, TE, W/R/T, K '}
              {'and DEF with six on the bench, and follows the draft as soon as the room '}
              {'is readable. The lobby shows the league number before it starts.'}
            </span>
          </label>
          </div>
        )}
      </div>

      <div>
        {busy && <p className="hint">Reading the league.</p>}

        {imported && !busy && (
          <>
            <p className="eyebrow">Loaded</p>
            <p style={{ margin: '2px 0 0' }}>
              {shown(imported.id)}
              {imported.season ? ', ' + imported.season : ''}
            </p>
            <p className="hint">
              {imported.teams + ' teams, ' + imported.rounds + ' rounds, '}
              {/* Yahoo's draft room carries neither, and the import says so in
                  its warnings rather than filling them in. */}
              {imported.scoring
                ? (SCORING_WORDS[imported.scoring] || imported.scoring) + ', '
                : ''}
              {(imported.draftType === 'snake' ? 'snake' : imported.draftType) + '. '}
              {imported.roster && imported.roster.K === 0 ? 'No kicker. ' : ''}
              {imported.roster && imported.roster.FLEX > 1
                ? imported.roster.FLEX + ' flex slots. '
                : ''}
              {'Pick your own draft slot below; the order is not set until the draft starts.'}
            </p>
            <p className="hint" style={{ marginTop: 6 }}>
              {'Settings ' + pulledWhen(active?.fetchedAt ?? null) + '. '}
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => onRefresh(imported.id)}
              >
                {'Refresh from ' + activeLabel}
              </button>
            </p>
          </>
        )}
      </div>
    </div>

    {error && (
      <div className="banner is-bad">
        <span>{error}</span>
      </div>
    )}

    {imported && imported.warnings.length > 0 && (
      <div className="banner">
        <span>
          <b>{'Worth knowing about ' + shown(imported.id) + ':'}</b>
          <br />
          {imported.warnings.join(' ')}
        </span>
      </div>
    )}
    </>
  );
}
