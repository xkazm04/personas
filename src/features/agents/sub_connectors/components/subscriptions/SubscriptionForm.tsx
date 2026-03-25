import { useState, useEffect } from 'react';
import { Radio, Trash2 } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';

interface SubscriptionRowProps {
  sub: PersonaEventSubscription;
  confirmingDeleteId: string | null;
  onToggle: (sub: PersonaEventSubscription) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (id: string | null) => void;
}

export function SubscriptionRow({
  sub, confirmingDeleteId, onToggle, onDelete, onConfirmDelete,
}: SubscriptionRowProps) {
  return (
    <SectionCard
      size="sm"
      className={`flex items-center gap-3 transition-colors ${sub.enabled ? '' : 'bg-secondary/10 opacity-60'}`}
    >
      <Radio className="w-4 h-4 text-cyan-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground/80 block truncate">{sub.event_type}</span>
        {sub.source_filter && (
          <span className="text-sm text-muted-foreground/80 block truncate">filter: {sub.source_filter}</span>
        )}
      </div>
      <AccessibleToggle
        checked={sub.enabled}
        onChange={() => onToggle(sub)}
        label={`Enable ${sub.event_type} subscription`}
        size="sm"
      />
      <button
        onClick={() => {
          if (confirmingDeleteId === sub.id) {
            void onDelete(sub.id);
            onConfirmDelete(null);
            return;
          }
          onConfirmDelete(sub.id);
        }}
        data-sub-delete={sub.id}
        className="p-1 text-muted-foreground/80 hover:text-red-400 transition-colors focus-ring"
      >
        {confirmingDeleteId === sub.id ? (
            <span
              key="confirm"
              className="animate-fade-slide-in text-sm font-semibold text-red-400"
            >
              Confirm?
            </span>
          ) : (
            <span key="trash">
              <Trash2 className="animate-fade-slide-in w-3.5 h-3.5" />
            </span>
          )}
      </button>
    </SectionCard>
  );
}

export function useConfirmDelete() {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmingDeleteId) return;
    const timer = setTimeout(() => setConfirmingDeleteId(null), 2000);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[data-sub-delete="${confirmingDeleteId}"]`)) {
        setConfirmingDeleteId(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => { clearTimeout(timer); window.removeEventListener('pointerdown', onPointerDown); };
  }, [confirmingDeleteId]);

  return { confirmingDeleteId, setConfirmingDeleteId };
}
