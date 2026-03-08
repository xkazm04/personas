import { Bell, ChevronDown, Check } from 'lucide-react';
import { Listbox } from '@/features/shared/components/Listbox';
import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';
import { CHANNEL_TYPES, channelSummary } from '../libs/useCaseDetailHelpers';

interface UseCaseChannelDropdownProps {
  channels: NotificationChannel[];
  onToggle: (type: NotificationChannelType) => void;
}

export function UseCaseChannelDropdown({ channels, onToggle }: UseCaseChannelDropdownProps) {
  return (
    <Listbox
      ariaLabel="Select notification channels"
      className="min-w-[150px]"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-all w-full ${
            channels.length > 0
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-secondary/40 border-primary/10 text-muted-foreground/80 hover:border-primary/20'
          }`}
        >
          <Bell className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left truncate">{channelSummary(channels)}</span>
          <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {() => (
        <div className="py-1">
          {CHANNEL_TYPES.map((ct) => {
            const isEnabled = channels.some((c) => c.type === ct.type);
            return (
              <button
                key={ct.type}
                role="option"
                aria-selected={isEnabled}
                onClick={() => onToggle(ct.type)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm transition-colors hover:bg-secondary/40 ${
                  isEnabled ? 'text-primary' : 'text-foreground/80'
                }`}
              >
                <ct.Icon className="w-3.5 h-3.5" />
                <span className="flex-1 text-left">{ct.label}</span>
                {isEnabled && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </Listbox>
  );
}
