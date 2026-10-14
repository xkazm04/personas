// Subscription usage as FUEL, one glance wide: a plan is ONE ROW of two thin
// bars - the short window over the long one - and the bar's lit length is what
// is LEFT. A plan burning down shortens from the right and turns amber, then
// red, so a drained plan cannot look healthy. On the live plan the auto-rotate
// threshold is a notch on its short bar.
//
// WHY ONE ROW (2026-10-12). The previous plate spent two rows and a provider
// header per plan: with seven stored Claude logins plus the other CLIs the
// supply column scrolled, and "what is left across everything" was the one
// question it could not answer without scrolling. The row now carries only what
// a glance needs - which provider, which bar, how much is left. The name, the
// percentages, the countdowns, switch / remove and the rotate rule are one press
// away in `PlanPopover`. Providers are told apart by their mark at the row's
// head and by a hairline between groups, not by a header of their own.

import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ProviderIcon } from '../../usage/ProviderIcon';
import type { PlanModel, ProviderModel, WindowSlot } from '../../usage/useResourceModel';
import { cliReasonLabel, providerName, windowSentence } from '../../usageBits';
import type { UsageFeed } from '../useUsageFeed';
import { Engraved, Lamp } from './parts';
import { PlanPopover } from './PlanPopover';
import { METER_TONE, toneClass } from './tone';

/** A bar's lit share is what is LEFT; the printed number elsewhere stays "used %". */
function Bar({ plan, slot, mark }: { plan: PlanModel; slot: WindowSlot; mark: number | null }) {
  const w = plan.windows.find((x) => x.label === slot) ?? null;
  const left = w ? Math.max(0, 100 - w.usedPct) : 0;
  return (
    <span className={`ae-bar ${w ? toneClass(METER_TONE[w.tone]) : 'is-empty'} ${w?.projected ? 'is-projected' : ''}`} aria-hidden>
      {w && <i style={{ width: `${left}%` }} />}
      {w && mark !== null && <b style={{ left: `${100 - mark}%` }} />}
    </span>
  );
}

function PlanRow({ plan, provider, first, usage, open, onToggle }: {
  plan: PlanModel; provider: ProviderModel; first: boolean; usage: UsageFeed; open: boolean; onToggle: () => void;
}) {
  const { t, tx } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const dead = plan.state === 'unreadable' || plan.state === 'quarantined';
  const threshold = plan.isActive && usage.autoRotate?.enabled ? usage.autoRotate.thresholdPct : null;
  const name = `${providerName(t, provider.id)} ${plan.name ?? t.monitor.usage_not_stored}`;
  const label = dead
    ? name
    : [name, ...plan.windows.filter((w) => w.label === 'short' || w.label === 'long').map((w) => windowSentence(t, tx, w))].join(' · ');
  return (
    <>
      <Button
        ref={ref}
        variant="ghost"
        size="xs"
        onClick={onToggle}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="entry-e-plan"
        data-active={plan.isActive || undefined}
        className={`ae-plan w-full ${first ? 'is-first' : ''} ${plan.isActive ? 'is-live' : ''} ${open ? 'is-open' : ''} ${dead ? 'is-dead' : ''}`}
      >
        <span className="flex w-full items-center gap-2">
          {first ? <ProviderIcon provider={provider.id} className="text-foreground" /> : <span className="h-4 w-4 flex-shrink-0" aria-hidden />}
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <Bar plan={plan} slot="short" mark={threshold} />
            <Bar plan={plan} slot="long" mark={null} />
          </span>
          <Lamp lamp={{ tone: plan.state === 'quarantined' ? 'err' : dead ? 'warn' : 'run', lit: plan.isActive || dead }} />
        </span>
      </Button>
      {open && (
        <PlanPopover
          plan={plan} provider={provider} usage={usage} anchorRef={ref}
          readOnly={provider.readOnly} onClose={onToggle}
        />
      )}
    </>
  );
}

/** A provider that has no plan to meter still owns one row: its mark and the reason, in words. */
function EmptyRow({ provider }: { provider: ProviderModel }) {
  const { t } = useTranslation();
  const text = provider.pending ? null : provider.emptyReason ? cliReasonLabel(t, provider.emptyReason) : null;
  return (
    <div className="ae-plan is-first is-empty" data-testid={`entry-e-provider-${provider.id}`}>
      <ProviderIcon provider={provider.id} className="text-foreground" />
      {text ? <span className="min-w-0 flex-1 truncate typo-caption">{text}</span> : <span className="ae-ghost h-2 flex-1 rounded-full" aria-hidden />}
    </div>
  );
}

export function PlanPlates({ usage }: { usage: UsageFeed; revealEnabled?: boolean }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="ae-plate flex flex-col gap-2 rounded-card p-3" aria-label={m.usage_aria} data-testid="entry-e-usage">
      <header className="flex items-center gap-1.5">
        <Engraved>{m.usage_title}</Engraved>
        <span className="flex-1" />
        {usage.fetchedAt !== null && <RelativeTime timestamp={usage.fetchedAt} className="typo-caption tabular-nums" />}
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
      </header>
      <div className="flex flex-col" data-testid="entry-e-plan-list">
        {usage.model.providers.map((p) => (
          p.plans.length === 0
            ? <EmptyRow key={p.id} provider={p} />
            : p.plans.map((plan, i) => (
              <PlanRow
                key={`${p.id}:${plan.id}`}
                plan={plan} provider={p} first={i === 0} usage={usage}
                open={openId === `${p.id}:${plan.id}`}
                onToggle={() => setOpenId((cur) => (cur === `${p.id}:${plan.id}` ? null : `${p.id}:${plan.id}`))}
              />
            ))
        ))}
      </div>
    </section>
  );
}
