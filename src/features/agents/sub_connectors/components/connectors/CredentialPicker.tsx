import { useCallback } from 'react';
import { Hash, Send, Mail, Bell, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { CredentialMetadata } from '@/lib/types/types';

export function channelIcon(type: string) {
  switch (type) {
    case 'slack': return <Hash className="w-4 h-4 text-role-agent" />;
    case 'telegram': return <Send className="w-4 h-4 text-status-info" />;
    case 'email': return <Mail className="w-4 h-4 text-status-warning" />;
    default: return <Bell className="w-4 h-4 text-ink-1" />;
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
  const { t } = useTranslation();
  const selected = creds.find((c) => c.id === selectedId);

  const handleSelectFocused = useCallback((index: number) => {
    if (index === 0) onChange('');
    else { const cred = creds[index - 1]; if (cred) onChange(cred.id); }
  }, [creds, onChange]);

  return (
    <Listbox
      ariaLabel={t.agents.connectors.cp_select_label}
      itemCount={creds.length + 1}
      onSelectFocused={handleSelectFocused}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-background/50 border border-hair rounded-modal typo-body text-ink-1 focus-ring transition-all"
        >
          {selected ? (
            <>
              {channelIcon(selected.service_type)}
              <span className="flex-1 text-left truncate">{selected.name}</span>
              <span className="typo-body text-ink-1">{selected.service_type}</span>
            </>
          ) : (
            <span className="flex-1 text-left text-ink-1">{t.agents.connectors.cp_select}</span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-ink-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <>
          <button
            type="button"
            role="option"
            aria-selected={!selectedId}
            onClick={() => { onChange(''); close(); }}
            className={`flex items-center gap-3 w-full px-3 py-2 typo-body transition-colors ${
              focusIndex === 0 ? 'bg-surface-2' : 'hover:bg-surface-2'
            } ${!selectedId ? 'text-ink-1' : 'text-ink-1'}`}
          >
            <span className="text-ink-1">&mdash;</span>
            <span>{t.common.none}</span>
          </button>
          {creds.map((cred, i) => (
            <button
              key={cred.id}
              type="button"
              role="option"
              aria-selected={cred.id === selectedId}
              onClick={() => { onChange(cred.id); close(); }}
              className={`flex items-center gap-3 w-full px-3 py-2 typo-body transition-colors ${
                focusIndex === i + 1 ? 'bg-surface-2' : 'hover:bg-surface-2'
              } ${cred.id === selectedId ? 'text-ink-1' : 'text-ink-1'}`}
            >
              {channelIcon(cred.service_type)}
              <span className="flex-1 text-left truncate">{cred.name}</span>
              <span className="typo-body text-ink-1">{cred.service_type}</span>
              {cred.id === selectedId && <Check className="w-3 h-3 text-status-success flex-shrink-0" />}
            </button>
          ))}
          {creds.length === 0 && (
            <div className="px-3 py-2 typo-body text-ink-1">{t.agents.connectors.cp_no_creds}</div>
          )}
        </>
      )}
    </Listbox>
  );
}
