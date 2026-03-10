import { useState } from 'react';
import { Radio, Plus, Trash2, Zap, Clock } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { UseCaseSubscriptionForm } from './UseCaseSubscriptionForm';
import { ScheduleBuilder } from './ScheduleBuilder';
import type { UnifiedSubscription } from '@/features/agents/sub_connectors/libs/subscriptionLifecycle';
import type { UseCaseEventSubscription } from '@/lib/types/frontendTypes';

interface SuggestedTrigger {
  type: string;
  cron?: string;
  description?: string;
}

import type { SubscriptionStage } from '@/features/agents/sub_connectors/libs/subscriptionLifecycle';

const STAGE_BADGE: Record<SubscriptionStage, { className: string; label: string }> = {
  activated: { className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'active' },
  paused: { className: 'bg-amber-500/10 text-amber-400 border-amber-500/20', label: 'paused' },
  suggested: { className: 'bg-blue-500/10 text-blue-400 border-blue-500/20', label: 'suggested' },
  retired: { className: 'bg-muted/20 text-muted-foreground/50 border-muted/20', label: 'retired' },
};

interface UseCaseSubscriptionsProps {
  items: UnifiedSubscription[];
  suggestedTrigger?: SuggestedTrigger;
  useCaseId: string;
  onActivate: (item: UnifiedSubscription, config?: Record<string, unknown>) => Promise<void>;
  onRetire: (item: UnifiedSubscription) => Promise<void>;
  onAddSuggested: (sub: UseCaseEventSubscription) => void;
  onRemoveSuggested: (index: number) => void;
  onToggleSuggested: (index: number) => void;
  activating: Set<string>;
}

export function UseCaseSubscriptions({
  items,
  suggestedTrigger,
  useCaseId,
  onActivate,
  onRetire,
  onAddSuggested,
  onRemoveSuggested,
  onToggleSuggested,
  activating,
}: UseCaseSubscriptionsProps) {
  const [showAddForm, setShowAddForm] = useState(false);

  const activeTriggers = items.filter((i) => i.kind === 'trigger' && (i.stage === 'activated' || i.stage === 'paused'));
  const activeSubscriptions = items.filter((i) => i.kind === 'event_subscription' && (i.stage === 'activated' || i.stage === 'paused'));
  const suggestedTriggerItem = items.find((i) => i.kind === 'trigger' && i.stage === 'suggested');
  const suggestedSubscriptions = items.filter((i) => i.kind === 'event_subscription' && (i.stage === 'suggested' || i.stage === 'retired'));

  const handleAdd = (sub: UseCaseEventSubscription) => {
    onAddSuggested(sub);
    setShowAddForm(false);
  };

  return (
    <div className="space-y-3">
      {/* Active DB Triggers */}
      {activeTriggers.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Active Triggers
          </h5>
          {activeTriggers.map((item) => {
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
      )}

      {/* Active DB Subscriptions */}
      {activeSubscriptions.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            Active Subscriptions
          </h5>
          {activeSubscriptions.map((item) => {
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
      )}

      {/* Suggested Trigger — Schedule Builder for schedule/polling types */}
      {suggestedTriggerItem && suggestedTrigger && (
        <div className="space-y-1.5">
          <SectionHeader icon={<Clock className="w-3.5 h-3.5" />} label="Schedule Trigger" />
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
                Activate
              </button>
            </div>
          )}
        </div>
      )}

      {/* Suggested Event Subscriptions (JSON-backed) */}
      <div className="space-y-1.5">
        <SectionHeader
          icon={<Radio className="w-3.5 h-3.5" />}
          label="Event Subscriptions"
          trailing={(
            <span className="text-sm text-muted-foreground/70">
              {suggestedSubscriptions.filter((i) => i.stage === 'suggested').length} configured
            </span>
          )}
        />

        <div className="space-y-1.5">
          {suggestedSubscriptions.map((item) => (
            <SectionCard
              key={item.key}
              size="sm"
              className={`flex items-center gap-2.5 transition-colors ${
                item.stage === 'suggested'
                  ? ''
                  : 'bg-secondary/10 border-primary/10 opacity-60'
              }`}
            >
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
              <button
                onClick={() => void onActivate(item)}
                disabled={activating.has(item.key)}
                className="flex items-center gap-1 px-2 py-0.5 text-sm rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Activate as DB-backed subscription"
              >
                <Zap className="w-2.5 h-2.5" />
                Activate
              </button>
              {item.suggestedIndex != null && (
                <>
                  <AccessibleToggle
                    checked={item.stage === 'suggested'}
                    onChange={() => onToggleSuggested(item.suggestedIndex!)}
                    label={`Enable ${item.eventType}`}
                    size="sm"
                  />
                  <button
                    onClick={() => onRemoveSuggested(item.suggestedIndex!)}
                    className="p-1 text-muted-foreground/70 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </SectionCard>
          ))}

          {showAddForm ? (
            <UseCaseSubscriptionForm
              onAdd={handleAdd}
              onCancel={() => setShowAddForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-dashed border-primary/15 hover:border-primary/30 text-sm text-muted-foreground/70 hover:text-primary/80 transition-all w-full"
            >
              <Plus className="w-3.5 h-3.5" /> Add Subscription
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
