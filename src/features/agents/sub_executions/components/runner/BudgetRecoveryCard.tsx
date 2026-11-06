import { ShieldAlert, Settings, CalendarClock, PlayCircle, RefreshCw } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { PersonaBudgetState, BudgetStatus } from '@/stores/slices/agents/budgetEnforcementSlice';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import Button from '@/features/shared/components/buttons/Button';

interface BudgetRecoveryCardProps {
  budgetStatus: BudgetStatus;
  budgetEntry: PersonaBudgetState | undefined;
  isBudgetBlocked: boolean;
  onOverrideBudget: () => void;
  onOverrideStale: () => void;
}

function getResetLabel(t: Translations, tx: (tpl: string, vars: Record<string, string | number>) => string): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const diffDays = Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return t.execution.budget_reset_tomorrow;
  const tpl = diffDays === 1 ? t.execution.budget_reset_in_days_one : t.execution.budget_reset_in_days_other;
  return tx(tpl, { count: diffDays });
}

export function BudgetRecoveryCard({
  budgetStatus,
  budgetEntry,
  isBudgetBlocked,
  onOverrideBudget,
  onOverrideStale,
}: BudgetRecoveryCardProps) {
  const { t, tx, language } = useTranslation();
  const e = t.agents.executions;
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const currencyFmt = new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const decimalFmt = new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (budgetStatus === 'warning') {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-modal border border-status-warning/15 bg-status-warning/5">
        <ShieldAlert className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
        <p className="typo-body text-status-warning">
          {e.approaching_budget}
          {budgetEntry && <span className="text-status-warning"> -- {currencyFmt.format(budgetEntry.spend)} / {budgetEntry.maxBudget != null ? currencyFmt.format(budgetEntry.maxBudget) : '?'} ({Math.round(budgetEntry.ratio * 100)}%)</span>}
        </p>
      </div>
    );
  }

  if (budgetStatus === 'exceeded') {
    return (
      <div className="rounded-modal border border-status-error/20 bg-status-error/5 overflow-hidden">
        <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2">
          <ShieldAlert className="w-4 h-4 text-status-error flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="typo-heading text-status-error">{e.budget_exceeded}</p>
            {budgetEntry && (
              <p className="typo-body text-status-error">
                {tx(e.budget_spend_detail, {
                  spend: decimalFmt.format(budgetEntry.spend),
                  limit: budgetEntry.maxBudget != null ? decimalFmt.format(budgetEntry.maxBudget) : '?',
                  percent: String(Math.round(budgetEntry.ratio * 100)),
                })}
              </p>
            )}
          </div>
        </div>
        {isBudgetBlocked && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3 pt-1">
            <Button
              type="button"
              data-testid="runner-budget-override"
              onClick={onOverrideBudget}
              variant="danger"
              size="sm"
              icon={<PlayCircle className="w-3.5 h-3.5" />}
            >{e.run_anyway_session}</Button>
            <Button
              type="button"
              onClick={() => setEditorTab('settings')}
              variant="secondary"
              size="sm"
              icon={<Settings className="w-3.5 h-3.5" />}
            >{e.raise_budget}</Button>
            <span className="flex items-center gap-1.5 typo-body text-ink-1">
              <CalendarClock className="w-3.5 h-3.5" />
              {tx(e.resets_in, { days: getResetLabel(t, tx) })}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (budgetStatus === 'stale') {
    return (
      <div className="rounded-modal border border-status-warning/20 bg-status-warning/5 overflow-hidden">
        <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2">
          <ShieldAlert className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="typo-heading text-status-warning">{e.budget_unavailable}</p>
            <p className="typo-body text-status-warning">
              {e.budget_unavailable_detail}
            </p>
          </div>
        </div>
        {isBudgetBlocked && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3 pt-1">
            <Button
              type="button"
              onClick={onOverrideStale}
              variant="secondary"
              size="sm"
              icon={<PlayCircle className="w-3.5 h-3.5" />}
            >{e.run_anyway}</Button>
            <span className="flex items-center gap-1.5 typo-body text-ink-1">
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
