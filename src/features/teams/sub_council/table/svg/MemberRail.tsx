// The member rail: one member's score against its threshold and its floor,
// on a 0..1 track. The rail and its legend are the only place the page
// explains what dotted / striped / hatched mean, and the legend sits
// directly under the rail it explains.
import type { Seat } from '../runModel';

export interface RailLabels {
  threshold: string;
  bindingFloor: string;
  advisoryFloor: string;
  carried: string;
  notMeasured: string;
}

export function MemberRail({ seat, ariaLabel }: { seat: Seat; ariaLabel: string }) {
  const notMeasured = seat.score == null;
  const track = notMeasured
    ? 'bg-[repeating-linear-gradient(135deg,var(--border)_0_6px,transparent_6px_12px)] ring-1 ring-inset ring-border'
    : 'bg-border';
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={`relative h-[15px] flex-none rounded-card ${track}`}
    >
      {seat.floor != null ? (
        <i
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 rounded-l-card ${
            seat.advisory ? 'bg-muted-dark/20' : 'bg-status-error/20'
          }`}
          style={{ width: `${seat.floor * 100}%` }}
        />
      ) : null}
      {seat.score != null ? (
        <>
          <i
            aria-hidden="true"
            className={`absolute inset-y-0 left-0 rounded-card ${
              seat.floorHit
                ? 'bg-status-error'
                : seat.state === 'carried'
                  ? 'bg-[repeating-linear-gradient(135deg,var(--primary)_0_5px,transparent_5px_9px)] ring-[1.5px] ring-inset ring-primary'
                  : 'bg-gradient-to-r from-primary/50 to-primary'
            }`}
            style={{ width: `${seat.score * 100}%` }}
          />
          <i
            aria-hidden="true"
            className={`absolute top-1/2 h-[19px] w-[19px] -mt-[9.5px] -ml-[9.5px] rounded-full border-[3px] bg-background shadow-elevation-1 ${
              seat.floorHit ? 'border-status-error' : 'border-primary'
            }`}
            style={{ left: `${seat.score * 100}%` }}
          />
        </>
      ) : null}
      <i
        aria-hidden="true"
        className="absolute -top-[7px] -bottom-[7px] -ml-px w-0.5 bg-foreground"
        style={{ left: `${seat.threshold * 100}%` }}
      />
      {seat.floor != null ? (
        <i
          aria-hidden="true"
          className={`absolute -top-1 -bottom-1 -ml-px w-0 border-l-2 ${
            seat.advisory ? 'border-dotted border-muted' : 'border-status-error'
          }`}
          style={{ left: `${seat.floor * 100}%` }}
        />
      ) : null}
    </div>
  );
}

/** The five marks the rail can carry, named once, under the rail. */
export function RailLegend({ labels }: { labels: RailLabels }) {
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-x-[18px] gap-y-1.5 typo-caption text-muted">
      <LegendKey swatch={<i className="inline-block h-3.5 w-0 border-l-2 border-foreground" />} text={labels.threshold} />
      <LegendKey
        swatch={<i className="inline-block h-3.5 w-0 border-l-2 border-status-error" />}
        text={labels.bindingFloor}
      />
      <LegendKey
        swatch={<i className="inline-block h-3.5 w-0 border-l-2 border-dotted border-muted" />}
        text={labels.advisoryFloor}
      />
      <LegendKey
        swatch={
          <i className="inline-block h-2.5 w-[18px] rounded border-[1.5px] border-primary bg-[repeating-linear-gradient(135deg,var(--primary)_0_3px,transparent_3px_6px)]" />
        }
        text={labels.carried}
      />
      <LegendKey
        swatch={
          <i className="inline-block h-2.5 w-[18px] rounded border border-border bg-[repeating-linear-gradient(135deg,var(--border)_0_3px,transparent_3px_6px)]" />
        }
        text={labels.notMeasured}
      />
    </div>
  );
}

function LegendKey({ swatch, text }: { swatch: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      {swatch}
      {text}
    </span>
  );
}

export default MemberRail;
