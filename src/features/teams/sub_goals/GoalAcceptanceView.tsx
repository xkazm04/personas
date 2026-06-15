// Goal Acceptance View — PROTOTYPE host. Renders three directional variants of
// the human-acceptance queue behind a tab switcher so we can A/B them live:
//   · Ledger        — strict team-column × goal-row matrix, KPI bands (dense)
//   · Outcome Board  — KPI cluster panels, gauge-as-hero (card-forward)
//   · Triage Console — collapsible sections, batch-accept (throughput)
//
// All three receive identical props (pending goals + teams + kpis + accept/
// reject handlers). The host owns the resolution state so accepting removes a
// goal from the queue (the real flow: → `done`, off the Board) and rejecting
// moves it (the real flow: → `in-progress`, Agent's turn, with the comment).
// Sample data for now (goalAcceptanceMock); live wiring follows winner-pick.
import { useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Undo2 } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { MOCK_PENDING_GOALS, MOCK_TEAMS, MOCK_KPIS } from './goalAcceptanceMock';
import { AcceptanceLedger } from './AcceptanceLedger';
import { AcceptanceOutcomeBoard } from './AcceptanceOutcomeBoard';
import { AcceptanceTriage } from './AcceptanceTriage';

type VariantId = 'ledger' | 'board' | 'triage';
type Resolution = { action: 'accepted' | 'rejected'; comment?: string };

export function GoalAcceptanceView() {
  const [variant, setVariant] = useState<VariantId>('ledger');
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
            { id: 'ledger', label: 'Ledger' },
            { id: 'board', label: 'Outcome Board' },
            { id: 'triage', label: 'Triage' },
          ]}
        />
        {resolved.size > 0 && (
          <div className="flex items-center gap-3 typo-caption text-foreground/60">
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

      {variant === 'ledger' && <AcceptanceLedger {...shared} />}
      {variant === 'board' && <AcceptanceOutcomeBoard {...shared} />}
      {variant === 'triage' && <AcceptanceTriage {...shared} />}
    </div>
  );
}
