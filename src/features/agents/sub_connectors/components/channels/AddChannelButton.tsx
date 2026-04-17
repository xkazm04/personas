import { Bell, Plus, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
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
  const { t } = useTranslation();
  const available = channelTypes.filter(ct => !existingTypes.has(ct.type));

  return (
    <Listbox
      ariaLabel={t.agents.connectors.ch_add}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          onClick={toggle}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className="flex items-center gap-2 px-3 py-2 rounded-modal border border-dashed border-primary/20 hover:border-primary/40 typo-body text-foreground hover:text-primary/80 transition-all w-full"
        >
          <Plus className="w-4 h-4" />
          {t.agents.connectors.ch_add}
          <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          {available.map((ct) => (
            <button
              key={ct.type}
              onClick={() => { onAdd(ct.type); close(); }}
              role="option"
              aria-selected={false}
              className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-secondary/50 typo-body text-foreground transition-colors"
            >
              <Bell className="w-4 h-4 text-foreground" />
              {ct.label}
            </button>
          ))}
          {available.length === 0 && (
            <div className="px-4 py-2.5 typo-body text-foreground">{t.agents.connectors.ch_all_added}</div>
          )}
        </>
      )}
    </Listbox>
  );
}
