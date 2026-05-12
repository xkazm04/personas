import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/* ── Inline SVG illustrations (48x48, indigo/violet palette) ─────────── */

function AreaChartSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#ce-area-bg)" />
      <path d="M10 32 C14 24, 18 28, 22 20 S30 16, 34 22 S38 26, 42 18" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M10 36 C16 30, 20 34, 26 28 S32 26, 38 30" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4" />
      <circle cx="22" cy="20" r="2" fill="#a78bfa" opacity="0.6" />
      <defs>
        <linearGradient id="ce-area-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function BarChartSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#ce-bar-bg)" />
      <rect x="12" y="28" width="5" height="8" rx="1.5" fill="#818cf8" opacity="0.3" />
      <rect x="21.5" y="22" width="5" height="14" rx="1.5" fill="#818cf8" opacity="0.45" />
      <rect x="31" y="16" width="5" height="20" rx="1.5" fill="#818cf8" opacity="0.6" />
      <line x1="10" y1="38" x2="38" y2="38" stroke="#6366f1" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" />
      <defs>
        <linearGradient id="ce-bar-bg" x1="4" y1="4" x2="44" y2="44">
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
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#ce-pulse-bg)" />
      <path d="M10 24 H16 L19 16 L23 32 L27 12 L31 28 L34 24 H42" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
      <circle cx="24" cy="24" r="3" fill="#a78bfa" opacity="0.25" />
      <defs>
        <linearGradient id="ce-pulse-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function HealingSvg() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="8" fill="url(#ce-heal-bg)" />
      <path d="M24 14 L24 34 M14 24 L34 24" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <circle cx="24" cy="24" r="10" stroke="#34d399" strokeWidth="1.5" fill="none" opacity="0.3" />
      <circle cx="24" cy="24" r="4" fill="#34d399" opacity="0.2" />
      <defs>
        <linearGradient id="ce-heal-bg" x1="4" y1="4" x2="44" y2="44">
          <stop stopColor="#10b981" stopOpacity="0.08" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Variant → illustration mapping ──────────────────────────────────── */

export type ChartEmptyVariant = 'area' | 'bar' | 'trace' | 'healing';

const VARIANT_SVG: Record<ChartEmptyVariant, () => ReactNode> = {
  area: AreaChartSvg,
  bar: BarChartSvg,
  trace: ActivityPulseSvg,
  healing: HealingSvg,
};

/* ── Component ───────────────────────────────────────────────────────── */

interface ChartEmptyAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

interface ChartEmptyStateProps {
  variant: ChartEmptyVariant;
  title: string;
  description: string;
  action?: ChartEmptyAction;
  className?: string;
}

export function ChartEmptyState({ variant, title, description, action, className = '' }: ChartEmptyStateProps) {
  const Svg = VARIANT_SVG[variant];
  const ActionIcon = action?.icon;

  return (
    <div className={`animate-fade-scale-in flex flex-col items-center justify-center text-center gap-3 py-8 ${className}`}>
      <Svg />
      <h4 className="typo-heading text-primary text-[14px] [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
        {title}
      </h4>
      <p className="typo-body text-foreground max-w-[36ch]">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-interactive border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
        >
          {ActionIcon && <ActionIcon className="w-3.5 h-3.5" />}
          {action.label}
        </button>
      )}
    </div>
  );
}
