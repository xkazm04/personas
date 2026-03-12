import { useCallback } from 'react';
import { Hash, Send, Mail, Bell, Check, ChevronDown } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { CredentialMetadata } from '@/lib/types/types';

export function channelIcon(type: string) {
  switch (type) {
    case 'slack': return <Hash className="w-4 h-4 text-purple-400" />;
    case 'telegram': return <Send className="w-4 h-4 text-blue-400" />;
    case 'email': return <Mail className="w-4 h-4 text-amber-400" />;
    default: return <Bell className="w-4 h-4 text-muted-foreground/90" />;
  }
}

interface CredentialPickerProps {
  credentials: CredentialMetadata[];
  selectedId: string | undefined;
  onChange: (id: string) => void;
}

export function CredentialPicker({
  credentials: creds,
  selectedId,
  onChange,
}: CredentialPickerProps) {
  const selected = creds.find((c) => c.id === selectedId);

  const handleSelectFocused = useCallback((index: number) => {
    if (index === 0) onChange('');
    else { const cred = creds[index - 1]; if (cred) onChange(cred.id); }
  }, [creds, onChange]);

  return (
    <Listbox
      ariaLabel="Select credential"
      itemCount={creds.length + 1}
      onSelectFocused={handleSelectFocused}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
        >
          {selected ? (
            <>
              {channelIcon(selected.service_type)}
              <span className="flex-1 text-left truncate">{selected.name}</span>
              <span className="text-sm text-muted-foreground/80">{selected.service_type}</span>
            </>
          ) : (
            <span className="flex-1 text-left text-muted-foreground/80">Select credential...</span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/80 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <>
          <button
            role="option"
            aria-selected={!selectedId}
            onClick={() => { onChange(''); close(); }}
            className={`flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors ${
              focusIndex === 0 ? 'bg-secondary/60' : 'hover:bg-secondary/50'
            } ${!selectedId ? 'text-foreground/80' : 'text-muted-foreground/90'}`}
          >
            <span className="text-muted-foreground/80">&mdash;</span>
            <span>None</span>
          </button>
          {creds.map((cred, i) => (
            <button
              key={cred.id}
              role="option"
              aria-selected={cred.id === selectedId}
              onClick={() => { onChange(cred.id); close(); }}
              className={`flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors ${
                focusIndex === i + 1 ? 'bg-secondary/60' : 'hover:bg-secondary/50'
              } ${cred.id === selectedId ? 'text-foreground' : 'text-foreground/80'}`}
            >
              {channelIcon(cred.service_type)}
              <span className="flex-1 text-left truncate">{cred.name}</span>
              <span className="text-sm text-muted-foreground/80">{cred.service_type}</span>
              {cred.id === selectedId && <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
            </button>
          ))}
          {creds.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground/80">No credentials available</div>
          )}
        </>
      )}
    </Listbox>
  );
}
