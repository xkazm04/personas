// Goal Acceptance View — PROTOTYPE host. Round 4: Triage is the winner; this
// round polishes it. Two tabs, before/after, so the typography + grouping
// improvement is directly comparable:
//   · Polished — project grouping + KPI thin sub-dividers + a real type ladder
//   · Before   — the kept-baseline Triage (KPI-grouped, flat 14px typography)
//
// All variants receive identical core props (goals + teams + kpis + accept/reject
// handlers); the project-grouped variants also receive `projects`. The host owns
// resolution state so accepting removes a goal (real flow: → `done`, off the
// Board) and rejecting moves it (→ `in-progress`, Agent's turn, with the
// comment). Sample data for now (goalAcceptanceMock); live wiring follows
// winner-pick.
import { useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Undo2 } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { MOCK_PENDING_GOALS, MOCK_TEAMS, MOCK_KPIS, MOCK_PROJECTS } from './goalAcceptanceMock';
import { AcceptanceTriage } from './AcceptanceTriage';
import { AcceptanceTriagePolished } from './AcceptanceTriagePolished';

type VariantId = 'polished' | 'before';
type Resolution = { action: 'accepted' | 'rejected'; comment?: string };

export function GoalAcceptanceView() {
  const [variant, setVariant] = useState<VariantId>('polished');
  const [resolved, setResolved] = useState<Map<string, Resolution>>(new Map());

  const pending = useMemo(
    () => MOCK_PENDING_GOALS.filter((g) => !resolved.has(g.id)),
    [resolved],
  );

  const resolve = (goalId: string, res: Resolution) =>
    setResolved((prev) => new Map(prev).set(goalId, res));
  const onAccept = (goalId: string) => resolve(goalId, { action: 'accepted' });
  const onReject = (goalId: string, comment: string) => resolve(goalId, { action: 'rejected', comment });

  const accepted = [...resolved.values()].filter((r) => r.action === 'accepted').length;
  const rejected = [...resolved.values()].filter((r) => r.action === 'rejected').length;

  const shared = { goals: pending, teams: MOCK_TEAMS, kpis: MOCK_KPIS, onAccept, onReject };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SegmentedTabs<VariantId>
          variant="segment"
          fullWidth={false}
          ariaLabel="Acceptance view variant"
          activeTab={variant}
          onTabChange={setVariant}
          tabs={[
            { id: 'polished', label: 'Polished' },
            { id: 'before', label: 'Before' },
          ]}
        />
        {resolved.size > 0 && (
          <div className="flex items-center gap-3 typo-caption text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <CheckCircle2 className="w-3.5 h-3.5" /> {accepted} accepted
            </span>
            {rejected > 0 && (
              <span className="inline-flex items-center gap-1 text-[var(--destructive)]">
                <RotateCcw className="w-3.5 h-3.5" /> {rejected} sent back
              </span>
            )}
            <button
              type="button"
              onClick={() => setResolved(new Map())}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" /> reset
            </button>
          </div>
        )}
      </div>

      {variant === 'polished' && <AcceptanceTriagePolished {...shared} projects={MOCK_PROJECTS} />}
      {variant === 'before' && <AcceptanceTriage {...shared} />}
    </div>
  );
}
