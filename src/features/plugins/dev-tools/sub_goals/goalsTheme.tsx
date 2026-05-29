/**
 * Goals v2 shared visual language.
 *
 * Adapts the platform visual-identity philosophy (depth via low-opacity gradient
 * pools, motion as information, constraint/accent-parameterization) to the
 * desktop's own semantic tokens — no raw hex, no web-only primitives. Every
 * Goals surface (Board · Map · Timeline · Portfolio · Attention) composes from
 * these so the look stays cohesive and a tweak is a one-file edit.
 */
import type { CSSProperties, ReactNode } from 'react';
import { goalStatusMeta } from './goalStatus';

/**
 * The shared panel treatment: a soft gradient base (depth without a heavy box)
 * + a GPU-compositable hover lift + border brighten. Targeted transition (never
 * `transition-all`); fully neutralized under `prefers-reduced-motion`.
 */
export const GOAL_PANEL =
  'rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 ' +
  'transition-[transform,border-color,box-shadow] duration-200 ' +
  'hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-elevation-2 ' +
  'motion-reduce:transform-none motion-reduce:transition-none focus-ring';

/** A status-tinted left edge so a card's state reads pre-attentively. */
export function goalAccentEdgeStyle(status: string): CSSProperties {
  return { boxShadow: `inset 3px 0 0 0 ${goalStatusMeta(status).map.fill}` };
}

/**
 * A near-invisible radial "atmosphere" pool seated behind a surface — the
 * depth-without-clutter layer. Violet (the Goals accent) at ~6% so it registers
 * subconsciously. Decorative + inert.
 */
export function GoalAtmosphere({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 ${className}`}
      style={{
        background:
          'radial-gradient(120% 70% at 50% -10%, rgba(139,92,246,0.07), transparent 55%)',
      }}
    />
  );
}

/** Section header: a short status-neutral accent bar + uppercase tracking label. */
export function SectionLabel({
  children,
  accent = 'bg-primary/50',
  count,
}: {
  children: ReactNode;
  accent?: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-3 w-0.5 rounded-full ${accent}`} />
      <h3 className="typo-caption uppercase tracking-[0.18em] text-foreground">{children}</h3>
      {count !== undefined && (
        <span className="typo-caption text-foreground tabular-nums">{count}</span>
      )}
    </div>
  );
}
