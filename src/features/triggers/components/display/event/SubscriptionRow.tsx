import { Trash2 } from 'lucide-react';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { EventTypeChip } from './EventTypeChip';

interface SubscriptionRowProps {
  sub: PersonaEventSubscription;
  personaName: string;
  busy: boolean;
  onToggle: (sub: PersonaEventSubscription) => void;
  onDelete: (id: string) => void;
}

export function SubscriptionRow({ sub, personaName, busy, onToggle, onDelete }: SubscriptionRowProps) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_80px_40px] gap-3 px-4 py-3 border-b border-border/10 last:border-b-0 items-center hover:bg-secondary/20 transition-colors">
      <span className="text-sm text-foreground/85 truncate">
        {personaName}
      </span>
      <div className="truncate">
        <EventTypeChip eventType={sub.event_type} />
      </div>
      <span className="text-sm text-muted-foreground/70 truncate">
        {sub.source_filter ?? '\u2014'}
      </span>
      <div className="flex justify-center">
        <button
          onClick={() => onToggle(sub)}
          disabled={busy}
          className={`px-2 py-0.5 text-sm font-medium rounded-lg border transition-colors ${
            sub.enabled
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25'
              : 'bg-secondary/60 text-muted-foreground/60 border-border/20 hover:bg-secondary/80'
          } ${busy ? 'opacity-50 cursor-wait' : ''}`}
        >
          {sub.enabled ? 'On' : 'Off'}
        </button>
      </div>
      <div className="flex justify-center">
        <button
          onClick={() => onDelete(sub.id)}
          disabled={busy}
          className={`p-1 rounded-lg text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors ${busy ? 'opacity-50 cursor-wait' : ''}`}
          title="Delete subscription"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
