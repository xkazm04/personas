// Goal Acceptance View — the cross-project human-acceptance queue, opened from
// the title-bar tray. Fetches goals in `awaiting_acceptance` enriched with
// project + team + served KPI and renders the SHARED `GoalsTriage` in
// all-projects mode (a project heading above each project's KPI buckets).
//
// It used to render `AcceptanceTriagePolished`, a second implementation of the
// same idea; that file is gone. Accept/reject route through the store (which
// persists + refreshes the TitleBar badge count); the list refetches so
// resolved goals drop out immediately.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import * as devApi from '@/api/devTools/devTools';
import type { PendingAcceptanceGoal } from '@/lib/bindings/PendingAcceptanceGoal';

import { GoalsTriage } from './triage/GoalsTriage';
import type { GoalKpi, TriageGoal } from './triage/triageModel';

/** Backend rows → the triage shapes. Dedupes the KPI dimension; goals reference
 *  it by id. A KPI without both a current and a target reading is not measured,
 *  so those goals bucket as standalone rather than under a blank gauge. */
function adapt(rows: PendingAcceptanceGoal[]): { goals: TriageGoal[]; kpis: GoalKpi[] } {
  const kpis = new Map<string, GoalKpi>();
  const goals: TriageGoal[] = [];

  for (const r of rows) {
    const measured = r.kpi_id != null && r.kpi_current != null && r.kpi_target != null;
    if (measured && !kpis.has(r.kpi_id!)) {
      const up = r.kpi_direction !== 'down';
      const current = r.kpi_current!;
      const target = r.kpi_target!;
      kpis.set(r.kpi_id!, {
        id: r.kpi_id!,
        name: r.kpi_name ?? 'KPI',
        unit: r.kpi_unit ?? '',
        current,
        target,
        offTrack: up ? current < target : current > target,
      });
    }
    goals.push({
      id: r.goal_id,
      title: r.title,
      description: r.summary,
      status: 'awaiting_acceptance',
      progress: 100,
      startedAt: null,
      completedAt: r.completed_at,
      kpiId: measured ? r.kpi_id! : null,
      projectId: r.project_id,
      projectName: r.project_name,
    });
  }

  return { goals, kpis: [...kpis.values()] };
}

export function GoalAcceptanceView() {
  const acceptGoal = useSystemStore((s) => s.acceptGoal);
  const rejectGoal = useSystemStore((s) => s.rejectGoal);
  const [rows, setRows] = useState<PendingAcceptanceGoal[] | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const refetch = useCallback(async () => {
    try {
      setRows(await devApi.listPendingAcceptance());
    } catch (err) {
      silentCatch('GoalAcceptanceView.fetch')(err);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const data = useMemo(() => adapt(rows ?? []), [rows]);

  const mark = useCallback((ids: string[], on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  }, []);

  /** One refetch per batch — N accepts must not become N concurrent
   *  accept+refetch cycles racing to setRows. */
  const resolve = useCallback(async (ids: string[], op: (id: string) => Promise<void>) => {
    mark(ids, true);
    try {
      await Promise.all(ids.map(op));
      await refetch();
    } catch (err) {
      silentCatch('GoalAcceptanceView.resolve')(err);
    } finally {
      mark(ids, false);
    }
  }, [mark, refetch]);

  if (rows === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <GoalsTriage
      goals={data.goals}
      kpis={data.kpis}
      busyIds={busyIds}
      groupByProject
      onAccept={(id) => void resolve([id], acceptGoal)}
      onReject={(id, comment) => void resolve([id], (g) => rejectGoal(g, comment))}
      onAcceptAll={(ids) => void resolve(ids, acceptGoal)}
    />
  );
}
