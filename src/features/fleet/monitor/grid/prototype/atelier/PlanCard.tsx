// Atelier plan card — one subscription plan as a soft card: provider mark,
// account name (ellipsised only at the card's own width), a "Live" pill on the
// active plan, and two labelled rounded meters — the short (5 h) and long
// (week) windows — with the percent in words and the full sentence in a
// Tooltip. Pressing a switchable card asks to switch; remove appears on hover.

import { memo } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ProviderIcon } from '../../usage/ProviderIcon';
import { providerName, reasonLabel, windowSentence, windowTitle } from '../../usageBits';
import { windowIn, type PlanModel, type ProviderModel, type WindowModel } from '../../usage/useResourceModel';
import type { MeterTone } from '../../usageModel';

const BAR: Record<MeterTone, string> = {
  ok: 'bg-primary/80',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
};

function Meter({ w, fallback }: { w: WindowModel | null; fallback: string }) {
  const { t, tx } = useTranslation();
  if (!w) {
    return (
      <div className="flex flex-col gap-1 opacity-45">
        <div className="flex items-baseline justify-between typo-caption text-foreground">
          <span>{fallback}</span><span>—</span>
        </div>
        <div className="h-1.5 rounded-pill bg-foreground/[0.06]" />
      </div>
    );
  }
  return (
    <Tooltip content={windowSentence(t, tx, w)}>
      <div className="flex flex-col gap-1" data-testid="fleet-usage-window" data-tone={w.tone} data-window={w.label}>
        <div className="flex items-baseline justify-between gap-2 typo-caption text-foreground">
          <span className="opacity-70">{windowTitle(t, w)}</span>
          <span className={`typo-data tabular-nums ${w.tone === 'ok' ? 'text-foreground' : w.tone === 'warning' ? 'text-status-warning' : 'text-status-error'}`}>
            {w.projected && '≈'}<Numeric value={w.usedPct} unit="percent" precision={0} />
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-pill bg-foreground/[0.07]">
          <div
            className={`h-full rounded-pill transition-[width] duration-500 motion-reduce:transition-none ${BAR[w.tone]} ${w.projected ? 'opacity-50' : ''}`}
            style={{ width: `${Math.max(2, w.usedPct)}%` }}
          />
        </div>
      </div>
    </Tooltip>
  );
}

export const PlanCard = memo(function PlanCard({
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

  return (
    <div
      role="group"
      aria-label={`${providerName(t, provider.id)} · ${name}`}
      onClick={canSwitch ? () => ask('switch', plan) : undefined}
      className={`group/plan relative flex w-60 flex-shrink-0 flex-col gap-2.5 rounded-card bg-secondary/30 p-3 shadow-elevation-1 transition-[opacity,background-color,box-shadow] ${
        plan.isActive ? 'ring-2 ring-primary/55' : ''
      } ${recede ? 'opacity-70 hover:opacity-100 focus-within:opacity-100' : ''} ${canSwitch ? 'cursor-pointer hover:bg-secondary/45 hover:shadow-elevation-2' : ''}`}
      data-testid="fleet-usage-account"
      data-provider={provider.id}
      data-active={plan.isActive}
      data-state={plan.state}
    >
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 text-foreground"><ProviderIcon provider={provider.id} /></span>
        {canSwitch ? (
          <Tooltip content={`${name} · ${t.monitor.usage_accounts_switch}`}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); ask('switch', plan); }}
              aria-label={tx(t.monitor.usage_accounts_switch_aria, { email: name })}
              className="focus-ring min-w-0 flex-1 truncate rounded-interactive text-left typo-body text-foreground"
              data-testid="fleet-usage-switch"
            >
              {name}
            </button>
          </Tooltip>
        ) : (
          <span className="min-w-0 flex-1 truncate typo-body text-foreground" data-testid="fleet-usage-name">{name}</span>
        )}
        {plan.isActive && <span className="flex-shrink-0 rounded-pill bg-primary/15 px-2 typo-label text-primary">Live</span>}
        {canRemove && (
          <Tooltip content={t.monitor.usage_accounts_remove_hint}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); ask('remove', plan); }}
              aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: name })}
              className="focus-ring inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-interactive text-foreground opacity-0 transition-opacity hover:text-status-error focus-visible:opacity-100 group-hover/plan:opacity-70"
              data-testid="fleet-usage-remove"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
      {trouble ? (
        <p className="typo-caption text-status-warning" data-testid="fleet-usage-trouble">
          {plan.state === 'quarantined' ? t.monitor.usage_accounts_quarantined : reasonLabel(t, plan.reason)}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Meter w={windowIn(plan, 'short')} fallback="5 h" />
          <Meter w={windowIn(plan, 'long')} fallback="Week" />
        </div>
      )}
    </div>
  );
});
