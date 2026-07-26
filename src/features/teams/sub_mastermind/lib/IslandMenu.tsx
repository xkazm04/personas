// Context menu for a project header (right-click): the island's dimensions
// sorted by name, with the same glyphs the cells render (brand mark when the
// tool is identified). Hovering a row highlights the matching hex/grid cell on
// the canvas so the mapping is unambiguous.
//
// Row click mirrors the canvas cell exactly: the island's nodes arrive already
// decorated with `action`/`rowKey` (MastermindPage's dimAction pass), so an
// actionable row routes through the SAME onDimOpen the cell click uses —
// Improve/Deploy popover, idea-scan popover, goal list, skills run. Inert
// dimensions render as plain rows with no affordance (the canvas convention:
// a cell that can't act shows no pointer and no hover ring).
import type { MouseEvent } from 'react';
import { Rocket, SquareTerminal } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { categoryNodes, STATUS_RANK } from './dimCategories';
import { dimBrand } from './dimMeta';
import { DIM_REGISTRY } from './dimRegistry';
import { DIM_INK, mix } from './ink';
import type { DimNode, Island } from './types';

/** A dimension's glyph for DOM menus (brand mark when the tool is identified,
 *  otherwise the registry's lucide outline). Shared with CategoryPopover so the
 *  two dimension lists can't drift. */
export function MenuGlyph({ node }: { node: DimNode }) {
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
  const Icon = entry?.icon;
  if (!Icon) return null;
  return <Icon className="w-[15px] h-[15px] shrink-0" strokeWidth={1.75} style={{ color: ink }} aria-hidden />;
}

export function IslandMenu({ island, x, y, terminalEnabled, onOpenTerminal, onDispatchFleet, onDimOpen, onHoverDim, onClose }: {
  island: Island;
  /** Screen-space anchor (cursor position, clamped by the caller). */
  x: number;
  y: number;
  /** Whether a Fleet session can be spawned for this project (real repo root).
   *  Gates both the terminal and the dispatch rows. */
  terminalEnabled: boolean;
  /** "Open terminal" action — spawn a Fleet session in the project root. */
  onOpenTerminal: () => void;
  /** "Dispatch Fleet…" action — open the instruction modal for a background run. */
  onDispatchFleet: () => void;
  /** Actionable dimension row clicked — routed to the page's cell handler, so
   *  the row opens exactly what clicking the cell on the canvas would. */
  onDimOpen: (node: DimNode, e: MouseEvent) => void;
  onHoverDim: (key: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Grouped by category, worst status first inside each — the same shape the
  // collapsed island shows at far zoom, so right-clicking a four-cell island
  // doesn't hand back a flat alphabetical list of fifteen unrelated names.
  const groups = categoryNodes(island.nodes).map((c) => ({
    key: c.key,
    nodes: [...c.nodes].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label)),
  }));
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
      {/* action rows — spawn a Fleet session in the project root: an empty
          interactive terminal, or a background run seeded with an instruction */}
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
        <button
          type="button"
          disabled={!terminalEnabled}
          title={terminalTitle}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-input typo-body transition-colors text-foreground/70 enabled:hover:bg-secondary/40 enabled:hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={terminalEnabled ? () => { onDispatchFleet(); onHoverDim(null); } : undefined}
          data-testid="mm-menu-dispatch-fleet"
        >
          <Rocket className="w-[15px] h-[15px] shrink-0" strokeWidth={1.75} aria-hidden />
          <span>{t.mastermind.dispatch_fleet}</span>
        </button>
      </div>
      <div className="max-h-[300px] overflow-y-auto py-1">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="px-3 pt-1.5 pb-1 typo-caption text-foreground/45 uppercase tracking-wider">
              {t.mastermind[`dim_cat_${group.key}` as const]}
            </div>
            <ul>
        {group.nodes.map((n) => {
          const absent = n.status === 'absent';
          // Same gate the canvas cell uses — the node arrives pre-decorated.
          const actionable = Boolean(n.action);
          const body = (
            <>
              <MenuGlyph node={n} />
              <span className={absent ? 'text-foreground/50' : undefined}>{n.label}</span>
              <span className="ml-auto typo-caption text-foreground/50 truncate max-w-[150px]" style={absent ? { color: mix('var(--muted-foreground)', 80) } : undefined}>
                {n.detail ?? (absent ? t.mastermind.cell_empty : '')}
              </span>
            </>
          );
          const layout = 'w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-md typo-body';
          return (
            <li key={n.key}>
              {actionable ? (
                <button
                  type="button"
                  className={`${layout} transition-colors text-foreground/70 hover:bg-secondary/40 hover:text-foreground focus-ring`}
                  onMouseEnter={() => onHoverDim(n.key)}
                  onMouseLeave={() => onHoverDim(null)}
                  onClick={(e) => { onDimOpen(n, e); onClose(); }}
                  data-testid={`mm-menu-dim-${n.key}`}
                >
                  {body}
                </button>
              ) : (
                <div
                  className={`${layout} text-foreground/70 cursor-default`}
                  onMouseEnter={() => onHoverDim(n.key)}
                  onMouseLeave={() => onHoverDim(null)}
                  data-testid={`mm-menu-dim-${n.key}`}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
