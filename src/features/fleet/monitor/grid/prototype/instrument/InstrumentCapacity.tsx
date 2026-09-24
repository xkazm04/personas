// InstrumentCapacity — the subscription usage as a row of gauges, with the
// auto-rotate control and the reading's age at the band's right. One band,
// not the baseline's title row + account row.

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AsyncButton } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import type { UsageFeed } from '../useUsageFeed';
import { InstrumentGauge, InstrumentGaugeEmpty, InstrumentGaugeGhost } from './InstrumentGauge';

function AutoRotate({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<number | null>(null);
  const ar = usage.autoRotate;
  if (!ar || usage.planCount === 0) return null;
  const shown = draft ?? ar.thresholdPct;
  return (
    <Tooltip content={t.monitor.usage_auto_rotate_hint}>
      <span className="flex items-center gap-2" data-testid="fleet-usage-controls">
        <AccessibleToggle size="sm" checked={ar.enabled} onChange={() => usage.saveAutoRotate(!ar.enabled, shown)} label={t.monitor.usage_auto_rotate} />
        <span className="typo-label uppercase tracking-wider text-foreground opacity-70">{t.monitor.usage_auto_rotate}</span>
        <input
          type="number"
          min={1}
          max={100}
          step={5}
          value={shown}
          aria-label={t.monitor.usage_auto_rotate_threshold_aria}
          onChange={(e) => setDraft(Number(e.target.value))}
          onBlur={() => {
            const pct = Math.max(1, Math.min(100, Math.round(shown)));
            setDraft(null);
            if (pct !== ar.thresholdPct) usage.saveAutoRotate(ar.enabled, pct);
          }}
          className="w-12 rounded-input border border-primary/15 bg-background/60 px-1 text-right typo-code tabular-nums text-foreground"
          data-testid="fleet-usage-rotate-threshold"
        />
        <span className="typo-code text-foreground opacity-60">%</span>
      </span>
    </Tooltip>
  );
}

export function InstrumentCapacity({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-shrink-0 items-center gap-4 border-b border-primary/10 px-4 py-2" data-testid="fleet-usage-strip">
      <div className="flex min-w-0 flex-1 items-stretch gap-2 overflow-x-auto pb-0.5">
        {usage.model.providers.map((provider) => {
          if (provider.pending) return <InstrumentGaugeGhost key={provider.id} />;
          if (provider.plans.length === 0) return <InstrumentGaugeEmpty key={provider.id} provider={provider} />;
          return provider.plans.map((plan) => (
            <InstrumentGauge key={`${provider.id}:${plan.id}`} provider={provider} plan={plan} ask={usage.ask} />
          ));
        })}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        <AutoRotate usage={usage} />
        <span className="flex items-center gap-1.5 typo-code text-foreground opacity-70">
          {usage.fetchedAt !== null && (
            <span className="whitespace-nowrap">{t.monitor.usage_as_of} <RelativeTime timestamp={usage.fetchedAt} /></span>
          )}
          <Tooltip content={usage.refreshHint}>
            <AsyncButton
              size="icon-sm"
              variant="ghost"
              disabled={!usage.canRefresh}
              onClick={usage.refresh}
              aria-label={usage.refreshHint}
              data-testid="fleet-usage-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </AsyncButton>
          </Tooltip>
        </span>
      </div>
    </div>
  );
}
