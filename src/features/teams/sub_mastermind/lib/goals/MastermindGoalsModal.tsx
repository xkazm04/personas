// Project-scoped goal triage, opened from the canvas's Goals cell.
//
// Owns the wiring only: the project's goals from the scene store, its KPIs from
// the page (already reduced to KpiListPopover's row shape), and accept/reject
// through the system store. The surface itself is the shared `GoalsTriage` —
// the same component the title-bar tray renders across every project.
import { useCallback, useMemo, useState } from 'react';
import { Target } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { GoalsTriage } from '@/features/teams/sub_goals/triage/GoalsTriage';
import { TriageHeaderBand } from '@/features/teams/sub_goals/triage/triageBits';
import { toRows, type GoalKpi, type TriageGoal } from '@/features/teams/sub_goals/triage/triageModel';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import type { KpiListItem } from '../KpiListPopover';
import { useSceneStore } from '../sceneStore';

const EMPTY: never[] = [];

export function MastermindGoalsModal({ slug, projectName, kpis, onClose }: {
  /** Project id — the scene store keys goals by it. */
  slug: string;
  projectName: string;
  /** The project's KPIs in KpiListPopover's row shape (built by the page). */
  kpis: KpiListItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const devGoals = useSceneStore((s) => s.goals.get(slug)) ?? EMPTY;
  const loadGoals = useSceneStore((s) => s.loadGoals);
  const acceptGoal = useSystemStore((s) => s.acceptGoal);
  const rejectGoal = useSystemStore((s) => s.rejectGoal);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const goals = useMemo<TriageGoal[]>(() => devGoals.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    status: g.status,
    progress: g.progress,
    startedAt: g.started_at,
    completedAt: g.completed_at,
    kpiId: g.kpi_id,
    projectId: g.project_id,
  })), [devGoals]);

  // `unmeasured` KPIs have no reading; `met`/`ok` are on track.
  const triageKpis = useMemo<GoalKpi[]>(() => kpis.map((k) => ({
    id: k.id,
    name: k.name,
    unit: k.unit,
    current: k.current,
    target: k.target,
    offTrack: k.status === 'crit' || k.status === 'warn',
  })), [kpis]);

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

  const awaiting = toRows(goals, triageKpis).filter((r) => r.awaiting).length;

  return (
    <BaseModal isOpen onClose={onClose} titleId="mm-goals-title" size="lg" portal staggerChildren={false}>
      <div className="flex flex-col h-[540px]" data-testid="mm-goals-modal">
        <TriageHeaderBand icon={Target} title={t.plugins.dev_lifecycle.triage_title} subject={projectName} awaiting={awaiting}>
          <span id="mm-goals-title" className="sr-only">{t.plugins.dev_lifecycle.triage_title} — {projectName}</span>
        </TriageHeaderBand>

        <GoalsTriage
          goals={goals}
          kpis={triageKpis}
          busyIds={busyIds}
          onAccept={(id) => void resolve([id], acceptGoal, 'accept')}
          onReject={(id, comment) => void resolve([id], (g) => rejectGoal(g, comment), 'reject')}
          onAcceptAll={(ids) => void resolve(ids, acceptGoal, 'accept all')}
        />
      </div>
    </BaseModal>
  );
}
