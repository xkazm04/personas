import { useState } from 'react';
import { Radio, Plus, Trash2, Zap, Clock } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import type { UseCaseEventSubscription } from '@/features/shared/components/UseCasesList';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import { SectionCard } from '@/features/shared/components/SectionCard';
import { UseCaseSubscriptionForm } from './UseCaseSubscriptionForm';
import { UseCaseActiveTriggers, UseCaseActiveSubscriptions } from './UseCaseActiveItems';
import { ScheduleBuilder } from './ScheduleBuilder';

interface SuggestedTrigger {
  type: string;
  cron?: string;
  description?: string;
}

interface UseCaseSubscriptionsProps {
  subscriptions: UseCaseEventSubscription[];
  onChange: (subs: UseCaseEventSubscription[]) => void;
  dbTriggers?: PersonaTrigger[];
  dbSubscriptions?: PersonaEventSubscription[];
  suggestedTrigger?: SuggestedTrigger;
  useCaseId?: string;
  onActivateTrigger?: (useCaseId: string, triggerType: string, config?: Record<string, unknown>) => void;
  onDeleteTrigger?: (triggerId: string) => void;
  onActivateSubscription?: (useCaseId: string, eventType: string, sourceFilter?: string) => void;
  onDeleteSubscription?: (subId: string) => void;
  activatingTriggers?: Set<string>;
  activatingSubscriptions?: Set<string>;
}

export function UseCaseSubscriptions({
  subscriptions,
  onChange,
  dbTriggers = [],
  dbSubscriptions = [],
  suggestedTrigger,
  useCaseId,
  onActivateTrigger,
  onDeleteTrigger,
  onActivateSubscription,
  onDeleteSubscription,
  activatingTriggers,
  activatingSubscriptions,
}: UseCaseSubscriptionsProps) {
  const [showAddForm, setShowAddForm] = useState(false);

  const handleToggle = (index: number) => {
    onChange(subscriptions.map((s, i) => i === index ? { ...s, enabled: !s.enabled } : s));
  };

  const handleDelete = (index: number) => {
    onChange(subscriptions.filter((_, i) => i !== index));
  };

  const handleAdd = (sub: UseCaseEventSubscription) => {
    onChange([...subscriptions, sub]);
    setShowAddForm(false);
  };

  // Check if suggested trigger is already activated
  const isTriggerActivated = suggestedTrigger && dbTriggers.some((t) => t.trigger_type === suggestedTrigger.type);

  return (
    <div className="space-y-3">
      {/* Active DB Triggers */}
      <UseCaseActiveTriggers triggers={dbTriggers} onDelete={onDeleteTrigger} />

      {/* Active DB Subscriptions */}
      <UseCaseActiveSubscriptions subscriptions={dbSubscriptions} onDelete={onDeleteSubscription} />

      {/* Suggested Trigger — Visual Schedule Builder for schedule/polling types */}
      {suggestedTrigger && !isTriggerActivated && useCaseId && onActivateTrigger && (
        <div className="space-y-1.5">
          <SectionHeader icon={<Clock className="w-3.5 h-3.5" />} label="Schedule Trigger" />
          {(suggestedTrigger.type === 'schedule' || suggestedTrigger.type === 'polling' || suggestedTrigger.cron) ? (
            <ScheduleBuilder
              suggestedTrigger={suggestedTrigger}
              useCaseId={useCaseId}
              onActivate={onActivateTrigger}
              isActivating={activatingTriggers?.has(`${useCaseId}:${suggestedTrigger.type}`) ?? false}
            />
          ) : (
            /* Non-schedule triggers: keep simple activate button */
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
                onClick={() => onActivateTrigger(useCaseId, suggestedTrigger.type)}
                disabled={activatingTriggers?.has(`${useCaseId}:${suggestedTrigger.type}`)}
                className="flex items-center gap-1 px-2.5 py-1 text-sm rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
              {subscriptions.filter((s) => s.enabled).length} configured
            </span>
          )}
        />

        <div className="space-y-1.5">
          {subscriptions.map((sub, i) => (
            <SectionCard
              key={`${sub.event_type}_${i}`}
              size="sm"
              className={`flex items-center gap-2.5 transition-colors ${
                sub.enabled
                  ? ''
                  : 'bg-secondary/10 border-primary/10 opacity-60'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground/80 block truncate">
                  {sub.event_type}
                </span>
                {sub.source_filter && (
                  <span className="text-sm text-muted-foreground/70 block truncate">
                    filter: {sub.source_filter}
                  </span>
                )}
              </div>
              {useCaseId && onActivateSubscription && (
                <button
                  onClick={() => onActivateSubscription(useCaseId, sub.event_type, sub.source_filter)}
                  disabled={activatingSubscriptions?.has(`${useCaseId}:${sub.event_type}:${sub.source_filter ?? ''}`)}
                  className="flex items-center gap-1 px-2 py-0.5 text-sm rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Create as DB-backed subscription"
                >
                  <Zap className="w-2.5 h-2.5" />
                  Activate
                </button>
              )}
              <AccessibleToggle
                checked={sub.enabled}
                onChange={() => handleToggle(i)}
                label={`Enable ${sub.event_type}`}
                size="sm"
              />
              <button
                onClick={() => handleDelete(i)}
                className="p-1 text-muted-foreground/70 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
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
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-primary/15 hover:border-primary/30 text-sm text-muted-foreground/70 hover:text-primary/80 transition-all w-full"
            >
              <Plus className="w-3.5 h-3.5" /> Add Subscription
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
