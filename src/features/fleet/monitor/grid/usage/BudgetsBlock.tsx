// BudgetsBlock — "Machine & budgets": what admission is charging against, and
// the one reason it is holding, if it is.
//
// The subscription meters above it answer "how much plan is left". This block
// answers the question that actually stops a queued session from starting: the
// door charges every session against a MACHINE budget and a PLAN budget, gates
// promotion on RAM, and hands out a single GPU token. When a count slot is free
// and nothing starts, the reason is in here — so it is said in ONE line, in
// words, rather than left to be inferred from four gauges.
//
// TWO DENSITIES, one content. `compact` is a single wrapping row for the
// variants that are themselves rows (lanes, horizon, ledger); `full` is a small
// panel for the variant that has a column to give it (cockpit). Neither hides a
// fact the other shows.
//
// THE KILL SWITCH is `fleet.dynamic_budgets`, written through the same
// `useAppSetting` / `setAppSetting` door as the board's `MaxParallelStepper`:
// painted first, written second, snapped back with a toast if the write fails.
// Off means pure count-cap admission; the block stays visible (dimmed, saying
// so) because a switch you cannot find again is not a switch. A simulated strip
// flips it locally and writes nothing.
//
// Hidden entirely when the snapshot carries no budgets (older backends, test
// fixtures): absent is not the same as zero, and an all-zero block would lie.

import { useCallback, useState, type ReactNode } from 'react';
import { Cpu, MemoryStick, PauseCircle, PlayCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { setAppSetting } from '@/api/system/settings';
import { toastCatch } from '@/lib/silentCatch';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { BudgetHold } from '@/lib/bindings/BudgetHold';
import type { RamGate } from '@/lib/bindings/RamGate';
import { meterTone } from '../usageModel';
import type { BudgetsModel } from './useResourceModel';
import { TONE_INK } from './variants/variantBits';

export const DYNAMIC_BUDGETS_KEY = 'fleet.dynamic_budgets';

export type BudgetsDensity = 'compact' | 'full';

export function holdLabel(t: Translations, hold: BudgetHold): string {
  switch (hold) {
    case 'ahead_of_pace': return t.monitor.usage_hold_ahead_of_pace;
    case 'five_hour_full': return t.monitor.usage_hold_five_hour_full;
    case 'ram_high_water': return t.monitor.usage_hold_ram_high_water;
    case 'gpu_token_held': return t.monitor.usage_hold_gpu_token_held;
  }
}

function ramGateLabel(t: Translations, gate: RamGate): string {
  switch (gate) {
    case 'open': return t.monitor.usage_ram_gate_open;
    case 'closed': return t.monitor.usage_ram_gate_closed;
    case 'warming': return t.monitor.usage_ram_gate_warming;
  }
}

const RAM_GATE_INK: Record<RamGate, string> = {
  open: 'text-status-success',
  closed: 'text-status-error',
  warming: 'text-foreground opacity-60',
};

/** used / budget with a bar; the bar's tone is the strip's own 75 / 90 thresholds. */
function BudgetMeter({
  label, hint, used, budget, frac, reduced, wide, children,
}: {
  label: string; hint: string; used: number; budget: number; frac: number;
  reduced: boolean; wide: boolean; children?: ReactNode;
}) {
  const tone = meterTone(frac * 100);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${wide ? 'w-full' : ''}`}>
      <Tooltip content={hint}>
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
          <span className="flex-shrink-0 typo-caption text-foreground opacity-70">{label}</span>
          <span aria-hidden className={`block h-1.5 overflow-hidden rounded-full bg-foreground/10 ${wide ? 'min-w-0 flex-1' : 'w-16'}`}>
            <span
              className={`block h-full w-full origin-left rounded-full bg-current ${TONE_INK[tone]} ${reduced ? '' : 'transition-transform duration-500'}`}
              style={{ transform: `scaleX(${frac})` }}
            />
          </span>
          <span className="flex-shrink-0 typo-caption tabular-nums text-foreground">
            <Numeric value={used} /> / <Numeric value={budget} />
          </span>
        </span>
      </Tooltip>
      {children}
    </span>
  );
}

export function BudgetsBlock({
  budgets, density, simulated = false, reduced = false,
}: {
  budgets: BudgetsModel | null;
  density: BudgetsDensity;
  simulated?: boolean;
  reduced?: boolean;
}) {
  const { t, tx, language } = useTranslation();
  const s = t.monitor;
  const setting = useAppSetting(DYNAMIC_BUDGETS_KEY, 'true', (v) => v === 'true' || v === 'false');
  const [simOn, setSimOn] = useState<boolean | null>(null);

  // The setting is the authority once loaded; until then the snapshot's own
  // `enabled` is the best available truth (and the only one while simulating).
  const snapshotOn = budgets?.enabled ?? true;
  const on = simulated ? (simOn ?? snapshotOn) : setting.loaded ? setting.value === 'true' : snapshotOn;

  const toggle = useCallback(() => {
    const next = !on;
    if (simulated) {
      setSimOn(next);
      return;
    }
    const prev = setting.value;
    setting.setValue(String(next));
    setAppSetting(DYNAMIC_BUDGETS_KEY, String(next)).catch((err: unknown) => {
      setting.setValue(prev);
      toastCatch('monitor/BudgetsBlock:toggle', s.usage_dynamic_budgets_failed)(err);
    });
  }, [on, simulated, setting, s.usage_dynamic_budgets_failed]);

  if (!budgets) return null;

  const full = density === 'full';
  const factor = new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(budgets.paceFactor);
  const holding = on && budgets.hold !== null;
  const line = !on ? s.usage_dynamic_budgets_off : budgets.hold ? holdLabel(t, budgets.hold) : s.usage_hold_none;
  const LineIcon = holding ? PauseCircle : PlayCircle;

  const kill = (
    <Tooltip content={s.usage_dynamic_budgets_hint}>
      <span className="inline-flex flex-shrink-0 items-center gap-1.5 typo-caption text-foreground">
        <AccessibleToggle
          size="sm"
          checked={on}
          onChange={toggle}
          disabled={!simulated && !setting.loaded}
          label={s.usage_dynamic_budgets}
          data-testid="fleet-budgets-toggle"
        />
        <span>{s.usage_dynamic_budgets}</span>
      </span>
    </Tooltip>
  );

  const meters = (
    <>
      <BudgetMeter
        label={s.usage_budget_machine} hint={s.usage_budget_machine_hint}
        used={budgets.machineUsed} budget={budgets.machineBudget} frac={budgets.machineFrac}
        reduced={reduced} wide={full}
      />
      <BudgetMeter
        label={s.usage_budget_plan} hint={s.usage_budget_plan_hint}
        used={budgets.planUsed} budget={budgets.planBudget} frac={budgets.planFrac}
        reduced={reduced} wide={full}
      >
        <Tooltip content={tx(s.usage_budget_pace_factor_hint, { max: budgets.planBudgetMax })}>
          <span
            className={`flex-shrink-0 whitespace-nowrap rounded-full border px-1.5 typo-caption tabular-nums ${
              budgets.throttled ? 'border-status-warning/40 text-status-warning' : 'border-border text-foreground opacity-70'
            }`}
            data-testid="fleet-budgets-pace-factor"
          >
            {tx(s.usage_budget_pace_factor, { factor })}
          </span>
        </Tooltip>
      </BudgetMeter>
    </>
  );

  const gates = (
    <>
      <Tooltip content={s.usage_ram_gate_hint}>
        <span className="inline-flex flex-shrink-0 items-center gap-1 typo-caption text-foreground" data-testid="fleet-budgets-ram" data-gate={budgets.ramGate}>
          <MemoryStick className="h-3 w-3 opacity-60" aria-hidden />
          <span className="opacity-70">{s.usage_budget_ram}</span>
          {budgets.ramPct !== null && <Numeric value={budgets.ramPct} unit="percent" precision={0} />}
          <span className={RAM_GATE_INK[budgets.ramGate]}>{ramGateLabel(t, budgets.ramGate)}</span>
        </span>
      </Tooltip>
      <span className="inline-flex min-w-0 items-center gap-1 typo-caption text-foreground" data-testid="fleet-budgets-gpu">
        <Cpu className="h-3 w-3 flex-shrink-0 opacity-60" aria-hidden />
        <span className="flex-shrink-0 opacity-70">{s.usage_budget_gpu}</span>
        <span className="min-w-0 truncate">
          {budgets.gpuHolder === null ? s.usage_budget_gpu_free : tx(s.usage_budget_gpu_held, { session: budgets.gpuHolder })}
        </span>
      </span>
    </>
  );

  const hold = (
    <span
      className={`inline-flex min-w-0 items-center gap-1 typo-caption ${holding ? 'text-status-warning' : 'text-foreground opacity-70'}`}
      data-testid="fleet-budgets-hold"
      data-hold={on ? (budgets.hold ?? 'none') : 'off'}
    >
      <LineIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{line}</span>
    </span>
  );

  const dim = on ? '' : 'opacity-50';

  if (full) {
    return (
      <section
        aria-label={s.usage_budgets_aria}
        data-testid="fleet-budgets" data-density="full" data-enabled={on}
        className="flex w-64 flex-shrink-0 flex-col gap-1.5 rounded-card border border-border bg-foreground/[0.015] px-3 py-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="typo-title text-foreground">{s.usage_budgets_title}</span>
          {kill}
        </div>
        <div className={`flex flex-col gap-1.5 ${dim}`}>
          {meters}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{gates}</div>
        </div>
        <div className="border-t border-border/60 pt-1.5">{hold}</div>
      </section>
    );
  }

  return (
    <section
      aria-label={s.usage_budgets_aria}
      data-testid="fleet-budgets" data-density="compact" data-enabled={on}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-1.5"
    >
      <span className="flex-shrink-0 typo-title text-foreground">{s.usage_budgets_title}</span>
      <span className={`inline-flex flex-wrap items-center gap-x-4 gap-y-1 ${dim}`}>
        {meters}
        {gates}
      </span>
      <span className="min-w-0 flex-1">{hold}</span>
      {kill}
    </section>
  );
}

export default BudgetsBlock;
