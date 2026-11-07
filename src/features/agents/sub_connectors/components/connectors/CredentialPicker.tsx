import { useCallback } from 'react';
import { Hash, Send, Mail, Bell, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { CredentialMetadata } from '@/lib/types/types';
import Button from '@/features/shared/components/buttons/Button';
import { OptionRow } from '@/features/shared/components/forms/OptionRow';

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
        <Button
          variant="secondary"
          size="md"
          pressed={isOpen}
          onClick={toggle}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className="w-full"
        >
          {selected ? (
            <>
              {channelIcon(selected.service_type)}
              <span className="flex-1 text-left truncate">{selected.name}</span>
              <span className="typo-caption text-ink-3">{selected.service_type}</span>
            </>
          ) : (
            <span className="flex-1 text-left text-ink-2">{t.agents.connectors.cp_select}</span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-ink-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </Button>
      )}
    >
      {({ close, focusIndex }) => (
        <>
          <OptionRow
            role="option"
            selected={!selectedId}
            onSelect={() => { onChange(''); close(); }}
            className={focusIndex === 0 ? 'bg-surface-2' : ''}
          >
            <span className="flex items-center gap-3">
              <span className="text-ink-3">&mdash;</span>
              <span>{t.common.none}</span>
            </span>
          </OptionRow>
          {creds.map((cred, i) => (
            <OptionRow
              key={cred.id}
              role="option"
              selected={cred.id === selectedId}
              onSelect={() => { onChange(cred.id); close(); }}
              className={focusIndex === i + 1 ? 'bg-surface-2' : ''}
              meta={cred.service_type}
            >
              <span className="flex items-center gap-3">
                {channelIcon(cred.service_type)}
                <span className="flex-1 truncate">{cred.name}</span>
                {cred.id === selectedId && <Check className="w-3 h-3 text-status-success flex-shrink-0" />}
              </span>
            </OptionRow>
          ))}
          {creds.length === 0 && (
            <div className="px-3 py-2 typo-body text-ink-1">{t.agents.connectors.cp_no_creds}</div>
          )}
        </>
      )}
    </Listbox>
  );
}
