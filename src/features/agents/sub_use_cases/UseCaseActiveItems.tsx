import { Radio, Trash2, Zap } from 'lucide-react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { SectionCard } from '@/features/shared/components/SectionCard';

interface UseCaseActiveTriggersProps {
  triggers: PersonaTrigger[];
  onDelete?: (triggerId: string) => void;
}

export function UseCaseActiveTriggers({ triggers, onDelete }: UseCaseActiveTriggersProps) {
  if (triggers.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Zap className="w-3.5 h-3.5 text-amber-400" />
        Active Triggers
      </h5>
      {triggers.map((trigger) => (
        <SectionCard
          key={trigger.id}
          size="sm"
          className="flex items-center gap-2.5"
        >
          <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground/80 block truncate">
              {trigger.trigger_type}
            </span>
            {trigger.config && (
              <span className="text-[11px] text-muted-foreground/70 block truncate">
                {trigger.config}
              </span>
            )}
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {trigger.enabled ? 'active' : 'disabled'}
          </span>
          {onDelete && (
            <button
              onClick={() => onDelete(trigger.id)}
              className="p-1 text-muted-foreground/70 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </SectionCard>
      ))}
    </div>
  );
}

interface UseCaseActiveSubscriptionsProps {
  subscriptions: PersonaEventSubscription[];
  onDelete?: (subId: string) => void;
}

export function UseCaseActiveSubscriptions({ subscriptions, onDelete }: UseCaseActiveSubscriptionsProps) {
  if (subscriptions.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Radio className="w-3.5 h-3.5 text-cyan-400" />
        Active Subscriptions
      </h5>
      {subscriptions.map((sub) => (
        <SectionCard
          key={sub.id}
          size="sm"
          className="flex items-center gap-2.5"
        >
          <Radio className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground/80 block truncate">
              {sub.event_type}
            </span>
            {sub.source_filter && (
              <span className="text-[11px] text-muted-foreground/70 block truncate">
                filter: {sub.source_filter}
              </span>
            )}
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {sub.enabled ? 'active' : 'disabled'}
          </span>
          {onDelete && (
            <button
              onClick={() => onDelete(sub.id)}
              className="p-1 text-muted-foreground/70 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </SectionCard>
      ))}
    </div>
  );
}
