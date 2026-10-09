// PROTOTYPE ROUND (spark council-readout, direction H). The members as one
// compact figure: a bar per member filled to its score, the bar of the
// rubric drawn ONCE as a line running down through all of them, and each
// member's own floor as a notch. A member that was not measured is an empty
// dashed track that says so - absence, never a zero.
import type { Seat } from '../../../table/runModel';
import { GAP_HATCH, MemberIcon, TONE_TEXT, toneOf, useMemberName, useScore } from '../findings/marks';

const S = {
  label: 'The council members and their scores',
  none: 'not measured',
  bar: 'bar',
};

const FILL = {
  none: '',
  floor: 'bg-status-error',
  under: 'bg-primary',
  clear: 'bg-status-success',
} as const;

const ROW = 'flex h-8 items-center';
const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;

export function MemberColumns({ seats }: { seats: Seat[] }) {
  const score = useScore();
  const name = useMemberName();
  const threshold = seats[0]?.threshold ?? 0.7;
  return (
    <figure className="m-0 flex w-full items-stretch gap-4" aria-label={S.label}>
      <div className="flex flex-col">
        {seats.map((seat) => (
          <span key={seat.name} className={`${ROW} gap-2.5`}>
            <span className={seat.score == null ? 'text-muted' : 'text-primary'}>
              <MemberIcon name={seat.name} className="h-5 w-5" />
            </span>
            <span className={`typo-body-lg capitalize ${seat.score == null ? 'text-muted' : 'text-foreground'}`}>
              {name(seat.name)}
            </span>
          </span>
        ))}
      </div>
      <div className="relative min-w-[7rem] flex-1">
        {seats.map((seat) => {
          const tone = toneOf(seat);
          return (
            <div key={seat.name} className={ROW}>
              {seat.score == null ? (
                <span className="relative z-[1] rounded-pill border border-dashed border-muted-dark bg-background px-3 typo-body text-muted">
                  {S.none}
                </span>
              ) : (
                <span className="relative h-4 w-full rounded-pill bg-foreground/[0.08]">
                  {seat.score != null ? (
                    <>
                      <span
                        className={`absolute inset-y-0 left-0 rounded-pill ${FILL[tone]}`}
                        style={{ width: pct(seat.score) }}
                      />
                      {seat.score < threshold ? (
                        <span
                          className="absolute inset-y-0 rounded-pill"
                          style={{
                            left: pct(seat.score),
                            width: pct(threshold - seat.score),
                            backgroundImage: GAP_HATCH,
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {seat.floor != null ? (
                    <span className="absolute -inset-y-1 w-0.5 bg-status-error" style={{ left: pct(seat.floor) }} />
                  ) : null}
                </span>
              )}
            </div>
          );
        })}
        {/* The bar: one line through every member, labelled once at its foot. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 top-1 w-0.5 rounded-pill bg-foreground"
          style={{ left: pct(threshold) }}
        />
      </div>
      <div className="flex flex-col items-end">
        {seats.map((seat) => (
          <span key={seat.name} className={`${ROW} typo-data tabular-nums ${TONE_TEXT[toneOf(seat)]}`}>
            {seat.score == null ? null : score(seat.score)}
          </span>
        ))}
      </div>
    </figure>
  );
}
