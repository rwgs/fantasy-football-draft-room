import { describeLean } from '../engine/forecast';
import { pickLabelWithOverall } from '../picks';
import type { Forecast } from '../engine/forecast';
import type { PositionValue } from '../engine/value';

interface Props {
  /**
   * Every position priced for this pick. Worked out by the screen rather than
   * here, because the same reading is also sent to the Yahoo draft room and
   * running it twice a render is running the whole board twice.
   */
  rows: PositionValue[];
  teams: number;
  myNextPick: number | null;
  /**
   * This room simulated forward from its real picks, when there are enough of
   * them. It replaces the ADP reading rather than sitting beside it: both
   * answer the same question and only one of them has seen the draft.
   */
  room: Forecast | null;
}

/**
 * What this pick buys you over the next one, position by position.
 *
 * The survival bar next to a player answers "will he last". This answers the
 * question you actually have on the clock, which is whether that matters. A
 * back with a 20 per cent chance of lasting is a crisis when the next back is
 * forty points worse and a shrug when the next one is three points worse, and
 * only the second number tells the two apart.
 *
 * The bars are scaled against the costliest position rather than a fixed span,
 * because the interesting reading is which position to spend on, and late in a
 * draft every real number is small.
 */
export default function ValuePanel(props: Props) {
  const { rows, teams, myNextPick, room } = props;

  if (myNextPick == null || !rows.length) return null;

  const lean = room ? describeLean(room.lean) : null;
  const top = rows[0].cost;
  // Under about a point of drop off there is nothing to choose between the
  // positions, and a bar chart of noise reads as a recommendation.
  const flat = top < 1;

  return (
    <div className="value-panel">
      <div className="panel-head">
        <h2 className="eyebrow">Cost of waiting</h2>
        <span className="hint">{'to ' + pickLabelWithOverall(myNextPick, teams)}</span>
      </div>

      {room && lean && <p className="value-lean">{lean}</p>}

      <div className="value-rows">
        {flat && (
          <p className="hint value-flat">
            Every position holds up until your next pick. Take the best player on your board.
          </p>
        )}
        {rows.map((row) => (
          <div className="value-row" key={row.position} data-pos={row.position}>
            <span className="pos-tag">{row.position}</span>
            <div className="value-body">
              <div className="value-line">
                <span className="value-name">{row.best?.name ?? '—'}</span>
                <span className="value-cost">
                  {row.cost >= 0.5 ? '−' + row.cost.toFixed(0) : '0'}
                </span>
              </div>
              <div className="value-bar">
                <div
                  className="value-fill"
                  style={{ width: (top > 0 ? Math.max(0, row.cost / top) * 100 : 0) + '%' }}
                />
              </div>
              <p className="value-note">
                {Math.round(row.odds * 100) + '% he lasts'}
                {' · '}
                {room
                  ? room.taken[row.position].toFixed(1) + ' go first'
                  : (row.beforeCliff === 1
                    ? 'then a drop'
                    : row.beforeCliff + ' before the drop')}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="hint value-foot">
        {room
          ? 'Points over a replacement starter, lost by waiting one turn. Read from '
            + room.sims + ' runs of this room, off the real picks and the real rosters.'
          : 'Points over a replacement starter, lost by waiting one turn. Read off '
            + 'ADP, not this room, so a run already under way will not show.'}
      </p>
    </div>
  );
}
