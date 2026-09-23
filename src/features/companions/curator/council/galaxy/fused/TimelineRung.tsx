// One rung of the altitude timeline. Three shapes, as in the winner:
//  - REACHED: the place you passed through, named; a click climbs to it;
//  - CURRENT: the counts card, its name large and the figures the soundings
//    below do not already carry;
//  - BELOW: a sounding, a log bar and a figure for how much lies under you
//    at that depth. A null figure reads "not measured", never a zero.
import type { ReactNode } from 'react';

import { useFusedStrings } from './fusedStrings';

export interface RungFigure {
  key: string;
  value: number | null;
  label: string;
  lit?: boolean;
}

interface Props {
  index: number;
  state: 'reached' | 'current' | 'below';
  tag: string;
  name: string;
  /** Reached rungs: climb here. */
  onClimb?: () => void;
  climbLabel?: string;
  figures?: RungFigure[];
  /** Below rungs: how much lies under you at that depth. */
  sounding?: { value: number | null; width: number; next: boolean; label: string };
  /** The current rung prints the keys that step to a neighbour. */
  neighbourKeys?: ReactNode;
  technique?: boolean;
}

export function TimelineRung({ index, state, tag, name, onClimb, climbLabel, figures, sounding, neighbourKeys, technique }: Props) {
  const s = useFusedStrings();
  if (state === 'reached') {
    return (
      <li className="rung reached" data-rung={index} data-role="hud-rung">
        <span className="tag">{tag}</span>
        <button className="nm" type="button" onClick={onClimb} aria-label={climbLabel}>
          {name}
        </button>
        <span />
      </li>
    );
  }
  if (state === 'current') {
    return (
      <li className={`rung current${technique ? ' tech' : ''}`} data-rung={index} data-role="hud-rung">
        <span className="tag">
          {tag}
          {neighbourKeys}
        </span>
        <div className="nm">{name}</div>
        <div className="figs">
          {(figures ?? []).map((fig) =>
            fig.value == null ? (
              <div key={fig.key} className="fig nm2" data-role="hud-fig">
                <b>{s.f.not_measured}</b>
                <span>{fig.label}</span>
              </div>
            ) : (
              <div key={fig.key} className={`fig${fig.lit ? ' lit' : ''}`} data-role="hud-fig">
                <b>{s.n(fig.value)}</b>
                <span>{fig.label}</span>
              </div>
            ),
          )}
        </div>
      </li>
    );
  }
  return (
    <li className="rung below" data-rung={index} data-role="hud-rung">
      <span className="tag">{tag}</span>
      {sounding && sounding.value != null ? (
        <span className="sound" aria-label={sounding.label} data-role="hud-sounding">
          <i style={{ width: sounding.width }} />
          <b>{s.n(sounding.value)}</b>
          {sounding.next ? <span>{s.f.below}</span> : null}
        </span>
      ) : (
        <span className="nm" style={{ cursor: 'default' }}>
          {s.f.not_measured}
        </span>
      )}
      <span />
    </li>
  );
}

export default TimelineRung;
