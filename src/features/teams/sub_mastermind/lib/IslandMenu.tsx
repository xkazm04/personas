// Context menu for a project header (right-click): the island's dimensions
// sorted by name, with the same glyphs the cells render (brand mark when the
// tool is identified). Hovering a row highlights the matching hex/grid cell on
// the canvas so the mapping is unambiguous. Item click is a no-op for now —
// the per-dimension action layer comes later.
import { dimBrand, DIM_ICON } from './dimMeta';
import { DIM_INK, mix } from './ink';
import type { DimNode, Island } from './types';

const COPY = { empty: 'not set up' };

function MenuGlyph({ node }: { node: DimNode }) {
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
  const Icon = DIM_ICON[node.key];
  return <Icon className="w-[15px] h-[15px] shrink-0" strokeWidth={1.75} style={{ color: ink }} aria-hidden />;
}

export function IslandMenu({ island, x, y, onHoverDim, onClose }: {
  island: Island;
  /** Screen-space anchor (cursor position, clamped by the caller). */
  x: number;
  y: number;
  onHoverDim: (key: string | null) => void;
  onClose: () => void;
}) {
  const items = [...island.nodes].sort((a, b) => a.label.localeCompare(b.label));
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
      <ul className="max-h-[300px] overflow-y-auto py-1">
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
