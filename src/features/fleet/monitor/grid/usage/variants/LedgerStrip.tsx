// LedgerStrip — the whole resource picture as one dense table.
//
// THE QUESTION THIS LAYOUT ANSWERS: "give me every number, aligned." The other
// variants each privilege one reading (room, time, danger); the ledger
// privileges none and hides none — provider · plan · 5h · 7d · Opus · Sonnet ·
// pace · resets · as of, one row per plan, so any two plans can be compared by
// running a finger down a column. It is the only variant that shows Claude's
// per-model weekly windows for EVERY plan, and the only one that puts each
// figure's age on the same line as the figure.
//
// WHY A SEMANTIC <table> AND NOT `display/UnifiedTable`. This is a 3–7 row,
// always-present, never-paginated, never-sorted instrument whose columns are
// fixed by the domain. `UnifiedTable` is built for the opposite case — a data
// list with sort/filter/search headers, virtualised rows at a fixed `rowHeight`,
// a row-entrance cascade, scroll restoration and its own empty/error/loading
// states. Here the empty state is PER ROW (a provider that is not installed is a
// row that says so across its cells, via `colSpan`, which `UnifiedTable`'s
// column-render contract cannot express), a sort would break the claude → codex
// → grok order the rest of the strip teaches, and the loading ghost has to sit
// inside specific rows. Using it would mean switching most of it off and then
// working around the rest; a real `<table>` with `scope`d headers and a caption
// is smaller and more accessible for this shape. Tokens are the design system's.
//
// A cell with no such window is a dash with a spoken "no such window" — never 0.

import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { BudgetsBlock } from '../BudgetsBlock';
import { windowIn, type PlanModel, type ProviderModel, type WindowSlot } from '../useResourceModel';
import {
  EmptyReason, Freshness, Ghost, PROVIDER_NAME, PROVIDER_TINT, PaceMark, PctText, PlanActions, PlanTrouble, ProviderName, SvgMeter,
  WindowName, planName, resetText, usePlanConfirm, windowSentence, type PlanConfirm, type UsageVariantProps,
} from './variantBits';

const SLOTS: readonly WindowSlot[] = ['short', 'long', 'opus', 'sonnet'];
const TH = 'px-2 py-1 text-left typo-caption text-foreground opacity-60 whitespace-nowrap';
const TD = 'px-2 py-1 align-middle typo-caption text-foreground';
/** provider + plan + four windows + pace + resets + as-of + actions. */
const COLUMNS = 10;

function WindowCell({ plan, slot, reduced }: { plan: PlanModel; slot: WindowSlot; reduced: boolean }) {
  const { t, tx } = useTranslation();
  const w = windowIn(plan, slot);
  if (!w) {
    return (
      <td className={TD} data-window="none">
        <span aria-hidden className="opacity-40">—</span>
        <span className="sr-only">{t.monitor.usage_window_none}</span>
      </td>
    );
  }
  return (
    <td className={TD} data-testid="fleet-usage-window" data-window={w.key} aria-label={windowSentence(t, tx, w)}>
      <span className="flex items-center gap-1.5">
        <PctText w={w} className="w-10 flex-shrink-0 justify-end" />
        <span className="block w-14 flex-shrink-0"><SvgMeter w={w} reduced={reduced} /></span>
      </span>
    </td>
  );
}

function PlanRow({
  provider, plan, first, confirm, reduced,
}: { provider: ProviderModel; plan: PlanModel; first: boolean; confirm: PlanConfirm; reduced: boolean }) {
  const { t } = useTranslation();
  const tint = PROVIDER_TINT[provider.id];
  const troubled = plan.state === 'unreadable' || plan.state === 'quarantined';
  const short = windowIn(plan, 'short');
  const long = windowIn(plan, 'long');
  // The pace that matters is the tighter window's: the session one when there is one.
  const paced = short ?? long;
  return (
    <tr
      className={`border-t border-border/40 ${plan.isActive ? 'bg-primary/[0.06]' : ''}`}
      data-testid="fleet-usage-plan" data-plan={plan.id} data-active={plan.isActive} data-state={plan.state}
    >
      <th scope="row" className={`${TD} border-l-2 text-left ${tint.border}`}>
        {first ? <ProviderName provider={provider} /> : <span className="sr-only">{PROVIDER_NAME[provider.id]}</span>}
      </th>
      <td className={`${TD} max-w-56`}>
        <span className="flex min-w-0 items-center gap-1">
          {plan.isActive ? (
            <span className="inline-flex flex-shrink-0 items-center text-primary">
              <Check className="h-3 w-3" aria-hidden />
              <span className="sr-only">{t.monitor.usage_accounts_active}</span>
            </span>
          ) : plan.slot !== null ? (
            <span className="flex-shrink-0 tabular-nums opacity-50">{plan.slot}</span>
          ) : null}
          <span className="min-w-0 truncate">{planName(t, plan)}</span>
        </span>
      </td>
      {troubled ? (
        <td className={TD} colSpan={6}><PlanTrouble plan={plan} /></td>
      ) : (
        <>
          {SLOTS.map((slot) => <WindowCell key={slot} plan={plan} slot={slot} reduced={reduced} />)}
          <td className={TD}><PaceMark pace={paced?.pace ?? null} withLabel /></td>
          <td className={`${TD} whitespace-nowrap tabular-nums`}>
            {[short, long].map((w) => w && (
              <span key={w.key} className="mr-2 inline-flex items-baseline gap-1">
                <WindowName w={w} className="opacity-60" />
                {resetText(t, w)}
              </span>
            ))}
          </td>
        </>
      )}
      <td className={`${TD} whitespace-nowrap opacity-70`}>
        {provider.readOnly ? <Freshness provider={provider} /> : plan.asOfMs !== null ? <RelativeTime timestamp={plan.asOfMs} /> : '—'}
      </td>
      <td className={`${TD} text-right`}><PlanActions plan={plan} confirm={confirm} /></td>
    </tr>
  );
}

export function LedgerStrip({ model, onSwitch, onRemove, simulated }: UsageVariantProps) {
  const { t } = useTranslation();
  const s = t.monitor;
  const reduced = useReducedMotion();
  const confirm = usePlanConfirm(onSwitch, onRemove);
  return (
    <div data-testid="fleet-usage-ledger" className="flex flex-col">
      <div className="overflow-x-auto px-1">
        <table className="w-full border-collapse">
          <caption className="sr-only">{s.usage_ledger_caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>{s.usage_col_provider}</th>
              <th scope="col" className={TH}>{s.usage_col_plan}</th>
              <th scope="col" className={TH}>{s.usage_window_five_hour}</th>
              <th scope="col" className={TH}>{s.usage_window_seven_day}</th>
              <th scope="col" className={TH}>{s.usage_window_seven_day_opus}</th>
              <th scope="col" className={TH}>{s.usage_window_seven_day_sonnet}</th>
              <th scope="col" className={TH}>{s.usage_col_pace}</th>
              <th scope="col" className={TH}>{s.usage_col_resets}</th>
              <th scope="col" className={TH}>{s.usage_col_as_of}</th>
              <th scope="col" className={TH}><span className="sr-only">{t.common.actions}</span></th>
            </tr>
          </thead>
          <tbody>
            {model.providers.map((p) => {
              if (p.plans.length > 0) {
                return p.plans.map((plan, i) => (
                  <PlanRow key={`${p.id}:${plan.id}`} provider={p} plan={plan} first={i === 0} confirm={confirm} reduced={reduced} />
                ));
              }
              return (
                <tr key={p.id} className="border-t border-border/40" data-testid="fleet-usage-provider" data-provider={p.id}>
                  <th scope="row" className={`${TD} border-l-2 text-left ${PROVIDER_TINT[p.id].border}`}><ProviderName provider={p} /></th>
                  <td className={TD} colSpan={COLUMNS - 1}>
                    {p.pending ? <Ghost className="h-3 w-64" /> : <EmptyReason reason={p.emptyReason ?? 'unreadable'} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <BudgetsBlock budgets={model.budgets} density="compact" simulated={simulated} reduced={reduced} />
      {confirm.dialogs}
    </div>
  );
}

export default LedgerStrip;
