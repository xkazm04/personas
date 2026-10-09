// PROTOTYPE ROUND (spark council-readout), direction A. The member bar under a
// ledger title: one segment per member in rubric order, the fill its score,
// a notch where its floor sits, a tick at the bar, and a hatched empty
// segment for a member nobody measured (absence is never a zero). Under it a
// thin rule as long as the round's coverage.
//
// Plain boxes rather than SVG: the geometry is all fractions of a width, and
// CSS draws a crisp hairline at any width without a measured viewBox.
import type { Seat } from '../../../table/runModel';

interface Props {
  /** Null while the round is being read: ghost segments, never zeros. */
  seats: Seat[] | null;
  /** How many ghost segments to draw while `seats` is null. */
  members: number;
  threshold: number;
  coverage: number | null;
  /** Lite rounds draw hollow: readable, not decidable. */
  lite: boolean;
}

const pct = (ratio: number) => `${Math.max(0, Math.min(1, ratio)) * 100}%`;

export function MemberBar({ seats, members, threshold, coverage, lite }: Props) {
  return (
    <div className={`lg-bar${lite ? ' lite' : ''}`} aria-hidden="true">
      <div className="lg-segs">
        {seats
          ? seats.map((seat) => (
              <span
                key={seat.name}
                className={`lg-seg${seat.score == null ? ' nm' : ''}${seat.floorHit ? ' hit' : ''}`}
              >
                {seat.score != null ? <i className="lg-fill" style={{ width: pct(seat.score) }} /> : null}
                {seat.floor != null ? (
                  <b className={`lg-floor${seat.advisory ? ' adv' : ''}`} style={{ left: pct(seat.floor) }} />
                ) : null}
                <em className="lg-tick" style={{ left: pct(threshold) }} />
              </span>
            ))
          : Array.from({ length: members }, (_, i) => <span key={i} className="lg-seg ghost" />)}
      </div>
      <span className="lg-cov">
        {coverage != null ? <i style={{ width: pct(coverage) }} /> : null}
      </span>
    </div>
  );
}

export default MemberBar;
