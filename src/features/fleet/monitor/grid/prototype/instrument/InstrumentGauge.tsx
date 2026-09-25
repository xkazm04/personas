// InstrumentGauge — one subscription plan as a compact gauge card: the
// provider mark and account on top, then one hairline meter per window
// (5h, 7d) with ticks at 25/50/75, the percent in its tone and the pace glyph.
// The live plan is lit; clicking a switchable plan asks to switch to it.

import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { formatPercent } from '@/lib/utils/formatters';
import {
  FILL, PACE_ICON, PACE_TONE, TONE_TEXT, cliReasonHint, cliReasonLabel, providerName, reasonLabel, windowSentence, windowTitle,
} from '../../usageBits';
import { ProviderIcon } from '../../usage/ProviderIcon';
import { windowIn, type PlanModel, type ProviderModel, type WindowModel } from '../../usage/useResourceModel';
import type { UsageFeed } from '../useUsageFeed';
import { LIT_EDGE } from './parts';

const CARD = 'group/plan relative flex min-w-[13.5rem] max-w-[19rem] flex-1 flex-col gap-1 rounded-interactive border px-2.5 py-1.5 text-left transition-colors';

function Meter({ w, fallback }: { w: WindowModel | null; fallback: string }) {
  const { t, tx } = useTranslation();
  if (!w) {
    return (
      <span className="flex items-center gap-2 typo-code text-foreground" data-testid="fleet-usage-window" data-empty>
        <span className="w-6">{fallback}</span>
        <span className="h-px flex-1 bg-foreground/10" />
        <span className="w-9 text-right">—</span>
      </span>
    );
  }
  const Pace = w.pace ? PACE_ICON[w.pace] : null;
  return (
    <Tooltip content={windowSentence(t, tx, w)}>
      <span className="flex items-center gap-2 typo-code" data-testid="fleet-usage-window" data-tone={w.tone}>
        <span className="w-6 text-foreground">{windowTitle(t, w)}</span>
        <span className="relative h-1 flex-1 overflow-hidden rounded-pill bg-foreground/10">
          {[25, 50, 75].map((tick) => (
            <span key={tick} aria-hidden className="absolute inset-y-0 w-px bg-background" style={{ left: `${tick}%` }} />
          ))}
          <span className={`block h-full ${FILL[w.tone]} ${w.projected ? 'opacity-50' : ''}`} style={{ width: `${w.usedPct}%` }} />
        </span>
        <span className={`w-9 text-right tabular-nums ${TONE_TEXT[w.tone]}`} data-testid="fleet-usage-percent">
          {w.projected ? '≈' : ''}{formatPercent(w.usedPct, { precision: 0 })}
        </span>
        <span className={`inline-flex w-3.5 ${w.pace ? PACE_TONE[w.pace] : ''}`}>
          {Pace && <Pace className="h-3.5 w-3.5" aria-hidden />}
        </span>
      </span>
    </Tooltip>
  );
}

export function InstrumentGauge({ provider, plan, ask }: { provider: ProviderModel; plan: PlanModel; ask: UsageFeed['ask'] }) {
  const { t, tx } = useTranslation();
  const name = plan.name ?? (provider.readOnly ? providerName(t, provider.id) : t.monitor.usage_plan_live_login);
  const trouble = plan.state === 'quarantined' || plan.state === 'unreadable';
  const canSwitch = !provider.readOnly && plan.canSwitch;
  const canRemove = !provider.readOnly && plan.canRemove;
  const troubleLabel = plan.state === 'quarantined' ? t.monitor.usage_accounts_quarantined : t.monitor.usage_unavailable;
  const troubleHint = plan.state === 'quarantined' ? t.monitor.usage_accounts_quarantined_hint : reasonLabel(t, plan.reason);

  return (
    <div
      role="group"
      aria-label={[providerName(t, provider.id), name, trouble ? troubleLabel : null].filter(Boolean).join(' · ')}
      // Pointer convenience only: the whole card is the target. The keyboard's
      // door is the account-name Button inside it, which carries the act's name.
      className={`${CARD} ${plan.isActive ? 'border-primary/40 bg-primary/[0.06]' : 'border-primary/10 bg-foreground/[0.02]'} ${
        canSwitch ? 'cursor-pointer hover:border-primary/30' : ''
      }`}
      style={plan.isActive ? LIT_EDGE : undefined}
      onClick={canSwitch ? () => ask('switch', plan) : undefined}
      data-testid="fleet-usage-account"
      data-provider={provider.id}
      data-active={plan.isActive}
      data-state={plan.state}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Tooltip content={provider.version ? `${providerName(t, provider.id)} ${provider.version}` : providerName(t, provider.id)}>
          <span className="inline-flex flex-shrink-0 text-foreground"><ProviderIcon provider={provider.id} /></span>
        </Tooltip>
        {canSwitch ? (
          <Tooltip content={t.monitor.usage_accounts_switch}>
            <Button
              variant="ghost"
              size="xs"
              onClick={(e) => { e.stopPropagation(); ask('switch', plan); }}
              aria-label={tx(t.monitor.usage_accounts_switch_aria, { email: name })}
              className="min-w-0 text-left [&>span]:min-w-0"
              data-testid="fleet-usage-switch"
            >
              <span className="block truncate typo-body text-foreground">{name}</span>
            </Button>
          </Tooltip>
        ) : (
          <span className="min-w-0 truncate typo-body text-foreground" data-testid="fleet-usage-name">{name}</span>
        )}
        {trouble && (
          <Tooltip content={troubleHint}>
            <span className="flex-shrink-0 typo-code text-status-warning">{troubleLabel}</span>
          </Tooltip>
        )}
        {canRemove && (
          <Tooltip content={t.monitor.usage_accounts_remove_hint}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => { e.stopPropagation(); ask('remove', plan); }}
              aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: name })}
              className="ml-auto flex-shrink-0 opacity-0 hover:text-status-error focus-visible:opacity-100 group-hover/plan:opacity-70"
              data-testid="fleet-usage-remove"
              icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
            />
          </Tooltip>
        )}
      </span>
      {!trouble && (
        <>
          <Meter w={windowIn(plan, 'short')} fallback="5h" />
          <Meter w={windowIn(plan, 'long')} fallback="7d" />
        </>
      )}
    </div>
  );
}

/**
 * A provider with nothing to meter: still a gauge card in the capacity row,
 * carrying its mark and the reason in words (the baseline's EmptyProviderRow).
 * Not a settled-empty region, so it is not a ScenarioEmptyState.
 */
export function InstrumentGaugeUnmetered({ provider }: { provider: ProviderModel }) {
  const { t } = useTranslation();
  const reason = provider.emptyReason ?? 'unreadable';
  return (
    <Tooltip content={cliReasonHint(t, reason)}>
      <div className={`${CARD} border-dashed border-primary/10`} data-testid="fleet-usage-empty" data-provider={provider.id}>
        <span className="flex items-center gap-1.5">
          <ProviderIcon provider={provider.id} />
          <span className="truncate typo-body text-foreground">{providerName(t, provider.id)}</span>
        </span>
        <span className="typo-caption">{cliReasonLabel(t, reason)}</span>
      </div>
    </Tooltip>
  );
}

export function InstrumentGaugeGhost() {
  return <div aria-hidden className={`${CARD} h-[4.25rem] border-dashed border-primary/10 animate-fade-in`} style={{ animationDelay: '180ms' }} />;
}
