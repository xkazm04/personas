import { ShieldAlert, Settings, CalendarClock, PlayCircle, RefreshCw } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { PersonaBudgetState, BudgetStatus } from '@/stores/slices/agents/budgetEnforcementSlice';
import { useTranslation } from '@/i18n/useTranslation';

interface BudgetRecoveryCardProps {
  budgetStatus: BudgetStatus;
  budgetEntry: PersonaBudgetState | undefined;
  isBudgetBlocked: boolean;
  onOverrideBudget: () => void;
  onOverrideStale: () => void;
}

function getResetDate(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const diffDays = Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays === 1 ? 'tomorrow' : `in ${diffDays} days`;
}

export function BudgetRecoveryCard({
  budgetStatus,
  budgetEntry,
  isBudgetBlocked,
  onOverrideBudget,
  onOverrideStale,
}: BudgetRecoveryCardProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

  if (budgetStatus === 'warning') {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-modal border border-amber-500/15 bg-amber-500/5">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
        <p className="typo-body text-amber-400/80">
          {e.approaching_budget}
          {budgetEntry && <span className="text-amber-400/60"> -- ${budgetEntry.spend.toFixed(2)} / ${budgetEntry.maxBudget?.toFixed(2)} ({Math.round(budgetEntry.ratio * 100)}%)</span>}
        </p>
      </div>
    );
  }

  if (budgetStatus === 'exceeded') {
    return (
      <div className="rounded-modal border border-red-500/20 bg-red-500/5 overflow-hidden">
        <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2">
          <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="typo-heading text-red-400/90">{e.budget_exceeded}</p>
            {budgetEntry && (
              <p className="typo-body text-red-400/60">
                {tx(e.budget_spend_detail, {
                  spend: budgetEntry.spend.toFixed(2),
                  limit: budgetEntry.maxBudget?.toFixed(2) ?? '?',
                  percent: String(Math.round(budgetEntry.ratio * 100)),
                })}
              </p>
            )}
          </div>
        </div>
        {isBudgetBlocked && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3 pt-1">
            <button
              data-testid="runner-budget-override"
              onClick={onOverrideBudget}
              className="flex items-center gap-1.5 px-2.5 py-1.5 typo-body rounded-card border border-red-500/20 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              {e.run_anyway_session}
            </button>
            <button
              onClick={() => setEditorTab('settings')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 typo-body rounded-card border border-border/30 text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              {e.raise_budget}
            </button>
            <span className="flex items-center gap-1.5 typo-body text-foreground">
              <CalendarClock className="w-3.5 h-3.5" />
              {tx(e.resets_in, { days: getResetDate() })}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (budgetStatus === 'stale') {
    return (
      <div className="rounded-modal border border-amber-500/20 bg-amber-500/5 overflow-hidden">
        <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="typo-heading text-amber-400/90">{e.budget_unavailable}</p>
            <p className="typo-body text-amber-400/60">
              {e.budget_unavailable_detail}
            </p>
          </div>
        </div>
        {isBudgetBlocked && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3 pt-1">
            <button
              onClick={onOverrideStale}
              className="flex items-center gap-1.5 px-2.5 py-1.5 typo-body rounded-card border border-amber-500/20 text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              {e.run_anyway}
            </button>
            <span className="flex items-center gap-1.5 typo-body text-foreground animate-pulse">
              <RefreshCw className="w-3.5 h-3.5" />
              {e.retrying_automatically}
            </span>
          </div>
        )}
      </div>
    );
  }

  return null;
}
