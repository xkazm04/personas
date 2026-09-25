// Subscription usage as FUEL: each window is a strip of twenty lamps and the
// lit ones are what is LEFT. A plan burning down goes dark from the right and
// turns amber, then red - the panel dims exactly as the budget does, so a
// drained plan cannot look healthy. On the live plan the auto-rotate threshold
// is a notch on its 5-hour strip: when the light drains past it, the rotation
// fires. The printed number stays "used %", the app's one vocabulary.

import { useState } from 'react';
import { ArrowLeftRight, RefreshCw, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { formatPercent } from '@/lib/utils/formatters';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ProviderIcon } from '../../usage/ProviderIcon';
import type { PlanModel, ProviderModel, WindowModel } from '../../usage/useResourceModel';
import { cliReasonLabel, PACE_ICON, providerName, reasonLabel, windowSentence, windowTitle } from '../../usageBits';
import type { UsageFeed } from '../useUsageFeed';
import { Engraved, Lamp, Segments } from './parts';
import { METER_TONE } from './tone';

const SEGS = 20;

function WindowStrip({ w, threshold }: { w: WindowModel; threshold: number | null }) {
  const { t, tx } = useTranslation();
  const Pace = w.pace ? PACE_ICON[w.pace] : null;
  const left = Math.max(0, 100 - w.usedPct);
  const tone = METER_TONE[w.tone];
  return (
    <Tooltip content={windowSentence(t, tx, w)}>
      <div className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-2" aria-label={windowSentence(t, tx, w)} role="img">
        <span className="typo-caption tabular-nums">{windowTitle(t, w)}</span>
        <Segments count={SEGS} lit={(left / 100) * SEGS} tone={tone} mark={threshold !== null ? ((100 - threshold) / 100) * SEGS : null} />
        <span className={`inline-flex min-w-[3.25rem] items-center justify-end gap-1 typo-data tabular-nums ${
          w.tone === 'error' ? 'text-status-error' : w.tone === 'warning' ? 'text-status-warning' : 'text-foreground'}`}>
          {Pace && <Pace className="h-3 w-3" aria-hidden />}
          {formatPercent(w.usedPct, { precision: 0 })}
        </span>
      </div>
    </Tooltip>
  );
}

function PlanBlock({ plan, readOnly, usage }: { plan: PlanModel; readOnly: boolean; usage: UsageFeed }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const threshold = plan.isActive && usage.autoRotate?.enabled ? usage.autoRotate.thresholdPct : null;
  const email = plan.name ?? '';
  return (
    <div
      className={`ae-win flex flex-col gap-1.5 rounded-input px-2.5 py-2 ${plan.isActive ? 'is-lit ae-t-run' : ''}`}
      data-testid="entry-e-plan"
      data-active={plan.isActive || undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Lamp lamp={{ tone: plan.state === 'quarantined' ? 'err' : 'run', lit: plan.isActive }} />
        <Tooltip content={plan.isActive ? `${email} · ${m.usage_plan_live_login}` : email}>
          <span className="min-w-0 flex-1 truncate typo-body text-foreground">{plan.name ?? m.usage_not_stored}</span>
        </Tooltip>
        {!readOnly && plan.canSwitch && (
          <Tooltip content={tx(m.usage_accounts_switch_aria, { email })}>
            <Button variant="ghost" size="icon-sm" onClick={() => usage.ask('switch', plan)} aria-label={tx(m.usage_accounts_switch_aria, { email })} icon={<ArrowLeftRight className="h-3.5 w-3.5" />} />
          </Tooltip>
        )}
        {!readOnly && plan.canRemove && (
          <Tooltip content={m.usage_accounts_remove_hint}>
            <Button variant="ghost" size="icon-sm" onClick={() => usage.ask('remove', plan)} aria-label={tx(m.usage_accounts_remove_aria, { email })} icon={<X className="h-3.5 w-3.5" />} />
          </Tooltip>
        )}
      </div>
      {plan.state === 'unreadable' || plan.state === 'quarantined' ? (
        <p className="typo-caption text-status-warning">
          {plan.state === 'quarantined' ? m.usage_accounts_quarantined : reasonLabel(t, plan.reason)}
        </p>
      ) : (
        plan.windows.filter((w) => w.label === 'short' || w.label === 'long').map((w) => (
          <WindowStrip key={w.key} w={w} threshold={w.label === 'short' ? threshold : null} />
        ))
      )}
      {plan.state === 'projected' && <span className="typo-caption">{m.usage_projected_short}</span>}
    </div>
  );
}

function ProviderPlate({ provider, usage }: { provider: ProviderModel; usage: UsageFeed }) {
  const { t } = useTranslation();
  const name = providerName(t, provider.id);
  return (
    <div className="flex flex-col gap-1.5" data-testid={`entry-e-provider-${provider.id}`}>
      <span className="flex items-center gap-2 px-0.5">
        <ProviderIcon provider={provider.id} className="text-foreground" />
        <span className="typo-label text-foreground">{name}</span>
      </span>
      {provider.pending && provider.plans.length === 0 && <span className="ae-ghost h-14 rounded-input" aria-hidden />}
      {provider.plans.map((p) => <PlanBlock key={p.id} plan={p} readOnly={provider.readOnly} usage={usage} />)}
      {!provider.pending && provider.plans.length === 0 && provider.emptyReason && (
        <p className="px-0.5 typo-caption">{cliReasonLabel(t, provider.emptyReason)}</p>
      )}
    </div>
  );
}

export function PlanPlates({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const [draft, setDraft] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const rotate = usage.autoRotate;
  const shown = draft ?? rotate?.thresholdPct ?? 80;

  return (
    <section className="ae-plate flex flex-col gap-3 rounded-card p-3" aria-label={m.usage_aria} data-testid="entry-e-usage">
      <header className="flex flex-col gap-1">
        <Engraved>{m.usage_title}</Engraved>
        <span className="flex items-center gap-1.5 typo-caption">
          <span>{m.usage_as_of}</span>
          {usage.fetchedAt !== null && <RelativeTime timestamp={usage.fetchedAt} className="tabular-nums" />}
          <span className="flex-1" />
          <Tooltip content={usage.refreshHint}>
            <AsyncButton
              variant="ghost"
              size="icon-sm"
              isLoading={refreshing}
              disabled={!usage.canRefresh}
              aria-label={usage.refreshHint}
              onClick={() => { setRefreshing(true); void usage.refresh().finally(() => setRefreshing(false)); }}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            />
          </Tooltip>
        </span>
      </header>
      {usage.model.providers.map((p) => <ProviderPlate key={p.id} provider={p} usage={usage} />)}
      {rotate && (
        <Tooltip content={m.usage_auto_rotate_hint}>
          <div className="flex items-center gap-2 border-t border-border pt-2.5">
            <AccessibleToggle size="sm" checked={rotate.enabled} onChange={() => usage.saveAutoRotate(!rotate.enabled, shown)} label={m.usage_auto_rotate} />
            <span className="typo-caption text-foreground">{m.usage_auto_rotate}</span>
            <input
              type="number"
              min={1}
              max={100}
              step={5}
              value={shown}
              aria-label={m.usage_auto_rotate_threshold_aria}
              onChange={(e) => setDraft(Number(e.target.value))}
              onBlur={() => {
                const pct = Math.max(1, Math.min(100, Math.round(shown)));
                setDraft(null);
                if (pct !== rotate.thresholdPct) usage.saveAutoRotate(rotate.enabled, pct);
              }}
              className="ml-auto w-14 rounded-input border border-border bg-background px-1.5 py-0.5 text-right typo-data tabular-nums text-foreground"
              data-testid="fleet-usage-rotate-threshold"
            />
            <span className="typo-caption">%</span>
          </div>
        </Tooltip>
      )}
    </section>
  );
}
