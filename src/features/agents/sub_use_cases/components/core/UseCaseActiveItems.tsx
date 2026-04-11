import { useEffect, useState } from 'react';
import { Radio, Trash2, Zap } from 'lucide-react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { useTranslation } from '@/i18n/useTranslation';

function InlineDeleteButton({
  id,
  onConfirm,
}: {
  id: string;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 2000);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[data-inline-delete="${id}"]`)) {
        setConfirming(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [confirming, id]);

  return (
    <button
      onClick={() => {
        if (confirming) {
          onConfirm();
          setConfirming(false);
          return;
        }
        setConfirming(true);
      }}
      data-inline-delete={id}
      className="p-1 text-muted-foreground/70 hover:text-red-400 transition-colors"
    >
      {confirming ? (
          <ConfirmLabel />
        ) : (
          <span key="icon">
            <Trash2 className="animate-fade-slide-in w-3 h-3" />
          </span>
        )}
    </button>
  );
}

function ConfirmLabel() {
  const { t } = useTranslation();
  return (
    <span key="confirm" className="animate-fade-slide-in text-sm font-semibold text-red-400">
      {t.agents.use_cases.confirm_delete}
    </span>
  );
}

interface UseCaseActiveTriggersProps {
  triggers: PersonaTrigger[];
  onDelete?: (triggerId: string) => void;
}

export function UseCaseActiveTriggers({ triggers, onDelete }: UseCaseActiveTriggersProps) {
  const { t } = useTranslation();
  if (triggers.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Zap className="w-3.5 h-3.5 text-amber-400" />
        {t.agents.use_cases.active_triggers}
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
              <span className="text-sm text-muted-foreground/70 block truncate">
                {trigger.config}
              </span>
            )}
          </div>
          <span className="text-sm px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {trigger.enabled ? 'active' : 'disabled'}
          </span>
          {onDelete && (
            <InlineDeleteButton id={`trigger-${trigger.id}`} onConfirm={() => onDelete(trigger.id)} />
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
  const { t } = useTranslation();
  if (subscriptions.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Radio className="w-3.5 h-3.5 text-cyan-400" />
        {t.agents.use_cases.active_subscriptions}
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
              <span className="text-sm text-muted-foreground/70 block truncate">
                filter: {sub.source_filter}
              </span>
            )}
          </div>
          <span className="text-sm px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {sub.enabled ? 'active' : 'disabled'}
          </span>
          {onDelete && (
            <InlineDeleteButton id={`subscription-${sub.id}`} onConfirm={() => onDelete(sub.id)} />
          )}
        </SectionCard>
      ))}
    </div>
  );
}
