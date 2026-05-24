import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';

/* ── Inline SVG illustrations (48×48, indigo/violet palette) ─────────── */
/* The `chart` variant and the four widget variants (todos / stream /
 * routines / heatmap) animate on mount only (entry-only) so dashboard
 * empty states read like the polished Activity/Executions motifs without
 * looping motion. The older static variants are left untouched. */

function ChartWaveSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#cw-bg)" />
      <motion.path
        d="M10 32 C14 24, 18 28, 22 20 S30 16, 34 22 S38 26, 42 18"
        stroke="#818cf8" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.7"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: 'easeInOut' }}
      />
      <motion.path
        d="M10 36 C16 30, 20 34, 26 28 S32 26, 38 30"
        stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.15, ease: 'easeInOut' }}
      />
      <motion.circle cx="22" cy="20" r="2" fill="#a78bfa" opacity="0.6"
        initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.6 }} transition={{ delay: 0.7, duration: 0.3 }} />
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

// "All caught up" — checklist whose final item resolves into a check badge.
// Emerald, so an empty triage queue reads as a good thing.
function TodosClearSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#td-bg)" />
      <motion.line x1="16" y1="18" x2="32" y2="18" stroke="#34d399" strokeWidth="2" strokeLinecap="round" opacity="0.4"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.1 }} />
      <motion.line x1="16" y1="24" x2="29" y2="24" stroke="#34d399" strokeWidth="2" strokeLinecap="round" opacity="0.28"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.22 }} />
      <motion.g initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.35 }}>
        <circle cx="28" cy="31" r="8" fill="#10b981" fillOpacity="0.15" stroke="#34d399" strokeWidth="1.5" />
        <path d="M24.5 31 L27 33.5 L31.5 28.5" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </motion.g>
      <defs>
        <linearGradient id="td-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#10b981" stopOpacity="0.10" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Event stream — a timeline rail with log rows dropping in top-to-bottom,
// like events arriving live.
function StreamFlowSvg() {
  const rows = [16, 24, 32];
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#sf-bg)" />
      <line x1="15" y1="14" x2="15" y2="34" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      {rows.map((y, i) => (
        <motion.g key={i}
          initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.12 + i * 0.13, duration: 0.35 }}>
          <circle cx="15" cy={y} r="2.5" fill="#818cf8" />
          <line x1="21" y1={y} x2={34 - i * 3} y2={y} stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" opacity={0.55 - i * 0.12} />
        </motion.g>
      ))}
      <defs>
        <linearGradient id="sf-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Upcoming routines — a clock whose schedule ring sweeps in on mount.
function RoutinesClockSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#rt-bg)" />
      <circle cx="24" cy="24" r="9" stroke="#6366f1" strokeWidth="1.5" fill="none" opacity="0.22" />
      <motion.circle cx="24" cy="24" r="13" stroke="#818cf8" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5"
        initial={{ pathLength: 0 }} animate={{ pathLength: 0.7 }} transition={{ duration: 0.9, ease: 'easeInOut' }} />
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.4 }}>
        <line x1="24" y1="24" x2="24" y2="18" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />
        <line x1="24" y1="24" x2="28" y2="26" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        <circle cx="24" cy="24" r="1.5" fill="#a78bfa" />
      </motion.g>
      <defs>
        <linearGradient id="rt-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Fleet activity (contribution heatmap) — a grid of cells fading in with
// varying intensity, echoing the real heatmap it stands in for.
function HeatmapGridSvg() {
  const intensities = [0.18, 0.32, 0.5, 0.68];
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#hm-bg)" />
      {Array.from({ length: 4 }).map((_, r) =>
        Array.from({ length: 4 }).map((_, c) => {
          const i = r * 4 + c;
          return (
            <motion.rect key={i} x={13 + c * 6} y={13 + r * 6} width="4.5" height="4.5" rx="1.2" fill="#818cf8"
              initial={{ opacity: 0 }} animate={{ opacity: intensities[(r + c) % 4] }}
              transition={{ delay: 0.04 * i, duration: 0.3 }} />
          );
        }),
      )}
      <defs>
        <linearGradient id="hm-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export type EmptyStateVariant =
  | 'chart' | 'activity' | 'alerts' | 'metrics'
  | 'todos' | 'stream' | 'routines' | 'heatmap';

const VARIANT_SVG: Record<EmptyStateVariant, () => ReactNode> = {
  chart: ChartWaveSvg,
  activity: ActivityPulseSvg,
  alerts: AllClearSvg,
  metrics: BarChartEmptySvg,
  todos: TodosClearSvg,
  stream: StreamFlowSvg,
  routines: RoutinesClockSvg,
  heatmap: HeatmapGridSvg,
};

function useVariantMap(): Record<EmptyStateVariant, { Svg: () => ReactNode; heading: string; description: string }> {
  const { t } = useTranslation();
  return {
    chart: { Svg: VARIANT_SVG.chart, heading: t.shared.empty_chart_heading, description: t.shared.empty_chart_description },
    activity: { Svg: VARIANT_SVG.activity, heading: t.shared.empty_activity_heading, description: t.shared.empty_activity_description },
    alerts: { Svg: VARIANT_SVG.alerts, heading: t.shared.empty_alerts_heading, description: t.shared.empty_alerts_description },
    metrics: { Svg: VARIANT_SVG.metrics, heading: t.shared.empty_metrics_heading, description: t.shared.empty_metrics_description },
    todos: { Svg: VARIANT_SVG.todos, heading: t.shared.empty_todos_heading, description: t.shared.empty_todos_description },
    stream: { Svg: VARIANT_SVG.stream, heading: t.shared.empty_stream_heading, description: t.shared.empty_stream_description },
    routines: { Svg: VARIANT_SVG.routines, heading: t.shared.empty_routines_heading, description: t.shared.empty_routines_description },
    heatmap: { Svg: VARIANT_SVG.heatmap, heading: t.shared.empty_heatmap_heading, description: t.shared.empty_heatmap_description },
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
  /**
   * Dominant layout: the illustration is enlarged into a faint, full-bleed
   * watermark behind a single heading (no description). Used by the Home
   * dashboard widgets so the empty state reads as a promoted background rather
   * than a small centered glyph. Leaves the default centered layout untouched
   * for the other consumers (alerts / metrics panels, etc.).
   */
  dominant?: boolean;
}

export function EmptyState({ variant = 'chart', heading, description, className = '', dominant = false }: EmptyStateProps) {
  const variantMap = useVariantMap();
  const preset = variantMap[variant];
  const { Svg } = preset;

  if (dominant) {
    return (
      <div className={`relative flex items-center justify-center overflow-hidden min-h-[7rem] ${className}`}>
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-20"
          aria-hidden
        >
          <div className="origin-center scale-[3.25]"><Svg /></div>
        </div>
        <h4 className="relative typo-heading text-foreground text-center px-4">{heading ?? preset.heading}</h4>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-12 gap-3 ${className}`}>
      <Svg />
      <h4 className="typo-heading text-foreground">{heading ?? preset.heading}</h4>
      <p className="typo-body text-foreground max-w-xs text-center">{description ?? preset.description}</p>
    </div>
  );
}
