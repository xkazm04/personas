// Shared chrome for the topic graph: zoom rail, the node info card, and the
// SVG label primitive. Everything the sky's geometry is NOT about lives here
// so a tweak lands once.
import { Minus, Plus, RotateCcw } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { labelScale } from './useGraphCanvas';

export function ZoomRail({
  k,
  zoomBy,
  reset,
}: {
  k: number;
  zoomBy: (f: number) => void;
  reset: () => void;
}) {
  const { t } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const btn =
    'flex items-center justify-center w-7 h-7 rounded-interactive border border-border/60 bg-secondary/80 text-foreground/80 hover:text-foreground hover:bg-secondary transition-colors';
  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col items-center gap-1.5">
      <button type="button" aria-label={w.graph_zoom_in} className={btn} onClick={() => zoomBy(1.35)}>
        <Plus className="w-3.5 h-3.5" />
      </button>
      <span className="typo-caption text-foreground/50 tabular-nums select-none">
        {Math.round(k * 100)}%
      </span>
      <button type="button" aria-label={w.graph_zoom_out} className={btn} onClick={() => zoomBy(1 / 1.35)}>
        <Minus className="w-3.5 h-3.5" />
      </button>
      <Tooltip content={w.graph_reset}>
        <button type="button" aria-label={w.graph_reset} className={btn} onClick={reset}>
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

/** Counter-scaled SVG label: geometry zooms, type barely does. Anchor the
 *  parent `<g>` at the node position; this handles the rest.
 *
 *  `pinned` (core + L1 titles) uses the Mastermind idiom — full 1/k
 *  counter-scale, clamped — so those names hold a constant, readable screen
 *  size at every zoom. Unpinned (cluster) labels keep the soft k^-0.62 curve
 *  so detail type still recedes a little as you fly out. */
export function NodeLabel({
  k,
  dy,
  text,
  sub,
  fill = 'currentColor',
  opacity = 1,
  size = 12,
  weight = 500,
  anchor = 'middle',
  pinned = false,
}: {
  k: number;
  dy: number;
  text: string;
  sub?: string;
  fill?: string;
  opacity?: number;
  size?: number;
  weight?: number;
  anchor?: 'middle' | 'start';
  pinned?: boolean;
}) {
  if (opacity <= 0.02) return null;
  const s = pinned ? Math.min(2.6, Math.max(0.8, 1 / k)) : labelScale(k);
  return (
    <g transform={`scale(${s})`} opacity={opacity} pointerEvents="none">
      <text
        y={dy / s}
        textAnchor={anchor}
        fill={fill}
        fontSize={size}
        fontWeight={weight}
        className="select-none"
        style={{ paintOrder: 'stroke', stroke: 'var(--background)', strokeWidth: 3, strokeOpacity: 0.55 }}
      >
        {text}
      </text>
      {sub && (
        <text
          y={dy / s + size + 2}
          textAnchor={anchor}
          fill={fill}
          fontSize={size - 2}
          fontWeight={400}
          opacity={0.62}
          className="select-none tabular-nums"
          style={{ paintOrder: 'stroke', stroke: 'var(--background)', strokeWidth: 3, strokeOpacity: 0.55 }}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

/** Deterministic pseudo-random in [0,1) from a string — variants use it for
 *  organic jitter that must not reshuffle between renders or sessions. */
export function hashJitter(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
