import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, AlertTriangle, RefreshCw, DollarSign, Check } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { getAllMonthlySpend } from '@/api/overview/observability';
import type { MonthlySpendResult } from '@/lib/bindings/MonthlySpendResult';
import { formatCost } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { RecentChangeChip } from '@/features/settings/shared/RecentChangeChip';

const CEILING_KEY = 'monthly_cost_ceiling_usd';
const WARNING_THRESHOLD = 0.8;

function isValidCeiling(value: string): boolean {
  if (value.trim() === '') return true; // empty = unset; treated as 0
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

export default function LimitsSettings() {
  const { t, tx } = useTranslation();
  const s = t.settings.limits;

  const ceiling = useAppSetting(CEILING_KEY, '0', isValidCeiling);
  const [spend, setSpend] = useState<MonthlySpendResult | null>(null);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [spendLoading, setSpendLoading] = useState(true);

  const loadSpend = useCallback(async () => {
    setSpendLoading(true);
    setSpendError(null);
    try {
      const result = await getAllMonthlySpend();
      setSpend(result);
    } catch (e) {
      setSpendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSpendLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpend();
  }, [loadSpend]);

  const ceilingNum = useMemo(() => {
    const n = Number(ceiling.value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [ceiling.value]);

  const totalSpend = useMemo(() => {
    if (!spend) return 0;
    return spend.items.reduce((acc, item) => acc + (item.spend ?? 0), 0);
  }, [spend]);

  const progressPct = useMemo(() => {
    if (ceilingNum <= 0) return 0;
    return Math.min(1, totalSpend / ceilingNum);
  }, [ceilingNum, totalSpend]);

  const isOverBudget = ceilingNum > 0 && totalSpend >= ceilingNum;
  const isApproaching = ceilingNum > 0 && progressPct >= WARNING_THRESHOLD && !isOverBudget;

  // Disable the input's "Set" button while ceiling.value matches the persisted
  // value; ceiling.saved is set by useAppSetting after a successful save.
  const isDirty = !ceiling.saved && ceiling.loaded;

  if (!ceiling.loaded) return null;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Gauge className="w-5 h-5 text-emerald-400" />}
        title={s.title}
        subtitle={s.subtitle}
        actions={
          <div className="flex items-center gap-2">
            <RecentChangeChip category="limits" />
            <button
              type="button"
              onClick={() => void loadSpend()}
              disabled={spendLoading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption text-foreground hover:text-primary hover:bg-secondary/40 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${spendLoading ? 'animate-spin' : ''}`} />
              {s.refresh}
            </button>
          </div>
        }
      />
      <ContentBody>
        <p className="typo-body text-foreground leading-relaxed mb-4">{s.description}</p>

        <div className="rounded-modal border border-primary/15 bg-secondary/40 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span className="typo-body font-medium text-foreground">{s.ceiling_section}</span>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="typo-body text-foreground">{s.ceiling_hint}</p>
            <div className="flex items-center gap-2">
              <span className="typo-body text-foreground">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={ceiling.value === '0' ? '' : ceiling.value}
                onChange={(e) => ceiling.setValue(e.target.value || '0')}
                placeholder={s.ceiling_placeholder}
                aria-label={s.ceiling_aria}
                className="w-32 px-2 py-1 typo-body rounded-input bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground/50 focus:outline-none focus:border-primary/40"
              />
              <span className="typo-caption text-foreground">{s.ceiling_unit}</span>
              <button
                type="button"
                onClick={() => void ceiling.save()}
                disabled={!isDirty || !isValidCeiling(ceiling.value)}
                className="ml-2 inline-flex items-center gap-1 px-3 py-1 rounded-interactive typo-caption font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {ceiling.saved && !isDirty ? (
                  <>
                    <Check size={12} />
                    {s.saved}
                  </>
                ) : (
                  s.set
                )}
              </button>
              {ceilingNum === 0 && (
                <span className="typo-caption text-foreground ml-2">{s.unlimited}</span>
              )}
              {ceiling.error && (
                <span className="typo-caption text-red-400 ml-2">{ceiling.error}</span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-modal border border-primary/15 bg-secondary/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary/60" />
            <span className="typo-body font-medium text-foreground">{s.usage_section}</span>
          </div>
          <div className="px-4 py-4 space-y-3">
            {spendError && (
              <div className="flex items-center gap-2 typo-caption text-red-400 bg-red-400/10 rounded p-2">
                <AlertTriangle size={14} />
                {spendError}
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <span className="typo-h3 text-foreground font-medium">
                {formatCost(totalSpend)}
              </span>
              {ceilingNum > 0 && (
                <span className="typo-body text-foreground">
                  {tx(s.of_ceiling, { ceiling: formatCost(ceilingNum) })}
                </span>
              )}
            </div>
            {ceilingNum > 0 && (
              <>
                <div className="h-2 rounded-full bg-secondary/30 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      isOverBudget
                        ? 'bg-red-500'
                        : isApproaching
                        ? 'bg-amber-400'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${progressPct * 100}%` }}
                    aria-label={tx(s.progress_aria, { pct: Math.round(progressPct * 100) })}
                  />
                </div>
                {isOverBudget && (
                  <div className="flex items-start gap-2 typo-caption text-red-400 bg-red-400/10 rounded p-2">
                    <AlertTriangle size={14} className="mt-px shrink-0" />
                    <span>{s.over_budget}</span>
                  </div>
                )}
                {isApproaching && (
                  <div className="flex items-start gap-2 typo-caption text-amber-400 bg-amber-400/10 rounded p-2">
                    <AlertTriangle size={14} className="mt-px shrink-0" />
                    <span>{s.approaching_budget}</span>
                  </div>
                )}
              </>
            )}
            {ceilingNum === 0 && (
              <p className="typo-caption text-foreground">{s.no_ceiling_hint}</p>
            )}
            <p className="typo-caption text-foreground">{s.stage1_note}</p>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
