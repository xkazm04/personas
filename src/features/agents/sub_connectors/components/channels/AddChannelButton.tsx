import { Bell, Plus, ChevronDown } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { NotificationChannelType } from '@/lib/types/frontendTypes';

interface ChannelTypeDef {
  type: NotificationChannelType;
  label: string;
}

interface AddChannelButtonProps {
  channelTypes: ChannelTypeDef[];
  existingTypes: Set<NotificationChannelType>;
  onAdd: (type: NotificationChannelType) => void;
}

export function AddChannelButton({ channelTypes, existingTypes, onAdd }: AddChannelButtonProps) {
  const available = channelTypes.filter(t => !existingTypes.has(t.type));

  return (
    <Listbox
      ariaLabel="Add notification channel"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          onClick={toggle}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-primary/15 hover:border-primary/40 text-sm text-muted-foreground/80 hover:text-primary/80 transition-all w-full"
        >
          <Plus className="w-4 h-4" />
          Add Channel
          <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          {available.map((t) => (
            <button
              key={t.type}
              onClick={() => { onAdd(t.type); close(); }}
              role="option"
              aria-selected={false}
              className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-secondary/50 text-sm text-foreground/80 transition-colors"
            >
              <Bell className="w-4 h-4 text-muted-foreground/90" />
              {t.label}
            </button>
          ))}
          {available.length === 0 && (
            <div className="px-4 py-2.5 text-sm text-muted-foreground/90">All channel types added</div>
          )}
        </>
      )}
    </Listbox>
  );
}
