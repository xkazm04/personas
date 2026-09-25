import { useMemo } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { categoryMeta, categoryLabel } from '../categoryMeta';
import type { DirectorVerdictRow } from '@/api/director';

/**
 * Portfolio issue-mix readout — every coaching verdict rolled up by category
 * (prompt / health / triggers / …) so the user sees *what kinds* of problems
 * dominate across all agents, not just per-agent in the detail modal. Reuses the
 * shared categoryMeta palette; sorted most-frequent first with a proportion bar.
 */
export function CategoryRollup({ verdicts }: { verdicts: DirectorVerdictRow[] }) {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of verdicts) {
      if (v.category) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [verdicts]);

  if (rows.length === 0) {
    return <p className="typo-caption text-foreground py-2">{t.director.category_rollup_empty}</p>;
  }

  const max = Math.max(...rows.map((r) => r.count));

  return (
    <div className="space-y-1.5">
      {rows.map(({ category, count }) => {
        const meta = categoryMeta(category);
        const Icon = meta.icon;
        return (
          <div key={category} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3">
            <span className="inline-flex items-center gap-1.5 typo-caption text-foreground min-w-0">
              <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: meta.color }} />
              <span className="truncate">{categoryLabel(t, category)}</span>
            </span>
            <span className="h-1.5 rounded-pill bg-secondary/50 overflow-hidden">
              <span className="block h-full rounded-pill" style={{ width: `${(count / max) * 100}%`, background: meta.color }} />
            </span>
            <Numeric value={count} className="typo-caption text-foreground tabular-nums text-right" />
          </div>
        );
      })}
    </div>
  );
}
