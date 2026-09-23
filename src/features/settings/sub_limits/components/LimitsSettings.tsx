import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, AlertTriangle, RefreshCw, DollarSign, Check, Layers, Users, Bot } from 'lucide-react';
import { AutopilotLimits, BoundRow } from './AutopilotLimits';
import { FLEET_MAX_PARALLEL_SESSIONS_BOUNDS } from '../autopilotBounds';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SettingsScaffold, type SettingsSection } from '@/features/shared/components/layout/settings/SettingsScaffold';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { setAppSetting } from '@/api/system/settings';
import { toastCatch } from '@/lib/silentCatch';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { getMetricsChartData } from '@/api/overview/observability';
import { formatCost } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { RecentChangeChip } from '@/features/settings/shared/RecentChangeChip';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import Button from '@/features/shared/components/buttons/Button';
import { useOverviewStore } from '@/stores/overviewStore';
import { SPEND_WARNING_RATIO } from './spendAlerts';
import { bucketMonthlySpend, CEILING_KEY, MONTHLY_SPEND_DAYS, parseCeiling, type MonthSpend } from './monthlySpend';

// The 80% / 100% crossing ALERTS are not raised here: this tab unmounts 30s
// after the operator leaves Settings, so they run in the always-mounted
// `overview/components/feedback/SpendAlertWatcher.tsx`. This tab only draws
// the bar, with the same bucketing and the same shoulder.

// Global concurrency cap (max_parallel_executions). Mirrors the Rust bounds in
// src-tauri/src/db/settings_keys.rs — keep in sync.
const CONCURRENCY_KEY = 'max_parallel_executions';
const CONCURRENCY_MIN = 1;
const CONCURRENCY_MAX = 20;
const CONCURRENCY_DEFAULT = 10;

// App-wide RUNNING-persona cap (max_active_personas). Two concurrency guards
// side by side since 2026-09-08 (G17), not a population cap and a concurrency
// cap: the one above bounds how many EXECUTIONS run at the same moment, this
// one bounds how many distinct PERSONAS do. It used to bound how many personas
// were switched on at all, which made it an organisation-size limit; the key
// name is unchanged because the operator knows it.
//
// The three numbers below are pinned by a backend test that names this file and
// these constant names, so a change to the enforced bounds fails there instead
// of drifting silently here. See settings_keys.rs's
// `the_settings_ui_steppers_bounds_are_pinned_here`, which covers the
// concurrency block above too.
const ROSTER_KEY = 'max_active_personas';
const ROSTER_MIN = 1;
const ROSTER_MAX = 50;
const ROSTER_DEFAULT = 10;

// Kill switch for resource-aware fleet admission (`fleet.dynamic_budgets`,
// settings_keys.rs `FLEET_DYNAMIC_BUDGETS`, default true). Off = the dispatch
// queue charges nothing but the fixed session cap above it.
const DYNAMIC_BUDGETS_KEY = 'fleet.dynamic_budgets';
const DYNAMIC_BUDGETS_DEFAULT = true;

function isBoolSetting(value: string): boolean {
  return value === 'true' || value === 'false';
}

/** The "Dynamic fleet budgets" row. Same shape as the Autopilot pacing toggle:
 *  a toggle is its own commit, so it writes directly instead of going through
 *  the hook's Set-button `save`. */
function DynamicBudgetsRow() {
  const { t } = useTranslation();
  const s = t.settings.limits;
  const setting = useAppSetting(DYNAMIC_BUDGETS_KEY, String(DYNAMIC_BUDGETS_DEFAULT), isBoolSetting);
  const on = setting.value === 'true';
  return (
    <div className="flex items-start gap-3 border-t border-border/60 pt-3" data-testid="fleet-dynamic-budgets-row">
      <AccessibleToggle
        checked={on}
        onChange={() => {
          const next = on ? 'false' : 'true';
          setAppSetting(DYNAMIC_BUDGETS_KEY, next)
            .then(() => setting.setValue(next))
            .catch(toastCatch('settings/LimitsSettings:dynamicBudgets', s.dynamic_budgets_label));
        }}
        label={s.dynamic_budgets_label}
        size="sm"
        disabled={!setting.loaded}
        data-testid="fleet-dynamic-budgets-toggle"
      />
      <div className="min-w-0">
        <div className="typo-body text-foreground">{s.dynamic_budgets_label}</div>
        <p className="typo-caption text-foreground">{s.dynamic_budgets_hint}</p>
        {setting.error && <span className="typo-caption text-red-400">{setting.error}</span>}
      </div>
    </div>
  );
}

function isValidCeiling(value: string): boolean {
  if (value.trim() === '') return true; // empty = unset; treated as 0
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function isValidConcurrency(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= CONCURRENCY_MIN && n <= CONCURRENCY_MAX;
}

function isValidRoster(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= ROSTER_MIN && n <= ROSTER_MAX;
}

export default function LimitsSettings() {
  const { t, tx } = useTranslation();
  const s = t.settings.limits;

  const ceiling = useAppSetting(CEILING_KEY, '0', isValidCeiling);
  const concurrency = useAppSetting(CONCURRENCY_KEY, String(CONCURRENCY_DEFAULT), isValidConcurrency);
  const roster = useAppSetting(ROSTER_KEY, String(ROSTER_DEFAULT), isValidRoster);
  const setMaxParallel = useOverviewStore((st) => st.setMaxParallelExecutions);
  const [monthly, setMonthly] = useState<MonthSpend[]>([]);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [spendLoading, setSpendLoading] = useState(true);

  const loadSpend = useCallback(async () => {
    setSpendLoading(true);
    setSpendError(null);
    try {
      // Daily cost points over ~6 months, bucketed into the trailing 5
      // calendar months so the table shows the bigger spending picture
      // rather than just the current month.
      const data = await getMetricsChartData(MONTHLY_SPEND_DAYS);
      setMonthly(bucketMonthlySpend(data.chart_points)); // index 0 = current month (descending)
    } catch (e) {
      setSpendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSpendLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpend();
  }, [loadSpend]);

  const ceilingNum = useMemo(() => parseCeiling(ceiling.value), [ceiling.value]);

  // Current month is the head of the descending list.
  const totalSpend = monthly[0]?.spend ?? 0;

  // Scale the per-month bars against the busiest month (and the ceiling, so an
  // over-budget month still reads as "full"). 0.01 floor avoids divide-by-zero.
  const maxSpend = useMemo(
    () => Math.max(0.01, ...monthly.map((m) => m.spend), ceilingNum),
    [monthly, ceilingNum],
  );

  const progressPct = useMemo(() => {
    if (ceilingNum <= 0) return 0;
    return Math.min(1, totalSpend / ceilingNum);
  }, [ceilingNum, totalSpend]);

  const isOverBudget = ceilingNum > 0 && totalSpend >= ceilingNum;
  const isApproaching = ceilingNum > 0 && progressPct >= SPEND_WARNING_RATIO && !isOverBudget;

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

  const rosterDirty = !roster.saved && roster.loaded;
  const rosterNum = useMemo(() => {
    const n = Number.parseInt(roster.value, 10);
    return Number.isFinite(n) ? n : ROSTER_DEFAULT;
  }, [roster.value]);

  const sections: SettingsSection[] = useMemo(() => [
    {
      id: 'concurrency',
      label: s.concurrency_section,
      icon: <Layers className="w-4 h-4 text-primary/80" />,
      content: (
        <div className="space-y-3">
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
          {/* The FLEET's own line — Claude Code sessions, not persona
              executions. Every fleet spawn goes through the dispatch queue's
              admission door; past this cap a session is admitted as queued
              and starts when a slot frees. Same key the Activity board's
              header stepper writes. */}
          <div className="space-y-2 border-t border-border/60 pt-3">
            <BoundRow
              bound={FLEET_MAX_PARALLEL_SESSIONS_BOUNDS}
              label={s.fleet_concurrency_label}
              ariaLabel={s.fleet_concurrency_aria}
              unit=""
              testId="fleet-concurrency-bound"
            />
            <p className="typo-caption text-foreground">{s.fleet_concurrency_hint}</p>
          </div>
          <DynamicBudgetsRow />
        </div>
      ),
    },
    {
      id: 'roster',
      label: s.roster_section,
      icon: <Users className="w-4 h-4 text-primary/80" />,
      content: (
        <div className="space-y-3">
          <p className="typo-body text-foreground">{s.roster_hint}</p>
          <div className="flex items-center gap-2">
            <NumberStepper
              value={rosterNum}
              onChange={(v) => roster.setValue(v == null ? String(ROSTER_DEFAULT) : String(v))}
              min={ROSTER_MIN}
              max={ROSTER_MAX}
              step={1}
              ariaLabel={s.roster_aria}
              className="w-32"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void roster.save()}
              disabled={!rosterDirty || !isValidRoster(roster.value)}
              icon={roster.saved && !rosterDirty ? <Check size={12} /> : undefined}
            >
              {roster.saved && !rosterDirty ? s.saved : s.set}
            </Button>
            <span className="typo-caption text-foreground ml-2">
              {tx(s.roster_range, { min: ROSTER_MIN, max: ROSTER_MAX })}
            </span>
            {roster.error && (
              <span className="typo-caption text-red-400 ml-2">{roster.error}</span>
            )}
          </div>
          <p className="typo-caption text-foreground">{s.roster_refused_note}</p>
        </div>
      ),
    },
    {
      id: 'autopilot',
      label: s.autopilot_section,
      icon: <Bot className="w-4 h-4 text-primary/80" />,
      // Self-contained: its steppers own their settings, so the section
      // neither reads nor writes anything in this component's deps.
      content: <AutopilotLimits />,
    },
    {
      id: 'ceiling',
      label: s.ceiling_section,
      icon: <DollarSign className="w-4 h-4 text-emerald-400" />,
      content: (
        <div className="space-y-3">
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
      ),
    },
    {
      id: 'usage',
      label: s.usage_section,
      icon: <Gauge className="w-4 h-4 text-primary/60" />,
      content: (
        <div className="space-y-3">
          {spendError && (
            <div className="flex items-center gap-2 typo-caption text-red-400 bg-red-400/10 rounded p-2">
              <AlertTriangle size={14} />
              {spendError}
            </div>
          )}

          {/* Trailing 5 months — lean rows: month · proportional bar · amount.
              Current month is the highlighted head; a month over the ceiling
              turns red. */}
          {monthly.length > 0 && (
            <div className="rounded-input border border-primary/10 bg-secondary/10 divide-y divide-primary/5">
              {monthly.map((m, i) => {
                const isCurrent = i === 0;
                const pct = Math.min(100, (m.spend / maxSpend) * 100);
                const over = ceilingNum > 0 && m.spend >= ceilingNum;
                return (
                  <div key={m.key} className="flex items-center gap-3 px-3 py-1.5">
                    <span className={`typo-caption w-24 shrink-0 ${isCurrent ? 'text-foreground font-medium' : 'text-foreground/70'}`}>
                      {m.label}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : isCurrent ? 'bg-emerald-500' : 'bg-primary/30'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`typo-caption tabular-nums w-16 text-right ${isCurrent ? 'text-foreground font-medium' : 'text-foreground/80'}`}>
                      {formatCost(m.spend)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Current-month standing against the ceiling */}
          {ceilingNum > 0 ? (
            <>
              <p className="typo-caption text-foreground">
                <span className="tabular-nums font-medium text-foreground">{formatCost(totalSpend)}</span>{' '}
                {tx(s.of_ceiling, { ceiling: formatCost(ceilingNum) })}
              </p>
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
          ) : (
            <p className="typo-caption text-foreground">{s.no_ceiling_hint}</p>
          )}
          <p className="typo-caption text-foreground">{s.stage1_note}</p>
        </div>
      ),
    },
  ], [s, tx, concurrency, concurrencyNum, concurrencyDirty, saveConcurrency, roster, rosterNum, rosterDirty, ceiling, ceilingNum, isDirty, spendError, monthly, maxSpend, totalSpend, isOverBudget, isApproaching]);

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
        <div className="max-w-5xl mx-auto space-y-4">
          <p className="typo-body text-foreground leading-relaxed">{s.description}</p>
          <SettingsScaffold sections={sections} navAriaLabel={s.title} />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
