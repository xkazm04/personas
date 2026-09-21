// CockpitStrip — one instrument per plan: a two-ring dial in a provider-tinted frame.
//
// THE QUESTION THIS LAYOUT ANSWERS: "is anything about to run dry?" — at a
// glance, from across the room. A dial is read by shape before it is read by
// number: a ring that has nearly closed is trouble whatever it says inside.
// Each plan gets ONE concentric dial — the OUTER ring is the weekly-scale window,
// the INNER ring the session-scale one — so the two numbers the classic strip
// stacks as bars become one glyph, and five plans become five glyphs the eye can
// compare in a single sweep. The tick on each ring is where an even pace would
// have it by now: arc past the tick is burning ahead of the clock.
//
// The dial's centre carries the SESSION percent (the number that changes what
// you do in the next hour); the weekly figure, both resets and the pace verdict
// sit beside it in text, because a dial is a bad place to read a countdown.
//
// A RING THAT DOES NOT EXIST IS DRAWN DASHED AND EMPTY, never as a closed or a
// zero arc: Codex reports only a weekly window, so its inner ring is a dashed
// outline — "no such window", distinct from "0% used". A provider with nothing
// to meter gets a framed card with its reason in words and NO dial at all.
//
// The frame is the provider's tint (the one place tint is used); the arcs are
// tone. This variant has a column to spare, so it hosts the FULL budgets panel.

import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { BudgetsBlock } from '../BudgetsBlock';
import { windowIn, type PlanModel, type ProviderModel, type WindowModel } from '../useResourceModel';
import {
  EmptyReason, Freshness, Ghost, PROVIDER_TINT, PaceMark, PctText, PlanActions, PlanTrouble, ProviderName, TONE_INK,
  WindowName, planName, resetText, usePlanConfirm, windowSentence, type PlanConfirm, type UsageVariantProps,
} from './variantBits';

const SIZE = 64;
const C = SIZE / 2;
const OUTER_R = 27;
const INNER_R = 18;
const STROKE = 6;

function Ring({ r, w, reduced }: { r: number; w: WindowModel | null; reduced: boolean }) {
  const len = 2 * Math.PI * r;
  if (!w) {
    return <circle cx={C} cy={C} r={r} fill="none" className="stroke-border" strokeWidth={1} strokeDasharray="2 3" />;
  }
  return (
    <g className={TONE_INK[w.tone]} data-tone={w.tone}>
      <circle cx={C} cy={C} r={r} fill="none" className="stroke-foreground/10" strokeWidth={STROKE} />
      <circle
        cx={C} cy={C} r={r} fill="none" strokeWidth={STROKE} strokeLinecap="round"
        className={`stroke-current ${reduced ? '' : 'transition-[stroke-dasharray] duration-500'}`}
        strokeDasharray={`${(len * w.usedPct) / 100} ${len}`}
        opacity={w.projected ? 0.5 : 1}
        transform={`rotate(-90 ${C} ${C})`}
      />
      {w.elapsedFrac !== null && (
        <line
          x1={C} x2={C} y1={C - r - STROKE / 2 - 1} y2={C - r + STROKE / 2 + 1}
          className="stroke-foreground" strokeWidth={1.5}
          transform={`rotate(${w.elapsedFrac * 360} ${C} ${C})`}
        />
      )}
    </g>
  );
}

function Dial({ plan, reduced }: { plan: PlanModel; reduced: boolean }) {
  const { t } = useTranslation();
  const long = windowIn(plan, 'long');
  const short = windowIn(plan, 'short');
  const centre = short ?? long;
  return (
    <Tooltip content={`${t.monitor.usage_dial_outer} · ${t.monitor.usage_dial_inner}`}>
      <span className="relative block h-16 w-16 flex-shrink-0" data-testid="fleet-usage-dial">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-full w-full" aria-hidden>
          <Ring r={OUTER_R} w={long} reduced={reduced} />
          <Ring r={INNER_R} w={short} reduced={reduced} />
        </svg>
        {centre && (
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <PctText w={centre} className="typo-caption text-foreground" />
          </span>
        )}
      </span>
    </Tooltip>
  );
}

function Readout({ w }: { w: WindowModel | null }) {
  const { t, tx } = useTranslation();
  if (!w) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 typo-caption" data-testid="fleet-usage-window" data-window={w.key} aria-label={windowSentence(t, tx, w)}>
      <WindowName w={w} className="w-7 flex-shrink-0 text-foreground opacity-70" />
      <PctText w={w} className={`w-10 flex-shrink-0 ${w.tone === 'ok' ? 'text-foreground' : TONE_INK[w.tone]}`} />
      <span className="min-w-0 truncate tabular-nums text-foreground opacity-70">{resetText(t, w)}</span>
      <PaceMark pace={w.pace} />
    </div>
  );
}

function Instrument({
  provider, plan, confirm, reduced,
}: { provider: ProviderModel; plan: PlanModel; confirm: PlanConfirm; reduced: boolean }) {
  const { t } = useTranslation();
  const tint = PROVIDER_TINT[provider.id];
  const troubled = plan.state === 'unreadable' || plan.state === 'quarantined';
  return (
    <div
      className={`flex w-60 min-w-0 flex-shrink-0 flex-col gap-1 rounded-card border px-2.5 py-1.5 ${tint.border} ${
        plan.isActive ? `${tint.wash} shadow-elevation-1` : 'bg-foreground/[0.015]'
      }`}
      data-testid="fleet-usage-plan" data-plan={plan.id} data-active={plan.isActive} data-state={plan.state}
    >
      <div className="flex h-5 min-w-0 items-center gap-1 typo-caption">
        {plan.isActive && (
          <span className={`inline-flex flex-shrink-0 items-center ${tint.text}`}>
            <Check className="h-3 w-3" aria-hidden />
            <span className="sr-only">{t.monitor.usage_accounts_active}</span>
          </span>
        )}
        <ProviderName provider={provider} className="flex-shrink-0" />
        <Tooltip content={planName(t, plan)}>
          <span className="min-w-0 flex-1 truncate text-foreground opacity-80">{planName(t, plan)}</span>
        </Tooltip>
        <PlanActions plan={plan} confirm={confirm} />
      </div>
      {troubled ? (
        <PlanTrouble plan={plan} className="h-16" />
      ) : (
        <div className="flex min-w-0 items-center gap-2.5">
          <Dial plan={plan} reduced={reduced} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Readout w={windowIn(plan, 'short')} />
            <Readout w={windowIn(plan, 'long')} />
            <Readout w={windowIn(plan, 'opus')} />
            <Readout w={windowIn(plan, 'sonnet')} />
            <Freshness provider={provider} className="text-foreground opacity-60" />
          </div>
        </div>
      )}
    </div>
  );
}

function Vacant({ provider }: { provider: ProviderModel }) {
  const tint = PROVIDER_TINT[provider.id];
  return (
    <div
      className={`flex w-44 flex-shrink-0 flex-col gap-1 rounded-card border border-dashed px-2.5 py-1.5 ${tint.border}`}
      data-testid="fleet-usage-provider" data-provider={provider.id}
    >
      <ProviderName provider={provider} />
      {provider.pending ? <Ghost className="h-16 w-full" /> : <EmptyReason reason={provider.emptyReason ?? 'unreadable'} className="h-16" />}
    </div>
  );
}

export function CockpitStrip({ model, onSwitch, onRemove, simulated }: UsageVariantProps) {
  const reduced = useReducedMotion();
  const confirm = usePlanConfirm(onSwitch, onRemove);
  return (
    <div data-testid="fleet-usage-cockpit" className="flex flex-wrap items-stretch gap-2 px-3 py-2">
      <div className="flex min-w-0 flex-1 basis-96 flex-wrap items-stretch gap-2">
        {model.providers.map((p) =>
          p.plans.length === 0
            ? <Vacant key={p.id} provider={p} />
            : p.plans.map((plan) => <Instrument key={`${p.id}:${plan.id}`} provider={p} plan={plan} confirm={confirm} reduced={reduced} />),
        )}
      </div>
      <BudgetsBlock budgets={model.budgets} density="full" simulated={simulated} reduced={reduced} />
      {confirm.dialogs}
    </div>
  );
}

export default CockpitStrip;
