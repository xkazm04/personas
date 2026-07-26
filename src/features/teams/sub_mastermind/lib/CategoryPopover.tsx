// Category popover — opened by clicking a collapsed category cell at far/mid
// zoom. The cell says "something in Delivery is red"; this says which dimension
// and lets you act on it without zooming in first.
//
// Rows are the SAME dimension rows the island context menu renders (shared
// MenuGlyph, same actionable/inert convention), sorted worst status first, and
// an actionable row routes through the same onDimOpen the cell click uses.
import { useEffect, useRef } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { CATEGORY_ICON, STATUS_RANK, type CategoryNode } from './dimCategories';
import { MenuGlyph } from './IslandMenu';
import { DIM_INK, mix } from './ink';
import type { DimNode } from './types';

export function CategoryPopover({ category, x, y, onDimOpen, onClose }: {
  category: CategoryNode;
  /** Viewport-space anchor (clamped by the caller). */
  x: number;
  y: number;
  onDimOpen: (node: DimNode, e: React.MouseEvent) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const Icon = CATEGORY_ICON[category.key];
  const ink = DIM_INK[category.status];
  const rows = [...category.nodes].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label),
  );

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-[288px] rounded-card border border-primary/15 bg-secondary/95 backdrop-blur-sm shadow-elevation-4 overflow-hidden"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid={`mm-category-popover-${category.key}`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-primary/5">
        <Icon className="w-4 h-4 shrink-0" style={{ color: ink }} aria-hidden />
        <span className="typo-label text-foreground/90">{t.mastermind[`dim_cat_${category.key}` as const]}</span>
        <span className="ml-auto typo-caption text-foreground/50 tabular-nums">
          {tx(t.mastermind.dim_cat_summary, { solid: category.solid, total: category.total })}
        </span>
      </div>
      <ul className="max-h-[280px] overflow-y-auto py-1">
        {rows.map((n) => {
          const absent = n.status === 'absent';
          const actionable = Boolean(n.action);
          const body = (
            <>
              <MenuGlyph node={n} />
              <span className={absent ? 'text-foreground/50' : undefined}>{n.label}</span>
              <span className="ml-auto typo-caption text-foreground/50 truncate max-w-[140px]" style={absent ? { color: mix('var(--muted-foreground)', 80) } : undefined}>
                {n.detail ?? (absent ? t.mastermind.cell_empty : '')}
              </span>
            </>
          );
          const layout = 'w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-md typo-body text-foreground/70';
          return (
            <li key={n.key}>
              {actionable ? (
                <button
                  type="button"
                  className={`${layout} transition-colors hover:bg-secondary/40 hover:text-foreground focus-ring`}
                  onClick={(e) => { onDimOpen(n, e); onClose(); }}
                  data-testid={`mm-category-dim-${n.key}`}
                >
                  {body}
                </button>
              ) : (
                <div className={`${layout} cursor-default`} data-testid={`mm-category-dim-${n.key}`}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
