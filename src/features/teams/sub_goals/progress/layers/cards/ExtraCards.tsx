/**
 * The cards beside the milestones: the project's unbound goals as a dashed
 * card (it opens L2 with `UNASSIGNED`), the ghost card that creates a
 * milestone, and the calm placeholders while the lanes are still loading.
 */
import { Inbox, Plus } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { goalStatusMeta } from '../../../goalStatus';
import { CardShell } from './CardShell';

export function UnassignedCard({ goals, onOpen }: { goals: DevGoal[]; onOpen: () => void }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  return (
    <CardShell
      onPress={onOpen}
      testId="layers-cards-unassigned"
      className="h-full min-h-56 flex flex-col gap-3 px-5 pt-5 pb-4 rounded-card border-2 border-dashed border-primary/20 bg-secondary/10 hover:bg-secondary/25"
    >
      <span className="flex items-center gap-2">
        <Inbox className="w-5 h-5 text-primary" aria-hidden />
        <span className="typo-section-title">{dl.layers_unassigned}</span>
      </span>
      <span className="typo-body text-foreground">{dl.layers_unassigned_hint}</span>
      {/* The unbound goals as a row of status dots: how much is loose, and in what state. */}
      <span className="flex flex-wrap gap-1.5" aria-hidden>
        {goals.slice(0, 24).map((g) => (
          <span key={g.id} className="w-3 h-3 rounded-full" style={{ backgroundColor: goalStatusMeta(g.status).map.fill }} />
        ))}
      </span>
      <span className="mt-auto pt-2 border-t border-primary/10 typo-caption tabular-nums">
        {tx(dl.layers_goal_count, { count: goals.length })}
      </span>
    </CardShell>
  );
}

export function AddMilestoneCard({ onAdd, busy }: { onAdd: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  return (
    <CardShell
      onPress={onAdd}
      disabled={busy}
      testId="layers-cards-add-milestone"
      className="h-full min-h-56 flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-primary/15 text-primary hover:bg-primary/5 hover:border-primary/35"
    >
      <span className="w-11 h-11 rounded-full grid place-items-center bg-primary/10">
        <Plus className="w-5 h-5" aria-hidden />
      </span>
      <span className="typo-heading text-primary">{dl.layers_add_milestone}</span>
    </CardShell>
  );
}

/** Ghost-under-chrome: the grid's shape, quiet, while `useProjectLayer` is null. */
export function GhostCards({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          aria-hidden
          data-testid="layers-cards-ghost"
          className="min-h-56 rounded-card border border-primary/10 bg-secondary/15 p-5 flex flex-col gap-3"
        >
          <span className="h-5 w-2/3 rounded-full bg-secondary/40" />
          <span className="h-3 w-full rounded-full bg-secondary/25" />
          <span className="h-3 w-4/5 rounded-full bg-secondary/25" />
          <span className="mt-auto h-3 w-1/3 rounded-full bg-secondary/30" />
        </div>
      ))}
    </>
  );
}
