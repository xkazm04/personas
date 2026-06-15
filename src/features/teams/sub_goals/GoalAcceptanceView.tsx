// Goal Acceptance View — the live human-acceptance queue (a real Goals view,
// reached from Teams › Goals › Accept). Fetches goals in `awaiting_acceptance`
// enriched with project + team + served KPI, groups them project → KPI, and
// lets the user accept (→ done, off-board) or reject (→ in-progress, with a
// comment) each one. Accept/reject route through the store (which persists +
// refreshes the TitleBar badge count); the list refetches so resolved goals
// drop out immediately.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import * as devApi from '@/api/devTools/devTools';
import type { PendingAcceptanceGoal } from '@/lib/bindings/PendingAcceptanceGoal';

import { adaptPendingAcceptance } from './goalAcceptanceMock';
import { AcceptanceTriagePolished } from './AcceptanceTriagePolished';

export function GoalAcceptanceView() {
  const acceptGoal = useSystemStore((s) => s.acceptGoal);
  const rejectGoal = useSystemStore((s) => s.rejectGoal);
  const [rows, setRows] = useState<PendingAcceptanceGoal[] | null>(null);

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

  const data = useMemo(() => adaptPendingAcceptance(rows ?? []), [rows]);

  const onAccept = useCallback(async (id: string) => {
    await acceptGoal(id);
    await refetch();
  }, [acceptGoal, refetch]);

  const onReject = useCallback(async (id: string, comment: string) => {
    await rejectGoal(id, comment);
    await refetch();
  }, [rejectGoal, refetch]);

  if (rows === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <AcceptanceTriagePolished
      goals={data.goals}
      teams={data.teams}
      kpis={data.kpis}
      projects={data.projects}
      onAccept={onAccept}
      onReject={onReject}
    />
  );
}
