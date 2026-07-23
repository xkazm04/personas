// Context menu for a project header (right-click): the island's dimensions
// sorted by name, with the same glyphs the cells render (brand mark when the
// tool is identified). Hovering a row highlights the matching hex/grid cell on
// the canvas so the mapping is unambiguous. Item click is a no-op for now —
// the per-dimension action layer comes later.
import { SquareTerminal } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { dimBrand } from './dimMeta';
import { DIM_REGISTRY } from './dimRegistry';
import { GLYPH_SETS, useIconSet } from './iconSet';
import { DIM_INK, mix } from './ink';
import type { DimNode, Island } from './types';

const COPY = { empty: 'not set up' };

function MenuGlyph({ node }: { node: DimNode }) {
  const set = useIconSet();
  const entry = DIM_REGISTRY[node.key];
  const absent = node.status === 'absent';
  const brand = !absent ? dimBrand(node) : null;
  const ink = absent ? 'var(--muted-foreground)' : DIM_INK[node.status];
  if (brand) {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill={brand.icon.color ?? 'currentColor'} style={{ color: ink }} aria-hidden className="shrink-0">
        <path d={brand.icon.path} />
      </svg>
    );
  }
  // Drawn sets (forge/concept) with lucide fallback for glyph-less dimensions.
  const glyph = set !== 'line' ? (GLYPH_SETS[set][node.key] as (() => React.ReactNode) | undefined) : undefined;
  if (glyph) {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" style={{ color: ink }} aria-hidden className="shrink-0">
        {glyph()}
      </svg>
    );
  }
  const Icon = entry?.icon;
  if (!Icon) return null;
  return <Icon className="w-[15px] h-[15px] shrink-0" strokeWidth={1.75} style={{ color: ink }} aria-hidden />;
}

export function IslandMenu({ island, x, y, terminalEnabled, onOpenTerminal, onHoverDim, onClose }: {
  island: Island;
  /** Screen-space anchor (cursor position, clamped by the caller). */
  x: number;
  y: number;
  /** Whether an interactive terminal can be spawned for this project. */
  terminalEnabled: boolean;
  /** "Open terminal" action — spawn a Fleet session in the project root. */
  onOpenTerminal: () => void;
  onHoverDim: (key: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const items = [...island.nodes].sort((a, b) => a.label.localeCompare(b.label));
  const isDemo = island.slug.startsWith('demo-');
  const terminalTitle = terminalEnabled
    ? undefined
    : isDemo ? t.mastermind.terminal_disabled_demo : t.mastermind.terminal_disabled_no_path;
  return (
    <div
      className="absolute z-30 w-[307px] rounded-card border border-primary/15 bg-secondary/95 backdrop-blur-sm shadow-elevation-4 overflow-hidden"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerLeave={() => onHoverDim(null)}
      data-testid="mm-island-menu"
    >
      {/* header styled like the app sidebar's section header */}
      <div className="px-3 py-2 border-b border-primary/10 bg-primary/5">
        <span className="typo-label text-foreground/90 truncate block">{island.name}</span>
      </div>
      {/* action row — spawn an interactive terminal in the project root */}
      <div className="py-1 border-b border-primary/10">
        <button
          type="button"
          disabled={!terminalEnabled}
          title={terminalTitle}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-input typo-body transition-colors text-foreground/70 enabled:hover:bg-secondary/40 enabled:hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={terminalEnabled ? () => { onOpenTerminal(); onHoverDim(null); } : undefined}
          data-testid="mm-menu-open-terminal"
        >
          <SquareTerminal className="w-[15px] h-[15px] shrink-0" strokeWidth={1.75} aria-hidden />
          <span>{t.mastermind.open_terminal}</span>
        </button>
      </div>
      <ul className="max-h-[260px] overflow-y-auto py-1">
        {items.map((n) => {
          const absent = n.status === 'absent';
          return (
            <li key={n.key}>
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-md typo-body transition-colors text-foreground/70 hover:bg-secondary/40 hover:text-foreground"
                onMouseEnter={() => onHoverDim(n.key)}
                onMouseLeave={() => onHoverDim(null)}
                onClick={onClose}
                data-testid={`mm-menu-dim-${n.key}`}
              >
                <MenuGlyph node={n} />
                <span className={absent ? 'text-foreground/50' : undefined}>{n.label}</span>
                <span className="ml-auto typo-caption text-foreground/50 truncate max-w-[150px]" style={absent ? { color: mix('var(--muted-foreground)', 80) } : undefined}>
                  {n.detail ?? (absent ? COPY.empty : '')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
