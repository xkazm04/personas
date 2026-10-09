// PROTOTYPE ROUND (spark council-readout). One 0..1 track the whole Dossier
// draws with: a fill to the score, the bar as a full-height rule, a floor as
// a short notch. A null value is a HATCHED track - not measured is never an
// empty (zero) one.
export interface TrackProps {
  value: number | null;
  threshold?: number;
  floor?: number | null;
  /** A judged floor while uncalibrated: drawn dotted, never red. */
  advisory?: boolean;
  floorHit?: boolean;
  size: 'xs' | 'sm' | 'md' | 'lg';
  /** The span between the value and the bar, drawn as a dashed gap. */
  showGap?: boolean;
  /** Accessible reading of the whole track. */
  label: string;
}

const HEIGHT: Record<TrackProps['size'], string> = { xs: 'h-1.5', sm: 'h-2.5', md: 'h-3.5', lg: 'h-6' };

export function Track({ value, threshold, floor, advisory, floorHit, size, showGap, label }: TrackProps) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  const gap = showGap && value != null && threshold != null && value < threshold;
  return (
    <div role="img" aria-label={label} className={`dz-track relative ${HEIGHT[size]} ${value == null ? 'dz-hatch' : ''}`}>
      {value != null ? (
        <i
          aria-hidden="true"
          className={`dz-track__fill absolute inset-y-0 left-0 ${floorHit ? 'is-hit' : ''}`}
          style={{ width: pct(value) }}
        />
      ) : null}
      {gap ? (
        <i
          aria-hidden="true"
          className="dz-track__gap absolute inset-y-0"
          style={{ left: pct(value), width: pct(threshold - value) }}
        />
      ) : null}
      {floor != null ? (
        <i
          aria-hidden="true"
          className={`dz-track__floor absolute ${advisory ? 'is-advisory' : ''}`}
          style={{ left: pct(floor) }}
        />
      ) : null}
      {threshold != null ? (
        <i aria-hidden="true" className="dz-track__bar absolute" style={{ left: pct(threshold) }} />
      ) : null}
    </div>
  );
}
