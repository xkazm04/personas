// Atelier plans shelf — every provider's plans laid out as soft cards on one
// horizontally scrolling shelf, with the shelf's own controls at its end:
// auto-rotate (a labelled toggle + threshold), the "as of" and a refresh.

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AsyncButton } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ProviderIcon } from '../../usage/ProviderIcon';
import { cliReasonHint, cliReasonLabel, providerName } from '../../usageBits';
import type { UsageFeed } from '../useUsageFeed';
import { PlanCard } from './PlanCard';

function AutoRotate({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<number | null>(null);
  const ar = usage.autoRotate;
  if (!ar || usage.planCount === 0) return null;
  const shown = draft ?? ar.thresholdPct;
  return (
    <Tooltip content={t.monitor.usage_auto_rotate_hint}>
      <div className="flex flex-shrink-0 items-center gap-2 rounded-pill bg-secondary/30 py-1 pl-2 pr-3 typo-caption text-foreground" data-testid="fleet-usage-controls">
        <AccessibleToggle size="sm" checked={ar.enabled} onChange={() => usage.saveAutoRotate(!ar.enabled, shown)} label={t.monitor.usage_auto_rotate} />
        <span>{t.monitor.usage_auto_rotate}</span>
        <span className="opacity-60">at</span>
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
          className="w-12 rounded-input bg-background/60 px-1.5 py-0.5 text-right typo-data tabular-nums text-foreground focus-ring"
          data-testid="fleet-usage-rotate-threshold"
        />
        <span className="opacity-60">%</span>
      </div>
    </Tooltip>
  );
}

export function AtelierPlans({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-shrink-0 items-stretch gap-3 overflow-x-auto px-4 pb-3 pt-1" data-testid="fleet-usage-strip">
      {usage.model.providers.map((provider) => {
        if (provider.pending) {
          return <div key={provider.id} aria-hidden className="h-[5.5rem] w-60 flex-shrink-0 animate-fade-in rounded-card bg-foreground/[0.03]" style={{ animationDelay: '150ms' }} />;
        }
        if (provider.plans.length === 0) {
          const reason = provider.emptyReason ?? 'unreadable';
          return (
            <Tooltip key={provider.id} content={cliReasonHint(t, reason)}>
              <div className="flex w-44 flex-shrink-0 flex-col justify-center gap-1 rounded-card bg-foreground/[0.025] p-3" data-testid="fleet-usage-empty" data-provider={provider.id}>
                <span className="flex items-center gap-2 typo-body text-foreground opacity-70">
                  <ProviderIcon provider={provider.id} />
                  {providerName(t, provider.id)}
                </span>
                <span className="typo-caption text-foreground opacity-55">{cliReasonLabel(t, reason)}</span>
              </div>
            </Tooltip>
          );
        }
        const hasActive = provider.plans.some((p) => p.isActive);
        return provider.plans.map((plan) => (
          <PlanCard key={`${provider.id}:${plan.id}`} provider={provider} plan={plan} recede={hasActive && !plan.isActive} ask={usage.ask} />
        ));
      })}
      <div className="ml-auto flex flex-shrink-0 flex-col items-end justify-center gap-2 pl-2">
        <AutoRotate usage={usage} />
        <div className="flex items-center gap-1.5 typo-caption text-foreground opacity-70">
          {usage.fetchedAt !== null && (
            <span className="whitespace-nowrap">{t.monitor.usage_as_of} <RelativeTime timestamp={usage.fetchedAt} /></span>
          )}
          <Tooltip content={usage.refreshHint}>
            <AsyncButton size="icon-sm" variant="ghost" disabled={!usage.canRefresh} onClick={usage.refresh} aria-label={usage.refreshHint} data-testid="fleet-usage-refresh">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </AsyncButton>
          </Tooltip>
        </div>
      </div>
      {usage.dialog}
    </div>
  );
}
