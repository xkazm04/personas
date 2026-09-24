// Departures · DeparturesPlans — subscription usage as a compact tabular block.
// PROTOTYPE (variant C).
//
//   SUBSCRIPTION USAGE  3/5 ………………… Auto-rotate [●] at 80 %   as of 18 s ago  ⟳
//   ▌✳ xkazm04@…   5h ▬▭▭ 0%   7d ▬▭▭ 0%
//    ✳ candidate…  5h ▬▭▭ 0%   7d ▬▬▭ 50%
//
// Plans flow into ≥26rem columns, so seven plans take two or three lines on a
// wide board rather than seven. Each row keeps the same column grid.

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AsyncButton } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import type { UsageFeed } from '../useUsageFeed';
import { PLAN_SLOTS } from '../../UsageStripShell';
import { EmptyPlanLine, PlanLine } from './PlanLine';

function AutoRotate({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<number | null>(null);
  const ar = usage.autoRotate;
  if (!ar || usage.planCount === 0) return null;
  const shown = draft ?? ar.thresholdPct;
  return (
    <Tooltip content={t.monitor.usage_auto_rotate_hint}>
      <span className="inline-flex items-center gap-1.5" data-testid="fleet-usage-controls">
        <AccessibleToggle size="sm" checked={ar.enabled} onChange={() => usage.saveAutoRotate(!ar.enabled, shown)} label={t.monitor.usage_auto_rotate} />
        <span className="typo-caption text-foreground">{t.monitor.usage_auto_rotate}</span>
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
          className="w-11 border-0 border-b border-border bg-transparent px-0.5 text-right typo-data tabular-nums text-foreground focus:border-primary focus:outline-none"
          data-testid="fleet-usage-rotate-threshold"
        />
        <span className="typo-caption text-foreground opacity-60">%</span>
      </span>
    </Tooltip>
  );
}

export function DeparturesPlans({ usage }: { usage: UsageFeed }) {
  const { t } = useTranslation();
  const loading = usage.model.providers.some((p) => p.pending);
  return (
    <div className="flex-shrink-0 border-b border-border px-4 pb-2 pt-1.5" data-testid="fleet-usage-strip">
      <div className="flex items-center gap-3 pb-1">
        <span className="typo-label uppercase tracking-wide text-foreground">{t.monitor.usage_title}</span>
        {usage.planCount > 0 && (
          <span className="typo-data tabular-nums text-foreground opacity-60">{usage.planCount}/{PLAN_SLOTS}</span>
        )}
        <span className="ml-auto flex items-center gap-4">
          <AutoRotate usage={usage} />
          {usage.fetchedAt !== null && (
            <span className="whitespace-nowrap typo-caption text-foreground opacity-60">
              {t.monitor.usage_as_of} <RelativeTime timestamp={usage.fetchedAt} />
            </span>
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(26rem,1fr))] gap-x-8">
        {usage.model.providers.map((provider) => {
          if (provider.pending) {
            return <div key={provider.id} aria-hidden className="h-8 border-b border-border/30" />;
          }
          if (provider.plans.length === 0) return <EmptyPlanLine key={provider.id} provider={provider} />;
          const hasActive = provider.plans.some((p) => p.isActive);
          return provider.plans.map((plan) => (
            <PlanLine
              key={`${provider.id}:${plan.id}`}
              provider={provider}
              plan={plan}
              recede={hasActive && !plan.isActive}
              ask={usage.ask}
            />
          ));
        })}
      </div>
      <span className="sr-only" role="status">{loading ? t.monitor.usage_loading : ''}</span>
    </div>
  );
}
