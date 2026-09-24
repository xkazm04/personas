// Supply: what feeds the room. Each plan is one row with its two windows
// drawn as meters; the white tick on a meter is how much of the window has
// elapsed, so pace is the visible gap between fill and tick (fill past the
// tick is burning fast) instead of an icon to decode. The live plan is the
// lit row; clicking any other switchable row asks to make it live.

import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { ProviderIcon } from '../../usage/ProviderIcon';
import type { PlanModel, ProviderModel, WindowModel } from '../../usage/useResourceModel';
import { cliReasonLabel, providerName, reasonLabel, windowSentence } from '../../usageBits';
import type { UsageFeed } from '../useUsageFeed';

function Meter({ w }: { w: WindowModel | undefined }) {
  const { t, tx } = useTranslation();
  if (!w) return <span className="w-[5.5rem] flex-shrink-0 text-right typo-caption" aria-hidden>·</span>;
  const pct = Math.round(w.usedPct);
  const ink = w.tone === 'error' ? 'text-status-error' : w.tone === 'warning' ? 'text-status-warning' : 'text-foreground';
  return (
    <Tooltip content={windowSentence(t, tx, w)} delay={200}>
      <span className="flex w-[5.5rem] flex-shrink-0 items-center gap-1.5" aria-label={windowSentence(t, tx, w)}>
        <span className="ed-meter flex-1 rounded-full" data-tone={w.tone}>
          <span className="ed-fill rounded-full" style={{ width: `${pct}%` }} />
          {w.elapsedFrac !== null && <span className="ed-tick rounded-full" style={{ left: `calc(${Math.round(w.elapsedFrac * 100)}% - 1px)` }} />}
        </span>
        <span className={`w-9 text-right typo-caption tabular-nums ${ink} ${w.projected ? 'italic' : ''}`}>{pct}%</span>
      </span>
    </Tooltip>
  );
}

function PlanRow({ provider, plan, usage }: { provider: ProviderModel; plan: PlanModel; usage: UsageFeed }) {
  const { t, tx } = useTranslation();
  const short = plan.windows.find((w) => w.label === 'short');
  const long = plan.windows.find((w) => w.label === 'long');
  const name = plan.name ?? providerName(t, provider.id);
  const switchable = !provider.readOnly && plan.canSwitch;
  const trouble = plan.state === 'unreadable' || plan.state === 'quarantined';
  const body = (
    <>
      <ProviderIcon provider={provider.id} className="h-3.5 w-3.5 flex-shrink-0" />
      <span aria-hidden data-lamp={plan.isActive ? 'live' : trouble ? 'failed' : 'idle'} className="ed-lamp" />
      <span className={`min-w-0 flex-1 truncate typo-body ${plan.isActive ? 'text-primary' : 'text-foreground'}`}>{name}</span>
      {trouble ? (
        <span className="min-w-0 max-w-[45%] truncate typo-caption text-status-warning">
          {plan.state === 'quarantined' ? t.monitor.usage_accounts_quarantined : reasonLabel(t, plan.reason)}
        </span>
      ) : (<><Meter w={short} /><Meter w={long} /></>)}
    </>
  );
  return (
    <div className="ed-row ed-spill group flex items-center" data-lamp={plan.isActive ? 'live' : undefined} data-testid="entry-d-plan">
      {switchable ? (
        <Tooltip content={tx(t.monitor.usage_accounts_switch_aria, { email: name })} delay={300}>
          <button type="button" onClick={() => usage.ask('switch', plan)} aria-label={tx(t.monitor.usage_accounts_switch_aria, { email: name })}
            className="focus-ring flex h-9 min-w-0 flex-1 items-center gap-2 px-3 text-left">
            {body}
          </button>
        </Tooltip>
      ) : (
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 px-3">{body}</div>
      )}
      {plan.canRemove && (
        <Tooltip content={t.monitor.usage_accounts_remove_hint}>
          <Button variant="ghost" size="icon-sm" className="mr-1" aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: name })}
            onClick={() => usage.ask('remove', plan)} icon={<X className="h-3.5 w-3.5" aria-hidden />} />
        </Tooltip>
      )}
    </div>
  );
}

function RotateControl({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<number | null>(null);
  const ar = usage.autoRotate;
  if (!ar) return null;
  const shown = draft ?? ar.thresholdPct;
  return (
    <Tooltip content={t.monitor.usage_auto_rotate_hint}>
      <span className="flex flex-shrink-0 items-center gap-1.5 typo-caption" data-testid="fleet-usage-controls">
        <AccessibleToggle size="sm" checked={ar.enabled} onChange={() => usage.saveAutoRotate(!ar.enabled, shown)} label={t.monitor.usage_auto_rotate} />
        <span className="truncate">{t.monitor.usage_auto_rotate}</span>
        <input
          type="number" min={1} max={100} step={5} value={shown}
          aria-label={t.monitor.usage_auto_rotate_threshold_aria}
          onChange={(e) => setDraft(Number(e.target.value))}
          onBlur={() => {
            const pct = Math.max(1, Math.min(100, Math.round(shown)));
            setDraft(null);
            if (pct !== ar.thresholdPct) usage.saveAutoRotate(ar.enabled, pct);
          }}
          className="w-12 rounded-input border border-border bg-background px-1 text-right typo-caption tabular-nums text-foreground"
          data-testid="fleet-usage-rotate-threshold"
        />
        <span>%</span>
      </span>
    </Tooltip>
  );
}

export function SupplyPanel({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  const providers = usage.model.providers;
  return (
    <section className="flex flex-shrink-0 flex-col border-b border-border" aria-label={t.monitor.usage_resources_aria} data-testid="entry-d-supply">
      <div className="flex h-10 items-center gap-2 px-3">
        <span className="min-w-0 flex-1 truncate typo-label text-foreground">{t.monitor.usage_title}</span>
        {usage.fetchedAt !== null && (
          <span className="ed-hide-sm typo-caption">{t.monitor.usage_as_of} <RelativeTime timestamp={usage.fetchedAt} /></span>
        )}
        <Tooltip content={usage.refreshHint}>
          <AsyncButton variant="ghost" size="icon-sm" aria-label={t.monitor.usage_refresh} disabled={!usage.canRefresh}
            onClick={() => usage.refresh()} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} />
        </Tooltip>
      </div>
      <div className="flex items-center gap-2 px-3 pb-1.5 typo-caption">
        <span className="flex min-w-0 flex-1 items-center"><RotateControl usage={usage} /></span>
        <span aria-hidden className="w-[5.5rem] text-center">5{t.monitor.usage_unit_hour}</span>
        <span aria-hidden className="w-[5.5rem] text-center">7{t.monitor.usage_unit_day}</span>
      </div>
      {providers.map((p) => p.plans.length > 0 ? p.plans.map((plan) => (
        <PlanRow key={`${p.id}:${plan.id}`} provider={p} plan={plan} usage={usage} />
      )) : (
        <div key={p.id} className="ed-row flex h-9 items-center gap-2 px-3">
          <ProviderIcon provider={p.id} className="h-3.5 w-3.5 flex-shrink-0" />
          <span aria-hidden data-lamp="idle" className="ed-lamp" />
          <span className="min-w-0 flex-1 truncate typo-body text-foreground">{providerName(t, p.id)}</span>
          {p.pending ? <span className="ed-ghost h-2 w-24 rounded-full" aria-hidden />
            : p.emptyReason && <span className="truncate typo-caption">{cliReasonLabel(t, p.emptyReason)}</span>}
        </div>
      ))}
    </section>
  );
}
