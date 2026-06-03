/**
 * SignalMeter — compact meter for a normalized 0..1 signal (source relevance,
 * hypothesis/finding confidence). A 4px rounded-full track with a fill whose
 * color steps by threshold — low / medium / high — using status tokens, plus
 * an optional trailing percentage. One shared primitive so signal strength
 * reads consistently everywhere it appears across Research Lab, instead of
 * each surface re-deriving its own bare-percentage or one-off bar.
 */

type SignalTier = 'low' | 'medium' | 'high';

const FILL_BY_TIER: Record<SignalTier, string> = {
  high: 'bg-status-success',
  medium: 'bg-status-warning',
  low: 'bg-status-error',
};

function tierFor(pct: number): SignalTier {
  if (pct >= 0.7) return 'high';
  if (pct >= 0.4) return 'medium';
  return 'low';
}

interface SignalMeterProps {
  /** Normalized 0..1 value; clamped to range, non-finite treated as 0. */
  value: number;
  /** Accessible name for the measurement (e.g. "Relevance", "Confidence"). */
  ariaLabel: string;
  /** Render the numeric percentage after the track. Default true. */
  showValue?: boolean;
  /** Tailwind width utility for the track. Default 'w-20'. */
  widthClass?: string;
  className?: string;
}

export function SignalMeter({
  value,
  ariaLabel,
  showValue = true,
  widthClass = 'w-20',
  className = '',
}: SignalMeterProps) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const rounded = Math.round(pct * 100);
  const tier = tierFor(pct);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        role="meter"
        aria-label={ariaLabel}
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${rounded}%`}
        className={`h-1 ${widthClass} rounded-full bg-foreground/10 overflow-hidden`}
      >
        <div
          className={`h-full rounded-full ${FILL_BY_TIER[tier]} transition-[width] duration-300`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      {showValue && (
        <span className="typo-micro text-foreground tabular-nums">{rounded}%</span>
      )}
    </div>
  );
}
