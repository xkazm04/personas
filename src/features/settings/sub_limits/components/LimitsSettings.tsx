import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, AlertTriangle, RefreshCw, DollarSign, Check, Layers } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { getAllMonthlySpend } from '@/api/overview/observability';
import type { MonthlySpendResult } from '@/lib/bindings/MonthlySpendResult';
import { formatCost } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { RecentChangeChip } from '@/features/settings/shared/RecentChangeChip';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import Button from '@/features/shared/components/buttons/Button';
import { useOverviewStore } from '@/stores/overviewStore';

const CEILING_KEY = 'monthly_cost_ceiling_usd';
const WARNING_THRESHOLD = 0.8;

// Global concurrency cap (max_parallel_executions). Mirrors the Rust bounds in
// src-tauri/src/db/settings_keys.rs — keep in sync.
const CONCURRENCY_KEY = 'max_parallel_executions';
const CONCURRENCY_MIN = 1;
const CONCURRENCY_MAX = 20;
const CONCURRENCY_DEFAULT = 10;

function isValidCeiling(value: string): boolean {
  if (value.trim() === '') return true; // empty = unset; treated as 0
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function isValidConcurrency(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= CONCURRENCY_MIN && n <= CONCURRENCY_MAX;
}

export default function LimitsSettings() {
  const { t, tx } = useTranslation();
  const s = t.settings.limits;

  const ceiling = useAppSetting(CEILING_KEY, '0', isValidCeiling);
  const concurrency = useAppSetting(CONCURRENCY_KEY, String(CONCURRENCY_DEFAULT), isValidConcurrency);
  const setMaxParallel = useOverviewStore((s) => s.setMaxParallelExecutions);
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

  const concurrencyDirty = !concurrency.saved && concurrency.loaded;
  const concurrencyNum = useMemo(() => {
    const n = Number.parseInt(concurrency.value, 10);
    return Number.isFinite(n) ? n : CONCURRENCY_DEFAULT;
  }, [concurrency.value]);

  // Persist the cap, then push it into the store so the FleetActivityStrip's
  // capacity gauge updates immediately (the backend hot-applies the live
  // engine cap; no restart and no round-trip event needed for the UI).
  const saveConcurrency = useCallback(async () => {
    await concurrency.save();
    const n = Number.parseInt(concurrency.value, 10);
    if (Number.isFinite(n) && n > 0) setMaxParallel(n);
  }, [concurrency, setMaxParallel]);

  if (!ceiling.loaded || !concurrency.loaded) return null;

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
            <Layers className="w-4 h-4 text-primary/80" />
            <span className="typo-body font-medium text-foreground">{s.concurrency_section}</span>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="typo-body text-foreground">{s.concurrency_hint}</p>
            <div className="flex items-center gap-2">
              <NumberStepper
                value={concurrencyNum}
                onChange={(v) =>
                  concurrency.setValue(v == null ? String(CONCURRENCY_DEFAULT) : String(v))
                }
                min={CONCURRENCY_MIN}
                max={CONCURRENCY_MAX}
                step={1}
                ariaLabel={s.concurrency_aria}
                className="w-32"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => void saveConcurrency()}
                disabled={!concurrencyDirty || !isValidConcurrency(concurrency.value)}
                icon={concurrency.saved && !concurrencyDirty ? <Check size={12} /> : undefined}
              >
                {concurrency.saved && !concurrencyDirty ? s.saved : s.set}
              </Button>
              <span className="typo-caption text-foreground ml-2">
                {tx(s.concurrency_range, { min: CONCURRENCY_MIN, max: CONCURRENCY_MAX })}
              </span>
              {concurrency.error && (
                <span className="typo-caption text-red-400 ml-2">{concurrency.error}</span>
              )}
            </div>
            <p className="typo-caption text-foreground">{s.concurrency_queued_note}</p>
          </div>
        </div>

        <div className="rounded-modal border border-primary/15 bg-secondary/40 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span className="typo-body font-medium text-foreground">{s.ceiling_section}</span>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="typo-body text-foreground">{s.ceiling_hint}</p>
            <div className="flex items-center gap-2">
              <NumberStepper
                value={ceiling.value === '0' ? null : Number(ceiling.value)}
                onChange={(v) => ceiling.setValue(v == null ? '0' : String(v))}
                min={0}
                step={0.01}
                allowEmpty
                prefix="$"
                placeholder={s.ceiling_placeholder}
                ariaLabel={s.ceiling_aria}
                className="w-36"
              />
              <span className="typo-caption text-foreground">{s.ceiling_unit}</span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void ceiling.save()}
                disabled={!isDirty || !isValidCeiling(ceiling.value)}
                icon={ceiling.saved && !isDirty ? <Check size={12} /> : undefined}
              >
                {ceiling.saved && !isDirty ? s.saved : s.set}
              </Button>
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
