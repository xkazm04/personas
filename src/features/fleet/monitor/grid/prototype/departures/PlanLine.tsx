// Departures · PlanLine — one subscription plan as one tabular row.
// PROTOTYPE (variant C).
//
//   ▌✳ ascent-dev@…  5h ▬▬▬▭▭ 24%  7d ▬▬▬▬▬ 89% 🔥   Switch  🗑
//
// Every row has the same columns, so ten plans read down as two meters' worth
// of numbers. The live plan carries a primary bar on its leading edge; a
// standby plan beside it steps back until hovered.

import { memo, type MouseEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { FILL, PACE_ICON, PACE_TONE, TONE_TEXT, cliReasonHint, cliReasonLabel, providerName, reasonLabel, windowSentence, windowTitle } from '../../usageBits';
import { ProviderIcon } from '../../usage/ProviderIcon';
import { windowIn, type PlanModel, type ProviderModel, type WindowModel } from '../../usage/useResourceModel';

/** Shared by the row and the block's column captions. */
export const PLAN_COLS = 'grid grid-cols-[1.25rem_minmax(0,1fr)_7.5rem_7.5rem_4.5rem] items-center gap-x-3';

function Meter({ w }: { w: WindowModel | null }) {
  const { t, tx } = useTranslation();
  if (!w) return <span className="typo-caption text-foreground opacity-30">—</span>;
  const Pace = w.pace ? PACE_ICON[w.pace] : null;
  return (
    <Tooltip content={windowSentence(t, tx, w)}>
      <span className="flex min-w-0 items-center gap-1.5" data-testid="fleet-usage-window" data-tone={w.tone}>
        <span className="w-5 flex-shrink-0 typo-label text-foreground opacity-50">{windowTitle(t, w)}</span>
        <span aria-hidden className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-pill bg-foreground/10">
          <span className={`absolute inset-y-0 left-0 ${FILL[w.tone]} ${w.projected ? 'opacity-50' : ''}`} style={{ width: `${w.usedPct}%` }} />
        </span>
        <span className={`w-9 flex-shrink-0 text-right typo-data tabular-nums ${TONE_TEXT[w.tone]} ${w.projected ? 'opacity-70' : ''}`}>
          {w.projected && '≈'}<Numeric value={w.usedPct} unit="percent" precision={0} />
        </span>
        {Pace && <Pace className={`h-3.5 w-3.5 flex-shrink-0 ${PACE_TONE[w.pace!]}`} aria-hidden />}
      </span>
    </Tooltip>
  );
}

export const PlanLine = memo(function PlanLine({
  provider, plan, recede, ask,
}: {
  provider: ProviderModel;
  plan: PlanModel;
  recede: boolean;
  ask: (kind: 'switch' | 'remove', plan: PlanModel) => void;
}) {
  const { t, tx } = useTranslation();
  const name = plan.name ?? (provider.readOnly ? providerName(t, provider.id) : t.monitor.usage_plan_live_login);
  const trouble = plan.state === 'quarantined' || plan.state === 'unreadable';
  const canSwitch = !provider.readOnly && plan.canSwitch;
  const canRemove = !provider.readOnly && plan.canRemove;
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      role="group"
      aria-label={[providerName(t, provider.id), name].join(' · ')}
      onClick={canSwitch ? () => ask('switch', plan) : undefined}
      className={`group relative ${PLAN_COLS} border-b border-border/30 py-1 pl-2 pr-1 transition-[opacity,background-color] ${
        recede ? 'opacity-60 hover:opacity-100 focus-within:opacity-100' : ''
      } ${canSwitch ? 'cursor-pointer hover:bg-secondary/30' : ''}`}
      data-testid="fleet-usage-account"
      data-provider={provider.id}
      data-active={plan.isActive}
      data-state={plan.state}
    >
      {plan.isActive && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <Tooltip content={providerName(t, provider.id)}>
        <span className="inline-flex text-foreground"><ProviderIcon provider={provider.id} /></span>
      </Tooltip>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={`min-w-0 truncate typo-body ${plan.isActive ? 'text-primary' : 'text-foreground'}`}>{name}</span>
        {trouble && (
          <Tooltip content={plan.state === 'quarantined' ? t.monitor.usage_accounts_quarantined_hint : reasonLabel(t, plan.reason)}>
            <span className="flex-shrink-0 typo-caption text-status-warning">
              {plan.state === 'quarantined' ? t.monitor.usage_accounts_quarantined : t.monitor.usage_unavailable}
            </span>
          </Tooltip>
        )}
      </span>
      {trouble ? <span className="col-span-2" /> : (
        <>
          <Meter w={windowIn(plan, 'short')} />
          <Meter w={windowIn(plan, 'long')} />
        </>
      )}
      <span className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {canSwitch && (
          <button
            type="button"
            onClick={(e) => { stop(e); ask('switch', plan); }}
            aria-label={tx(t.monitor.usage_accounts_switch_aria, { email: name })}
            data-testid="fleet-usage-switch"
            className="focus-ring rounded-interactive px-1 typo-label text-primary hover:bg-secondary/50"
          >
            {t.monitor.usage_accounts_switch}
          </button>
        )}
        {canRemove && (
          <Tooltip content={t.monitor.usage_accounts_remove_hint}>
            <button
              type="button"
              onClick={(e) => { stop(e); ask('remove', plan); }}
              aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: name })}
              data-testid="fleet-usage-remove"
              className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded-interactive text-foreground hover:text-status-error"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tooltip>
        )}
      </span>
    </div>
  );
});

/** A provider with nothing to meter: its mark and the reason, in words. */
export function EmptyPlanLine({ provider }: { provider: ProviderModel }) {
  const { t } = useTranslation();
  const reason = provider.emptyReason ?? 'unreadable';
  return (
    <div className={`${PLAN_COLS} border-b border-border/30 py-1 pl-2 pr-1`} data-testid="fleet-usage-empty" data-provider={provider.id}>
      <span className="inline-flex text-foreground opacity-60"><ProviderIcon provider={provider.id} /></span>
      <Tooltip content={cliReasonHint(t, reason)}>
        <span className="col-span-4 min-w-0 truncate typo-caption text-foreground opacity-55">
          {providerName(t, provider.id)} · {cliReasonLabel(t, reason)}
        </span>
      </Tooltip>
    </div>
  );
}
