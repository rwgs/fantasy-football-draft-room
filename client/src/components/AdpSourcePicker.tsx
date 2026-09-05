import { ADP_FEEDS, ADP_RULES, adpChoiceId, parseAdpChoice } from '../engine/types';

interface Props {
  /** The `adpSource` string in force, in either the current or an older form. */
  value: string;
  onChange: (value: string) => void;
  /**
   * The feeds this board could actually use. A room ADP only exists while a
   * draft is being followed, so it is offered in the assistant and nowhere
   * else. Absent until a board has been read, which is when nothing is offered
   * yet rather than when everything is.
   */
  offered?: string[];
  /** Short labels and no explanations, for the line above the player pool. */
  compact?: boolean;
}

/**
 * Which feeds price the board, and how they are put together.
 *
 * One component in two places on purpose. The same control answers the same
 * question in settings and over a live draft, and two implementations of it
 * would drift into disagreeing about what a choice means.
 *
 * Deselecting the last feed is refused rather than allowed and then corrected:
 * a board has to be priced by something, and the server would silently fall
 * back to Sleeper, which is a control that lies about what it did.
 */
export default function AdpSourcePicker(props: Props) {
  const { value, onChange, offered, compact } = props;
  const choice = parseAdpChoice(value);

  const toggle = (id: string) => {
    const feeds = choice.feeds.includes(id)
      ? choice.feeds.filter((f) => f !== id)
      : [...choice.feeds.filter((f) => f !== id), id];
    if (!feeds.length) return;
    onChange(adpChoiceId({ ...choice, feeds }));
  };

  return (
    <div className={'adp-picker' + (compact ? ' is-compact' : '')}>
      <div className="filter-row">
        {ADP_FEEDS.map((feed) => {
          const on = choice.feeds.includes(feed.id);
          // Offered is unknown until a board has been read. Treat that as "all
          // but the room", so the control is usable rather than dead on arrival.
          const usable = offered ? offered.includes(feed.id) : feed.id !== 'room';
          const only = on && choice.feeds.length === 1;
          return (
            <button
              key={feed.id}
              type="button"
              className="chip"
              aria-pressed={on}
              disabled={!usable || only}
              title={usable
                ? (only ? 'The board has to be priced by something.' : feed.what)
                : 'Only your own browser can read this, so it needs a live draft to follow.'}
              onClick={() => toggle(feed.id)}
            >
              {compact && feed.short ? feed.short : feed.label}
            </button>
          );
        })}
      </div>

      {/*
        * One feed is one feed however you say you would combine it, so the rule
        * is hidden rather than shown doing nothing.
        */}
      {choice.feeds.length > 1 && (
        <div className="filter-row sort-row">
          {!compact && <span className="eyebrow">Combine</span>}
          {ADP_RULES.map((rule) => (
            <button
              key={rule.id}
              type="button"
              className="chip"
              aria-pressed={choice.rule === rule.id}
              title={rule.what}
              onClick={() => onChange(adpChoiceId({ ...choice, rule: rule.id }))}
            >
              {rule.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
