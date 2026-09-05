import type { BoardMeta, Player } from './types';

/**
 * The board as a file you can take away.
 *
 * Yahoo sells a downloadable cheat sheet. The equivalent here is already on
 * screen and had no way out of the browser: three sources, what each of them
 * said, and how far apart they were. This writes that out.
 *
 * IT IS WRITTEN TO BE READ BACK. `server/src/rankings.js` scores header names
 * rather than matching them, so a file it cannot read is a file that silently
 * sorts your board into market order and still calls it yours. The headers
 * below are chosen against that scoring, and the round trip is checked in the
 * self test rather than assumed:
 *
 *   Rank      exact hit, 95    the ranking, and the one that has to win
 *   ADP       exact hit, 40    the market, which is what it falls back to
 *
 * So `Rank` wins by design and not by luck. Two things would take that away: a
 * new column hitting `overall rank`, which scores 100, or any column merely
 * containing the word, which scores 76 and would beat `ADP` while losing to
 * `Rank`. ESPN's column is `ESPN Pick` for both reasons, and because it holds
 * a rank read onto this board's pick scale, which is the more accurate name.
 */

/** Columns whose header is load bearing, in the order they are written. */
const HEADER = [
  'Rank', 'Player', 'Position', 'Team', 'Bye',
  'Consensus', 'Spread', 'Votes',
  'ADP', 'Sleeper ADP', 'FFC ADP',
  'ESPN Pick', 'ESPN ADP', 'ESPN Auction',
  'Projected Points', 'Injury',
];

/**
 * One cell, quoted only when it has to be.
 *
 * The reader splits on commas and tabs and honours quotes, so anything holding
 * either has to arrive quoted. Nothing on a board normally does, but a
 * defence's name comes from a feed and the cost of being wrong is a row that
 * shifts every column after it.
 */
function cell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const text = String(value);
  if (!/[",\t\n\r]/.test(text)) return text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** A number to one decimal place, or an empty cell when nobody measured it. */
function num(value: number | null | undefined): string {
  return value == null ? '' : value.toFixed(1);
}

/**
 * The board, in the order it is in on screen.
 *
 * The order is the board's own, which is to say the ADP source the user chose.
 * Exporting the consensus order regardless would hand back a different board
 * from the one they are looking at, and the consensus is a column here anyway,
 * so nothing is lost by leaving the choice where it already lives.
 *
 * ESPN is written only where ESPN actually voted. It abstains on kickers and
 * defences, where its rank is roster convention rather than an opinion, and the
 * pool on screen hides it for exactly that reason. A file that showed it would
 * be claiming an opinion nobody held.
 */
export function boardCsv(players: Player[]): string {
  const lines = [HEADER.join(',')];

  players.forEach((p, i) => {
    lines.push([
      cell(i + 1),
      cell(p.name),
      cell(p.position),
      cell(p.team),
      cell(p.bye),
      cell(num(p.consensus)),
      cell(p.consensusSpread == null ? '' : Math.round(p.consensusSpread)),
      cell(p.consensusVotes ?? 0),
      cell(num(p.adp)),
      cell(num(p.sleeperAdp)),
      cell(num(p.ffcAdp)),
      cell(p.espnVotes ? num(p.espnPick) : ''),
      cell(p.espnVotes ? num(p.espnAdp) : ''),
      cell(p.espnVotes ? num(p.espnAuction) : ''),
      cell(num(p.points)),
      cell(p.injuryStatus),
    ].join(','));
  });

  return lines.join('\n') + '\n';
}

/** What the downloaded file is called, so two formats do not collide. */
export function boardFilename(meta: BoardMeta): string {
  return [
    'draft-board', meta.year, meta.format, meta.requestedLeagueSize + '-team',
  ].join('-') + '.csv';
}
