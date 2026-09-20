// LanesStrip — one lane per provider, its plans as segments along the lane.
//
// THE QUESTION THIS LAYOUT ANSWERS: "across everything I can bill to, where is
// there room?" The classic strip is five Claude cards; it has no place to put a
// second provider except as a sixth card that looks like a Claude plan and is
// not one. Here the PROVIDER is the row — a fixed label gutter on the left, then
// as many plan segments as that provider has — so Claude's five plans, Codex's
// one and Grok's none read as three different amounts of the same thing.
//
// ONE METER GRAMMAR, ALWAYS TWO ROWS. Every segment shows the session-scale
// window on top and the weekly-scale window beneath, in that order, for every
// provider. A plan that has no window in a slot (Codex reports only a weekly
// one) shows a dash in that row — the row stays, so the eye can run down a
// column of weekly meters across providers without re-finding it per segment.
//
// A provider with nothing to meter fills its lane with the reason, in words.

import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { BudgetsBlock } from '../BudgetsBlock';
import { windowIn, type PlanModel, type ProviderModel, type WindowSlot } from '../useResourceModel';
import {
  EmptyReason, Freshness, Ghost, PROVIDER_TINT, PaceMark, PctText, PlanActions, PlanTrouble, ProviderName,
  SvgMeter, WindowName, planName, usePlanConfirm, windowSentence, type PlanConfirm, type UsageVariantProps,
} from './variantBits';

const METER_ROW = 'grid h-4 grid-cols-[1.75rem_minmax(0,1fr)_2.75rem_1rem] items-center gap-x-1.5 typo-caption';
const SLOTS: readonly WindowSlot[] = ['short', 'long'];

function MeterRow({ plan, slot, reduced }: { plan: PlanModel; slot: WindowSlot; reduced: boolean }) {
  const { t, tx } = useTranslation();
  const w = windowIn(plan, slot);
  if (!w) {
    return (
      <Tooltip content={t.monitor.usage_window_none}>
        <div className={METER_ROW} data-testid="fleet-usage-window" data-window="none">
          <span className="opacity-50" aria-hidden>—</span>
          <span aria-hidden className="block h-px w-full border-t border-dashed border-border" />
          <span className="sr-only">{t.monitor.usage_window_none}</span>
        </div>
      </Tooltip>
    );
  }
  return (
    <div className={METER_ROW} data-testid="fleet-usage-window" data-window={w.key} aria-label={windowSentence(t, tx, w)}>
      <WindowName w={w} className="text-foreground opacity-70" />
      <SvgMeter w={w} reduced={reduced} />
      <PctText w={w} className="justify-end text-foreground" />
      <PaceMark pace={w.pace} />
    </div>
  );
}

function Segment({
  provider, plan, confirm, reduced,
}: { provider: ProviderModel; plan: PlanModel; confirm: PlanConfirm; reduced: boolean }) {
  const { t } = useTranslation();
  const tint = PROVIDER_TINT[provider.id];
  const troubled = plan.state === 'unreadable' || plan.state === 'quarantined';
  return (
    <div
      className={`flex min-w-0 flex-1 basis-44 flex-col gap-0.5 rounded-input border px-2 py-1 sm:max-w-72 ${
        plan.isActive ? `${tint.border} ${tint.wash}` : 'border-border/60 bg-foreground/[0.015]'
      }`}
      data-testid="fleet-usage-plan"
      data-plan={plan.id}
      data-active={plan.isActive}
      data-state={plan.state}
    >
      <div className="flex h-5 min-w-0 items-center gap-1 typo-caption">
        {plan.isActive ? (
          <span className={`inline-flex flex-shrink-0 items-center ${tint.text}`}>
            <Check className="h-3 w-3" aria-hidden />
            <span className="sr-only">{t.monitor.usage_accounts_active}</span>
          </span>
        ) : plan.slot !== null ? (
          <span className="flex-shrink-0 tabular-nums text-foreground opacity-50">{plan.slot}</span>
        ) : null}
        <Tooltip content={planName(t, plan)}>
          <span className="min-w-0 flex-1 truncate text-foreground">{planName(t, plan)}</span>
        </Tooltip>
        <PlanActions plan={plan} confirm={confirm} />
      </div>
      {troubled ? (
        <PlanTrouble plan={plan} className="h-8" />
      ) : (
        SLOTS.map((slot) => <MeterRow key={slot} plan={plan} slot={slot} reduced={reduced} />)
      )}
    </div>
  );
}

export function LanesStrip({ model, onSwitch, onRemove, simulated }: UsageVariantProps) {
  const reduced = useReducedMotion();
  const confirm = usePlanConfirm(onSwitch, onRemove);
  return (
    <div data-testid="fleet-usage-lanes" className="flex flex-col">
      {model.providers.map((p) => (
        <div
          key={p.id}
          className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-stretch border-b border-border/40 last:border-b-0"
          data-testid="fleet-usage-provider"
          data-provider={p.id}
        >
          <div className={`flex min-w-0 flex-col justify-center gap-0.5 border-l-2 px-3 py-1.5 ${PROVIDER_TINT[p.id].border}`}>
            <ProviderName provider={p} />
            <Freshness provider={p} className="text-foreground opacity-60" />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 py-1.5 pr-3">
            {p.pending ? (
              <>
                <Ghost className="h-14 flex-1 basis-44 sm:max-w-72" />
                {p.id === 'claude' && <Ghost className="h-14 flex-1 basis-44 sm:max-w-72" />}
              </>
            ) : p.emptyReason ? (
              <EmptyReason reason={p.emptyReason} className="h-8" />
            ) : (
              p.plans.map((plan) => <Segment key={plan.id} provider={p} plan={plan} confirm={confirm} reduced={reduced} />)
            )}
          </div>
        </div>
      ))}
      <BudgetsBlock budgets={model.budgets} density="compact" simulated={simulated} reduced={reduced} />
      {confirm.dialogs}
    </div>
  );
}

export default LanesStrip;
