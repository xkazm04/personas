// Shared chrome for the topic-graph variants: zoom rail, the node info card,
// and the SVG label primitive all three skies use. Variants differ in
// geometry; everything a variant is NOT about lives here so a tweak lands
// once. (Prototype round — user-facing strings extracted to i18n at
// consolidation per /prototype Phase 5.)
import { Minus, Plus, RotateCcw } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { areaTheme } from '../practiceAreaTheme';
import type { ClusterNode } from './graphModel';
import type { KnowledgeItemView } from '../libraryModel';
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
  const btn =
    'flex items-center justify-center w-7 h-7 rounded-interactive border border-border/60 bg-secondary/80 text-foreground/80 hover:text-foreground hover:bg-secondary transition-colors';
  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col items-center gap-1.5">
      <button type="button" aria-label="Zoom in" className={btn} onClick={() => zoomBy(1.35)}>
        <Plus className="w-3.5 h-3.5" />
      </button>
      <span className="typo-caption text-foreground/50 tabular-nums select-none">
        {Math.round(k * 100)}%
      </span>
      <button type="button" aria-label="Zoom out" className={btn} onClick={() => zoomBy(1 / 1.35)}>
        <Minus className="w-3.5 h-3.5" />
      </button>
      <Tooltip content="Reset view">
        <button type="button" aria-label="Reset view" className={btn} onClick={reset}>
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

/** Pinned card for the selected cluster — the concrete "what is actually in
 *  this node" answer: status split plus the newest practice titles. */
export function ClusterCard({
  node,
  onOpenItem,
  onClose,
}: {
  node: ClusterNode;
  onOpenItem?: (item: KnowledgeItemView) => void;
  onClose: () => void;
}) {
  const theme = areaTheme(node.topic);
  return (
    <div className="absolute left-3 bottom-3 z-10 w-80 max-w-[calc(100%-6rem)] rounded-card border border-border/70 bg-background/95 backdrop-blur-sm shadow-elevation-3 p-3 animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <span className={`typo-label inline-flex px-1.5 py-0.5 rounded-interactive ${theme.chip}`}>
          {node.topic}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="typo-caption text-foreground/50 hover:text-foreground transition-colors"
        >
          ✕
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3 typo-caption text-foreground/70">
        <span className="text-foreground typo-data-md tabular-nums">{node.count}</span>
        <span>practices</span>
        {node.pending > 0 && (
          <span className="text-status-warning tabular-nums">{node.pending} pending</span>
        )}
        {node.adopted > 0 && (
          <span className="text-status-success tabular-nums">{node.adopted} adopted</span>
        )}
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {node.items.slice(0, 4).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpenItem?.(item)}
              className="w-full text-left typo-caption text-foreground/85 hover:text-foreground truncate transition-colors"
              title={item.title}
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${
                  item.status === 'adopted' ? 'bg-status-success' : 'bg-status-warning'
                }`}
                aria-hidden
              />
              {item.title}
            </button>
          </li>
        ))}
        {node.items.length > 4 && (
          <li className="typo-caption text-foreground/45">+{node.items.length - 4} more</li>
        )}
      </ul>
    </div>
  );
}

/** Counter-scaled SVG label: geometry zooms, type barely does. Anchor the
 *  parent `<g>` at the node position; this handles the rest. */
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
}) {
  if (opacity <= 0.02) return null;
  const s = labelScale(k);
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
