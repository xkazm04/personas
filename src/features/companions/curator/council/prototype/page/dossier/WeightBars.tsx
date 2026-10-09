// PROTOTYPE ROUND (spark council-readout). The Dossier's member figure: one
// band per member, as TALL as its weight and as LONG as its score, so each
// band's area is what that member contributes to the overall. The bar runs
// through every band as one rule; a member never measured is a hatched band
// at full reach, never an empty one.
import type { MouseEvent } from 'react';

import type { Seat } from '../../../table/runModel';
import { memberName, sectionId, useScore } from './format';
import { S } from './strings';

/** Figure height spent on bands; a band never shrinks below a readable line. */
const HEIGHT = 220;
const MIN_BAND = 32;

export function WeightBars({ seats, onJump }: { seats: Seat[]; onJump: (key: string) => void }) {
  const score = useScore();
  const total = seats.reduce((n, s) => n + (s.weight || 0), 0) || 1;
  const threshold = seats[0]?.threshold ?? 0.7;
  const jump = (key: string) => (e: MouseEvent) => {
    e.preventDefault();
    onJump(key);
  };
  return (
    <figure className="m-0 flex flex-col gap-3" aria-label={S.figure}>
      <figcaption className="typo-eyebrow text-muted">{S.members}</figcaption>
      <div className="flex flex-col gap-1.5">
        {seats.map((seat) => {
          const h = Math.max(MIN_BAND, (seat.weight / total) * HEIGHT);
          const measured = seat.score != null;
          return (
            <a
              key={seat.name}
              href={`#${sectionId(`member-${seat.name}`)}`}
              onClick={jump(`member-${seat.name}`)}
              className="dz-wbar focus-ring"
              style={{ height: h }}
            >
              <span className="flex flex-col justify-center">
                <span className="typo-heading">{memberName(seat.name)}</span>
              </span>
              <span className={`dz-wbar__plate ${measured ? '' : 'dz-hatch'}`}>
                {measured ? (
                  <i
                    aria-hidden="true"
                    className={`dz-wbar__fill ${seat.floorHit ? 'is-hit' : ''}`}
                    style={{ width: `${(seat.score as number) * 100}%` }}
                  />
                ) : null}
                <i aria-hidden="true" className="dz-wbar__bar" style={{ left: `${threshold * 100}%` }} />
              </span>
              <span
                className={`flex items-center justify-end typo-data ${
                  measured ? (seat.floorHit ? 'text-status-error' : 'text-foreground') : 'text-muted'
                }`}
              >
                {measured ? score(seat.score as number) : '–'}
              </span>
            </a>
          );
        })}
      </div>
      <p className="m-0 typo-body text-muted">{S.figureHint}</p>
    </figure>
  );
}
