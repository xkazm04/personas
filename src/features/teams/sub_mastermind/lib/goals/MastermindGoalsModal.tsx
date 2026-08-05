// Host for the Mastermind Goals modal — owns the data wiring (project goals
// from the scene store, accept/reject through the system store) and, for the
// duration of the prototype, a tab switcher across three directional variants.
//
// PROTOTYPE SCAFFOLD: the `variant` state + tab strip below are throwaway. On
// consolidation the winner becomes the sole body and this file keeps only the
// BaseModal shell + wiring.
import { useCallback, useState } from 'react';
import { Target } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useSceneStore } from '../sceneStore';
import { useSystemStore } from '@/stores/systemStore';
import { toastCatch } from '@/lib/silentCatch';

import type { KpiListItem } from '../KpiListPopover';
import { GoalsHeaderBand } from './goalsModalBits';
import { toRows, type GoalsModalProps } from './goalsModalModel';
import { GoalsWorkbenchVariant } from './GoalsWorkbenchVariant';
import { GoalsTriageVariant } from './GoalsTriageVariant';
import { GoalsBoardVariant } from './GoalsBoardVariant';

type Variant = 'workbench' | 'triage' | 'board';

const VARIANTS: readonly { id: Variant; label: string }[] = [
  { id: 'workbench', label: 'A · Workbench' },
  { id: 'triage', label: 'B · Triage' },
  { id: 'board', label: 'C · Board' },
];

export function MastermindGoalsModal({ slug, projectName, kpis, onClose }: {
  /** Project id — the scene store keys goals by it. */
  slug: string;
  projectName: string;
  /** The project's KPIs in KpiListPopover's row shape (built by the page). */
  kpis: KpiListItem[];
  onClose: () => void;
}) {
  const goals = useSceneStore((s) => s.goals.get(slug)) ?? EMPTY;
  const loadGoals = useSceneStore((s) => s.loadGoals);
  const acceptGoal = useSystemStore((s) => s.acceptGoal);
  const rejectGoal = useSystemStore((s) => s.rejectGoal);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [variant, setVariant] = useState<Variant>('workbench');

  const mark = useCallback((ids: string[], on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  }, []);

  /** One refetch per resolution batch — N accepts must not become N racing
   *  whole-portfolio goal reloads. */
  const resolve = useCallback(async (ids: string[], op: (id: string) => Promise<void>, what: string) => {
    mark(ids, true);
    try {
      await Promise.all(ids.map(op));
      await loadGoals();
    } catch (err) {
      toastCatch(`mastermind goals ${what}`)(err);
    } finally {
      mark(ids, false);
    }
  }, [mark, loadGoals]);

  const props: GoalsModalProps = {
    projectName,
    goals,
    kpis,
    busyIds,
    onAccept: (id) => void resolve([id], acceptGoal, 'accept'),
    onReject: (id, comment) => void resolve([id], (g) => rejectGoal(g, comment), 'reject'),
    onAcceptAll: (ids) => void resolve(ids, acceptGoal, 'accept all'),
  };

  const awaiting = toRows(goals, kpis).filter((r) => r.awaiting).length;

  return (
    <BaseModal isOpen onClose={onClose} titleId="mm-goals-title" size="lg" portal staggerChildren={false}>
      <div className="flex flex-col h-[540px]" data-testid="mm-goals-modal">
        <GoalsHeaderBand icon={Target} title="Goals" projectName={projectName} awaiting={awaiting}>
          <span id="mm-goals-title" className="sr-only">Goals — {projectName}</span>
          {/* PROTOTYPE ONLY — removed on consolidation. */}
          <SegmentedTabs
            tabs={VARIANTS.map((v) => ({ id: v.id, label: v.label }))}
            activeTab={variant}
            onTabChange={(v) => setVariant(v as Variant)}
            variant="pill"
            size="sm"
            fullWidth={false}
            ariaLabel="Prototype variant"
          />
        </GoalsHeaderBand>

        {variant === 'workbench' && <GoalsWorkbenchVariant {...props} />}
        {variant === 'triage' && <GoalsTriageVariant {...props} />}
        {variant === 'board' && <GoalsBoardVariant {...props} />}
      </div>
    </BaseModal>
  );
}

const EMPTY: never[] = [];
