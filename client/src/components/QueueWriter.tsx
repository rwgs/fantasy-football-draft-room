import type { QueuePriority, QueueWrite } from '../engine/types';

interface Props {
  value: QueueWrite;
  onChange: (next: QueueWrite) => void;
  priority: QueuePriority;
  onPriority: (next: QueuePriority) => void;
  /**
   * The queue the draft room itself holds, or null when it has not said.
   *
   * Null is reported rather than smoothed into an empty list, because the two
   * mean different things to the user: one is a queue they can see, the other
   * is a write they are about to make blind.
   */
  roomQueue: { id: string | null; name: string }[] | null;
  /** Star everything the room holds that this board can place. */
  onAdoptRoom: () => void;
  /** How many of the room's players are already starred here. */
  adopted: number;
}

const MODES: { id: QueueWrite; label: string; what: string }[] = [
  {
    id: 'off',
    label: 'Off',
    what: 'Nothing is sent to Yahoo. The bridge reads your draft and writes nothing.',
  },
  {
    id: 'mirror',
    label: 'Mirror',
    what: 'The players you star here are set as your queue in the draft room.',
  },
  {
    id: 'autodraft',
    label: 'Autodraft',
    what: 'Your stars, then the board’s own picks after them, so a clock that '
      + 'runs out takes a player worth having.',
  },
];

/**
 * Whether the players starred here are written into the real draft room.
 *
 * The only control in this app that changes something outside the browser, and
 * it opens off. What it writes is a queue, which is Yahoo's own feature: the
 * list the room drafts from when your clock expires. It never makes a pick.
 *
 * The line underneath is not decoration, it is the disclosure. Nothing can read
 * a Yahoo queue before writing one — no frame reports one unprompted and no
 * endpoint carries one — so the first write replaces a list nobody has seen.
 * Turning this on is the consent for that, and this is where it is said. See
 * `DECISIONS.md`.
 */
export default function QueueWriter(props: Props) {
  const { value, onChange, priority, onPriority, roomQueue, onAdoptRoom, adopted } = props;

  const unread = roomQueue == null;
  const placeable = (roomQueue || []).filter((entry) => entry.id).length;

  return (
    <div className="queue-writer">
      <div className="filter-row">
        <span className="eyebrow">Yahoo queue</span>
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className="chip"
            aria-pressed={value === mode.id}
            title={mode.what}
            onClick={() => onChange(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Both hidden when off, because there is nothing being written to order
          or to report on. Off is the state every user starts in, and a control
          that explains a refusal nobody has run into is noise in front of
          everybody to spare a sentence for the few who turn it on. */}
      {value !== 'off' && (
        <div className="filter-row sort-row">
          <span className="eyebrow">First</span>
          <button
            type="button"
            className="chip"
            aria-pressed={priority === 'app'}
            title="Your stars here go above whatever the draft room already had."
            onClick={() => onPriority('app')}
          >
            Mine
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={priority === 'yahoo'}
            title="Whatever the draft room already had stays above your stars here."
            onClick={() => onPriority('yahoo')}
          >
            Yahoo’s
          </button>
        </div>
      )}

      {value !== 'off' && (
        <p className="hint queue-writer-state">
          {unread
            ? 'A draft room never reports its queue until one changes, so the app '
              + 'cannot read yours: the first thing it writes replaces whatever is '
              + 'in there. After that it merges, and never drops an entry you '
              + 'made in Yahoo — only the ones it queued itself, when you '
              + 'un-star them here.'
            : (roomQueue.length
              ? 'The room holds ' + roomQueue.length + ': '
                + roomQueue.map((entry) => entry.name).join(', ')
              : 'The room’s queue is empty.')}
          {!unread && placeable > adopted && (
            <button type="button" className="btn is-quiet" onClick={onAdoptRoom}>
              {'Star ' + (placeable - adopted) + ' of them here'}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
