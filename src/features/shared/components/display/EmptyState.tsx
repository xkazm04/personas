import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

/* ── Inline SVG illustrations (48×48, indigo/violet palette) ─────────── */

function ChartWaveSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#cw-bg)" />
      <path d="M10 32 C14 24, 18 28, 22 20 S30 16, 34 22 S38 26, 42 18" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M10 36 C16 30, 20 34, 26 28 S32 26, 38 30" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4" />
      <circle cx="22" cy="20" r="2" fill="#a78bfa" opacity="0.6" />
      <defs>
        <linearGradient id="cw-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ActivityPulseSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#ap-bg)" />
      <path d="M10 24 H16 L19 16 L23 32 L27 12 L31 28 L34 24 H42" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
      <circle cx="24" cy="24" r="3" fill="#a78bfa" opacity="0.25" />
      <defs>
        <linearGradient id="ap-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Celebratory "all clear" graphic for the alerts empty state — emerald palette
// + check-circle reads as "healthy", not "silenced". Replaced the prior
// strikethrough-bell because the only consumer (AlertHistoryPanel) renders
// this when zero alerts have ever fired, which is a good thing.
function AllClearSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#ac-bg)" />
      <circle cx="24" cy="24" r="11" stroke="#34d399" strokeWidth="2" fill="none" opacity="0.65" />
      <circle cx="24" cy="24" r="13.5" stroke="#34d399" strokeWidth="1" fill="none" opacity="0.25" />
      <path d="M19 24.5 L22.5 28 L29.5 20.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <defs>
        <linearGradient id="ac-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#10b981" stopOpacity="0.10" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function BarChartEmptySvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#bc-bg)" />
      <rect x="12" y="28" width="5" height="8" rx="1.5" fill="#818cf8" opacity="0.3" />
      <rect x="21.5" y="22" width="5" height="14" rx="1.5" fill="#818cf8" opacity="0.45" />
      <rect x="31" y="16" width="5" height="20" rx="1.5" fill="#818cf8" opacity="0.6" />
      <line x1="10" y1="38" x2="38" y2="38" stroke="#6366f1" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" />
      <defs>
        <linearGradient id="bc-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export type EmptyStateVariant = 'chart' | 'activity' | 'alerts' | 'metrics';

const VARIANT_SVG: Record<EmptyStateVariant, () => ReactNode> = {
  chart: ChartWaveSvg,
  activity: ActivityPulseSvg,
  alerts: AllClearSvg,
  metrics: BarChartEmptySvg,
};

function useVariantMap(): Record<EmptyStateVariant, { Svg: () => ReactNode; heading: string; description: string }> {
  const { t } = useTranslation();
  return {
    chart: { Svg: VARIANT_SVG.chart, heading: t.shared.empty_chart_heading, description: t.shared.empty_chart_description },
    activity: { Svg: VARIANT_SVG.activity, heading: t.shared.empty_activity_heading, description: t.shared.empty_activity_description },
    alerts: { Svg: VARIANT_SVG.alerts, heading: t.shared.empty_alerts_heading, description: t.shared.empty_alerts_description },
    metrics: { Svg: VARIANT_SVG.metrics, heading: t.shared.empty_metrics_heading, description: t.shared.empty_metrics_description },
  };
}

interface EmptyStateProps {
  /** Predefined variant with built-in illustration, heading, and description. */
  variant?: EmptyStateVariant;
  /** Override the heading text. */
  heading?: string;
  /** Override the description text. */
  description?: string;
  /** Extra CSS classes on the outer container. */
  className?: string;
}

export function EmptyState({ variant = 'chart', heading, description, className = '' }: EmptyStateProps) {
  const variantMap = useVariantMap();
  const preset = variantMap[variant];
  const { Svg } = preset;

  return (
    <div className={`flex flex-col items-center justify-center py-12 gap-3 ${className}`}>
      <Svg />
      <h4 className="typo-heading text-foreground">{heading ?? preset.heading}</h4>
      <p className="typo-body text-foreground max-w-xs text-center">{description ?? preset.description}</p>
    </div>
  );
}
