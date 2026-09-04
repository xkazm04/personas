import { Layers } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CategoryCount } from '@/lib/bindings/CategoryCount';
import type { MemoryTierCounts } from '@/lib/bindings/MemoryTierCounts';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { TIER_ORDER, tierTotal, type TierKey } from './brainMath';
import { useBrainPalette } from './brainPalette';

/**
 * Memory tiers — a part-to-whole of what the persona actually holds, on the
 * ordinal ramp (core is the always-included budget, archive never reaches a
 * prompt, so the tiers are ORDERED and get one hue in four validated steps,
 * not four identities).
 *
 * A single stacked bar is drawn in plain markup: a one-row chart is not a
 * charting-library job, and hand-drawing it is what lets each segment carry a
 * 2px surface gap and a direct label.
 */
export function MemoryTiersTile({
  tiers,
  categories,
}: {
  tiers: MemoryTierCounts;
  categories: CategoryCount[];
}) {
  const { t, tx } = useTranslation();
  const b = t.agents.brain;
  const palette = useBrainPalette();
  const total = tierTotal(tiers);

  const label: Record<TierKey, string> = {
    core: b.tier_core,
    active: b.tier_active,
    working: b.tier_working,
    archived: b.tier_archived,
  };

  return (
    <SectionCard
      title={b.tiers_title}
      subtitle={total > 0 ? tx(b.tiers_total, { count: total }) : undefined}
      icon={<Layers className="w-3.5 h-3.5 text-primary" aria-hidden />}
    >
      <div data-testid="brain-tiers">
        {total === 0 ? (
          // Honest absence: no bar at all. A full-width zero track would read
          // as "measured and empty across the tiers" — it is neither.
          <EmptyState
            icon={Layers}
            title={b.tiers_empty_title}
            description={b.tiers_empty_desc}
            className="py-4"
          />
        ) : (
          <>
            <div className="flex gap-[2px] h-3 w-full" role="img" aria-label={b.tiers_title}>
              {TIER_ORDER.map((key, i) =>
                tiers[key] === 0 ? null : (
                  <Tooltip key={key} content={`${label[key]} · ${tiers[key]}`}>
                    <div
                      className="h-full first:rounded-l-pill last:rounded-r-pill"
                      style={{
                        width: `${(tiers[key] / total) * 100}%`,
                        backgroundColor: palette.ordinal[i],
                      }}
                    />
                  </Tooltip>
                ),
              )}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {TIER_ORDER.map((key, i) => (
                <li key={key} className="flex items-center gap-2 typo-caption">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: palette.ordinal[i] }}
                    aria-hidden
                  />
                  <span className="text-foreground/85 truncate">{label[key]}</span>
                  <Numeric className="ml-auto text-foreground" value={tiers[key]} unit="plain" />
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-4 pt-3 border-t border-primary/10">
          <p className="typo-overline text-foreground/85 mb-2">{b.categories_title}</p>
          {categories.length === 0 ? (
            <p className="typo-caption text-foreground/85">{b.categories_empty}</p>
          ) : (
            <CategoryBars categories={categories} color={palette.ordinal[1]!} />
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/** Magnitude by category — one hue, length carries the value. */
function CategoryBars({ categories, color }: { categories: CategoryCount[]; color: string }) {
  const max = categories.reduce((n, c) => Math.max(n, c.count), 0) || 1;
  const rows = [...categories].sort((a, b) => b.count - a.count).slice(0, 6);
  return (
    <ul className="space-y-1.5" data-testid="brain-categories">
      {rows.map((c) => (
        <li key={c.category} className="flex items-center gap-2">
          <span className="typo-caption text-foreground/85 w-24 truncate">{c.category}</span>
          <span className="flex-1 h-1.5 rounded-pill bg-secondary/40 overflow-hidden">
            <span
              className="block h-full rounded-pill"
              style={{ width: `${(c.count / max) * 100}%`, backgroundColor: color }}
            />
          </span>
          <Numeric className="typo-caption text-foreground w-8 text-right" value={c.count} unit="plain" />
        </li>
      ))}
    </ul>
  );
}
