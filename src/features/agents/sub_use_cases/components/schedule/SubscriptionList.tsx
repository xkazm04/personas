import { Radio, Trash2, Zap, Clock } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { ScheduleBuilder } from './ScheduleBuilder';
import type { UnifiedSubscription } from '@/features/agents/sub_connectors/libs/subscriptionLifecycle';
import type { SubscriptionStage } from '@/features/agents/sub_connectors/libs/subscriptionLifecycle';
import { useTranslation } from '@/i18n/useTranslation';

interface SuggestedTrigger {
  type: string;
  cron?: string;
  description?: string;
}

const STAGE_BADGE: Record<SubscriptionStage, { className: string; label: string }> = {
  activated: { className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'active' },
  paused: { className: 'bg-amber-500/10 text-amber-400 border-amber-500/20', label: 'paused' },
  suggested: { className: 'bg-blue-500/10 text-blue-400 border-blue-500/20', label: 'suggested' },
  retired: { className: 'bg-muted/20 text-muted-foreground/50 border-muted/20', label: 'retired' },
};

interface ActiveTriggersProps {
  items: UnifiedSubscription[];
  onRetire: (item: UnifiedSubscription) => Promise<void>;
}

export function ActiveTriggers({ items, onRetire }: ActiveTriggersProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Zap className="w-3.5 h-3.5 text-amber-400" />
        {t.agents.use_cases.active_triggers}
      </h5>
      {items.map((item) => {
        const badge = STAGE_BADGE[item.stage];
        return (
          <SectionCard key={item.key} size="sm" className="flex items-center gap-2.5">
            <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground/80 block truncate">
                {item.triggerType}
              </span>
              {item.triggerConfig && (
                <span className="text-sm text-muted-foreground/70 block truncate">
                  {item.triggerConfig}
                </span>
              )}
            </div>
            <span className={`text-sm px-1.5 py-0.5 rounded border ${badge.className}`}>
              {badge.label}
            </span>
            <button
              onClick={() => void onRetire(item)}
              className="p-1 text-muted-foreground/70 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </SectionCard>
        );
      })}
    </div>
  );
}

interface ActiveSubscriptionsProps {
  items: UnifiedSubscription[];
  onRetire: (item: UnifiedSubscription) => Promise<void>;
}

export function ActiveSubscriptions({ items, onRetire }: ActiveSubscriptionsProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Radio className="w-3.5 h-3.5 text-cyan-400" />
        {t.agents.use_cases.active_subscriptions}
      </h5>
      {items.map((item) => {
        const badge = STAGE_BADGE[item.stage];
        return (
          <SectionCard key={item.key} size="sm" className="flex items-center gap-2.5">
            <Radio className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground/80 block truncate">
                {item.eventType}
              </span>
              {item.sourceFilter && (
                <span className="text-sm text-muted-foreground/70 block truncate">
                  filter: {item.sourceFilter}
                </span>
              )}
            </div>
            <span className={`text-sm px-1.5 py-0.5 rounded border ${badge.className}`}>
              {badge.label}
            </span>
            <button
              onClick={() => void onRetire(item)}
              className="p-1 text-muted-foreground/70 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </SectionCard>
        );
      })}
    </div>
  );
}

interface SuggestedTriggerSectionProps {
  suggestedTriggerItem: UnifiedSubscription;
  suggestedTrigger: SuggestedTrigger;
  useCaseId: string;
  onActivate: (item: UnifiedSubscription, config?: Record<string, unknown>) => Promise<void>;
  activating: Set<string>;
}

export function SuggestedTriggerSection({ suggestedTriggerItem, suggestedTrigger, useCaseId, onActivate, activating }: SuggestedTriggerSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <SectionHeader icon={<Clock className="w-3.5 h-3.5" />} label={t.agents.use_cases.schedule_trigger} />
      {(suggestedTrigger.type === 'schedule' || suggestedTrigger.type === 'polling' || suggestedTrigger.cron) ? (
        <ScheduleBuilder
          suggestedTrigger={suggestedTrigger}
          useCaseId={useCaseId}
          onActivate={(_ucId, _triggerType, config) =>
            void onActivate(suggestedTriggerItem, config)
          }
          isActivating={activating.has(suggestedTriggerItem.key)}
        />
      ) : (
        <div className="flex items-center gap-2.5 p-2 border border-dashed rounded-lg border-amber-500/20 bg-amber-500/5">
          <Clock className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground/70 block truncate">
              {suggestedTrigger.type}
            </span>
            {suggestedTrigger.description && (
              <span className="text-sm text-muted-foreground/60 block truncate">
                {suggestedTrigger.description}
              </span>
            )}
          </div>
          <button
            onClick={() => void onActivate(suggestedTriggerItem)}
            disabled={activating.has(suggestedTriggerItem.key)}
            className="flex items-center gap-1 px-2.5 py-1 text-sm rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Zap className="w-3 h-3" />
            {t.agents.use_cases.activate}
          </button>
        </div>
      )}
    </div>
  );
}
