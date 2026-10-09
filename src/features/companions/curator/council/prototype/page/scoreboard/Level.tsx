// PROTOTYPE ROUND (spark council-readout). The water level every band column
// draws: 0 at the bottom, 1 at the top, the fill risen to the score, the bar
// as a dashed rule at the same height in every column (so across the band it
// reads as ONE line), a floor as a notch on the right edge. A null score is a
// hatched column at full reach - never an empty one.
import type { ReactNode } from 'react';

export function Level({
  value,
  threshold,
  floor,
  advisory,
  floorHit,
  barTag,
}: {
  value: number | null;
  threshold: number;
  floor?: number | null;
  advisory?: boolean;
  floorHit?: boolean;
  /** Printed once, on the anchor column: the bar's own value. */
  barTag?: ReactNode;
}) {
  const at = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div aria-hidden="true" className={`sb-level ${value == null ? 'is-hatch' : ''}`}>
      {value != null ? <i className={`sb-level__fill ${floorHit ? 'is-hit' : ''}`} style={{ height: at(value) }} /> : null}
      {floor != null ? <i className={`sb-level__floor ${advisory ? 'is-advisory' : ''}`} style={{ bottom: at(floor) }} /> : null}
      <i className="sb-level__bar" style={{ bottom: at(threshold) }} />
      {barTag ? (
        <span className="sb-level__tag typo-label text-foreground" style={{ bottom: at(threshold) }}>
          {barTag}
        </span>
      ) : null}
    </div>
  );
}
