// Category popover — opened by clicking a collapsed category cell at far/mid
// zoom. The cell says "something in Delivery is red"; this says which dimension
// and lets you act on it without zooming in first.
//
// Rows are the SAME dimension rows the island context menu renders (shared
// MenuGlyph, same actionable/inert convention), sorted worst status first, and
// an actionable row routes through the same onDimOpen the cell click uses.
import { useTranslation } from '@/i18n/useTranslation';

import { CATEGORY_ICON, STATUS_RANK, type CategoryNode } from './dimCategories';
import { MenuGlyph } from './IslandMenu';
import { DIM_INK, mix } from './ink';
import { ListPopover } from './ListPopover';
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
  const rows = [...category.nodes].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label),
  );

  return (
    <ListPopover
      title={t.mastermind[`dim_cat_${category.key}` as const]}
      icon={CATEGORY_ICON[category.key]}
      ink={DIM_INK[category.status]}
      trailing={tx(t.mastermind.dim_cat_summary, { solid: category.solid, total: category.total })}
      x={x}
      y={y}
      width={288}
      maxListHeight={280}
      testId={`mm-category-popover-${category.key}`}
      onClose={onClose}
    >
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
    </ListPopover>
  );
}
