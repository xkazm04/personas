/**
 * Convert a sigma deviation value into a user-friendly severity label
 * and multiplier string. Keeps the raw sigma available for tooltips.
 *
 * Thresholds:
 *   < 2.5σ  → "Unusual"  (low)
 *   < 3.5σ  → "High"     (medium)
 *   ≥ 3.5σ  → "Extreme"  (high)
 */

export type AnomalySeverity = 'unusual' | 'high' | 'extreme';

export interface AnomalyLabel {
  severity: AnomalySeverity;
  /** e.g. "2.3x above normal" */
  multiplier: string;
  /** Raw sigma kept for power-user tooltip */
  sigmaTooltip: string;
}

export function getAnomalyLabel(deviationSigma: number): AnomalyLabel {
  const severity: AnomalySeverity =
    deviationSigma >= 3.5 ? 'extreme' :
    deviationSigma >= 2.5 ? 'high' :
    'unusual';

  return {
    severity,
    multiplier: `${deviationSigma.toFixed(1)}x`,
    sigmaTooltip: `${deviationSigma.toFixed(1)}σ standard deviations from rolling average`,
  };
}

export const SEVERITY_STYLES: Record<AnomalySeverity, { text: string; bg: string; border: string }> = {
  unusual: { text: 'text-amber-300',  bg: 'bg-amber-500/15', border: 'border-amber-500/25' },
  high:    { text: 'text-orange-300', bg: 'bg-orange-500/15', border: 'border-orange-500/25' },
  extreme: { text: 'text-red-300',    bg: 'bg-red-500/15',    border: 'border-red-500/25' },
};
