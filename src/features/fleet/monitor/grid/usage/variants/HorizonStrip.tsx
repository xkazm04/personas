// HorizonStrip — every window on ONE time axis, from now to seven days out.
//
// THE QUESTION THIS LAYOUT ANSWERS: "what frees up, and when?" A percent says how
// much is spent; it does not say whether the relief is forty minutes away or
// four days. Here each usage window is a bar that STARTS AT NOW AND ENDS AT ITS
// RESET, so its length is the wait. The bar is filled to utilisation, and a tick
// marks where an even pace would have the fill by now — fill past the tick is
// burning ahead of the clock. Rows are sorted by reset, soonest first, so the
// strip reads top-down as a schedule of reliefs: a short, nearly-full bar is
// "tight, but not for long"; a long, nearly-full bar is the real problem.
//
// THE AXIS IS PIECEWISE, AND SAYS SO. On a single linear 7-day axis a 5-hour
// window is 3% of the width — every session window would be a sliver at the left
// edge. So the first zone spans the next five hours and the second the rest of
// the week, each linear within itself, with a rule and a caption at the seam.
//
// The plan acts cannot hang off a bar (a plan has several), so they ride a PLAN
// RAIL above the axis: every Claude plan as a chip, the live one marked, with
// Switch / Forget where the classic strip offers them — and a plan that could not
// be read says so there, since it has no bar to draw.

import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { BudgetsBlock } from '../BudgetsBlock';
import type { PlanModel, ProviderModel, ResourceModel, WindowModel } from '../useResourceModel';
import {
  EmptyReason, Freshness, Ghost, PROVIDER_TINT, PaceMark, PctText, PlanActions, PlanTrouble, ProviderName, TONE_INK,
  WindowName, planName, resetText, usePlanConfirm, windowSentence, type UsageVariantProps,
} from './variantBits';

const HOUR_MS = 3_600_000;
const NEAR_MS = 5 * HOUR_MS;
const FAR_MS = 7 * 24 * HOUR_MS;
/** The SVG's own units: the near zone is the first 350 of 1000. */
const AXIS = 1000;
const NEAR_W = 350;

/** Ms-from-now → x on the piecewise axis, clamped to the horizon. */
export function horizonX(ms: number): number {
  if (ms <= 0) return 0;
  if (ms <= NEAR_MS) return (ms / NEAR_MS) * NEAR_W;
  return NEAR_W + (Math.min(ms, FAR_MS) - NEAR_MS) / (FAR_MS - NEAR_MS) * (AXIS - NEAR_W);
}

const ROW = 'grid grid-cols-[13rem_minmax(0,1fr)_3rem_1rem] items-center gap-x-2';
const NEAR_HOURS = [1, 2, 3, 4, 5];
const FAR_DAYS = [1, 2, 3, 4, 5, 6, 7];
// Column widths of the day ticks, in hours: the far zone starts at +5h, so the
// first day's column is 19h wide and the rest 24h.
const FAR_COLUMNS = FAR_DAYS.map((d) => (d === 1 ? '19fr' : '24fr')).join(' ');

interface Row { provider: ProviderModel; plan: PlanModel; w: WindowModel }

function rowsOf(model: ResourceModel): Row[] {
  const rows: Row[] = [];
  for (const provider of model.providers) {
    for (const plan of provider.plans) {
      for (const w of plan.windows) {
        // The per-model weekly windows are shown for the live plan only: on a
        // standby plan they would double the rows to say what its 7d bar says.
        if ((w.label === 'opus' || w.label === 'sonnet') && !plan.isActive) continue;
        rows.push({ provider, plan, w });
      }
    }
  }
  return rows.sort((a, b) => (a.w.remainingMs ?? Infinity) - (b.w.remainingMs ?? Infinity));
}

function Track({ w, tint, reduced }: { w: WindowModel; tint: string; reduced: boolean }) {
  const { t } = useTranslation();
  if (w.remainingMs === null) {
    return <span className="typo-caption text-foreground opacity-60">{t.monitor.usage_resets_unknown}</span>;
  }
  const end = Math.max(6, horizonX(w.remainingMs));
  return (
    <svg
      viewBox={`0 0 ${AXIS} 12`} preserveAspectRatio="none" aria-hidden
      className={`block h-3 w-full ${TONE_INK[w.tone]}`}
      data-testid="fleet-usage-horizon-bar" data-tone={w.tone}
    >
      <line x1={NEAR_W} x2={NEAR_W} y1={0} y2={12} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect x={0} y={2} width={end} height={8} rx={2} className="fill-foreground/10" />
      <rect
        x={0} y={2} height={8} rx={2} width={(end * w.usedPct) / 100}
        className={`fill-current ${reduced ? '' : 'transition-[width] duration-500'}`}
        opacity={w.projected ? 0.5 : 1}
      />
      {w.elapsedFrac !== null && (
        <line
          x1={end * w.elapsedFrac} x2={end * w.elapsedFrac} y1={0} y2={12}
          className="stroke-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke"
        />
      )}
      {/* The reset itself: the bar's end cap, in the provider's tint. */}
      <g className={tint}>
        <line x1={end} x2={end} y1={0} y2={12} className="stroke-current" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

function Axis() {
  const { t } = useTranslation();
  const s = t.monitor;
  const tick = 'border-r border-border/60 pr-1 text-right typo-caption tabular-nums text-foreground opacity-60';
  return (
    <div className={`${ROW} h-5`} aria-hidden data-testid="fleet-usage-horizon-axis">
      <span className="typo-caption text-foreground opacity-60">{s.usage_horizon_now}</span>
      <div className="grid grid-cols-[35fr_65fr]">
        <div className="grid grid-cols-5">
          {NEAR_HOURS.map((h) => <span key={h} className={tick}>{h}{s.usage_unit_hour}</span>)}
        </div>
        <div className="grid" style={{ gridTemplateColumns: FAR_COLUMNS }}>
          {FAR_DAYS.map((d) => <span key={d} className={tick}>{d}{s.usage_unit_day}</span>)}
        </div>
      </div>
      <span />
      <span />
    </div>
  );
}

export function HorizonStrip({ model, onSwitch, onRemove, simulated }: UsageVariantProps) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const reduced = useReducedMotion();
  const confirm = usePlanConfirm(onSwitch, onRemove);
  const rows = rowsOf(model);
  const claude = model.providers[0];
  const empties = model.providers.filter((p) => !p.pending && p.emptyReason !== null);
  const cold = model.providers.some((p) => p.pending);

  return (
    <div data-testid="fleet-usage-horizon" className="flex flex-col">
      {/* Plan rail — the Claude plans and their acts. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-1" data-testid="fleet-usage-plan-rail">
        {claude && <ProviderName provider={claude} className="mr-1" />}
        {claude?.plans.map((plan) => (
          <span
            key={plan.id}
            className={`inline-flex min-w-0 max-w-64 items-center gap-1 rounded-full border px-2 py-0.5 typo-caption ${
              plan.isActive ? 'border-primary/40 bg-primary/10' : 'border-border/60'
            }`}
            data-testid="fleet-usage-plan" data-plan={plan.id} data-active={plan.isActive} data-state={plan.state}
          >
            {plan.isActive ? (
              <Check className="h-3 w-3 flex-shrink-0 text-primary" aria-hidden />
            ) : plan.slot !== null ? (
              <span className="flex-shrink-0 tabular-nums opacity-50">{plan.slot}</span>
            ) : null}
            <span className="min-w-0 truncate text-foreground">{planName(t, plan)}</span>
            {(plan.state === 'unreadable' || plan.state === 'quarantined') && <PlanTrouble plan={plan} />}
            <PlanActions plan={plan} confirm={confirm} />
          </span>
        ))}
        {claude?.pending && <Ghost className="h-5 w-40" />}
      </div>

      <div className="flex flex-col gap-0.5 px-3 py-1.5" role="list" aria-label={s.usage_horizon_aria}>
        <div className={`${ROW} h-4`} aria-hidden>
          <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground opacity-60">
            <span className="h-3 w-0.5 flex-shrink-0 bg-foreground" />
            <span className="truncate">{s.usage_horizon_pace_marker}</span>
          </span>
          <div className="grid grid-cols-[35fr_65fr] typo-caption text-foreground opacity-60">
            <span className="truncate">{s.usage_horizon_zone_hours}</span>
            <span className="truncate border-l border-border pl-1">{s.usage_horizon_zone_days}</span>
          </div>
          <span />
          <span />
        </div>
        <Axis />
        {rows.map(({ provider, plan, w }) => {
          const tint = PROVIDER_TINT[provider.id];
          return (
            <div
              key={`${plan.id}:${w.key}`}
              role="listitem"
              className={`${ROW} h-5`}
              data-testid="fleet-usage-window" data-provider={provider.id} data-plan={plan.id} data-window={w.key}
              aria-label={`${planName(t, plan)} · ${windowSentence(t, tx, w)}`}
            >
              <span className="flex min-w-0 items-center gap-1.5 typo-caption">
                <span aria-hidden className={`h-2 w-2 flex-shrink-0 rounded-full ${tint.dot}`} />
                <WindowName w={w} className={`w-16 flex-shrink-0 ${tint.text}`} />
                <span className={`min-w-0 truncate text-foreground ${plan.isActive ? '' : 'opacity-70'}`}>{planName(t, plan)}</span>
              </span>
              <Tooltip content={(w.remainingMs ?? 0) > FAR_MS ? s.usage_horizon_beyond : tx(s.usage_resets_in, { time: resetText(t, w) })}>
                <span className="block min-w-0"><Track w={w} tint={tint.text} reduced={reduced} /></span>
              </Tooltip>
              <PctText w={w} className="justify-end typo-caption text-foreground" />
              <PaceMark pace={w.pace} />
            </div>
          );
        })}
        {cold && rows.length === 0 && [0, 1, 2].map((i) => (
          <div key={i} className={`${ROW} h-5`} aria-hidden>
            <Ghost className="h-3 w-40" />
            <Ghost className="h-2 w-full" />
            <span />
            <span />
          </div>
        ))}
        {empties.map((p) => (
          <div key={p.id} className={`${ROW} h-5`} role="listitem" data-testid="fleet-usage-provider" data-provider={p.id}>
            <ProviderName provider={p} />
            <EmptyReason reason={p.emptyReason ?? 'unreadable'} />
            <span />
            <span />
          </div>
        ))}
        {model.providers.filter((p) => p.readOnly && p.plans.length > 0).map((p) => (
          <div key={p.id} className="flex items-center gap-2 pt-0.5 typo-caption text-foreground opacity-70" data-provider={p.id}>
            <ProviderName provider={p} />
            <Freshness provider={p} />
          </div>
        ))}
      </div>

      <BudgetsBlock budgets={model.budgets} density="compact" simulated={simulated} reduced={reduced} />
      {confirm.dialogs}
    </div>
  );
}

export default HorizonStrip;
