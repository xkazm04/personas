import { useState } from 'react';
import { X, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { testNotificationChannel } from "@/api/agents/channelDelivery";
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { CredentialPicker, channelIcon } from '../connectors/CredentialPicker';
import type { CredentialMetadata } from '@/lib/types/types';
import type { Translations } from '@/i18n/generated/types';
import { TOOLS_BORDER, TOOLS_INNER_SPACE } from '@/lib/utils/designTokens';
import { errMsg } from '@/stores/storeTypes';

interface ConfigField {
  key: string;
  labelKey: keyof Translations['agents']['connectors'];
  /** Technical example value, never translated. */
  placeholder: string;
  placeholderIsExample?: boolean;
  /** A destination (channel, chat id, address): rendered readable. Default is masked. */
  public?: boolean;
}

interface NotificationChannelCardProps {
  type: string;
  enabled: boolean;
  config: Record<string, string>;
  credentialId?: string;
  configFields: ConfigField[];
  matchingCredentials: CredentialMetadata[];
  hasValidationErrors: boolean;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onConfigChange: (key: string, value: string) => void;
  onCredentialChange: (credentialId: string) => void;
}

export function NotificationChannelCard({
  type,
  enabled,
  config,
  credentialId,
  configFields,
  matchingCredentials,
  hasValidationErrors,
  onToggleEnabled,
  onRemove,
  onConfigChange,
  onCredentialChange,
}: NotificationChannelCardProps) {
  const { t, tx } = useTranslation();
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  const handleTestNotification = async () => {
    setTestStatus('sending');
    setTestError('');
    try {
      await testNotificationChannel({ type, enabled: true, config, credential_id: credentialId });
      setTestStatus('success');
      setTimeout(() => setTestStatus('idle'), 3000);
    } catch (err) {
      setTestStatus('error');
      // Structured AppError envelope (`{ error, kind, … }`) — not an Error instance.
      setTestError(errMsg(err, String(err)));
      setTimeout(() => setTestStatus('idle'), 5000);
    }
  };

  return (
    <div
      className={`border rounded-modal p-2.5 ${TOOLS_INNER_SPACE} transition-colors ${
        enabled ? `bg-secondary/30 ${TOOLS_BORDER}` : `bg-secondary/10 ${TOOLS_BORDER} opacity-60`
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        {channelIcon(type)}
        <span className="typo-body font-medium text-foreground flex-1 capitalize">{type}</span>
        <AccessibleToggle
          checked={enabled}
          onChange={onToggleEnabled}
          label={tx(t.agents.connectors.ch_enable, { type })}
          size="sm"
        />
        <button
          type="button"
          onClick={onRemove}
          className="p-1 text-foreground hover:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Config fields */}
      {configFields.map((field) => {
        const isEmpty = enabled && hasValidationErrors && !config[field.key]?.trim();
        return (
          <div key={field.key}>
            <label className="block typo-body font-medium text-foreground mb-1">{t.agents.connectors[field.labelKey]}</label>
            <input
              type={field.public ? 'text' : 'password'}
              autoComplete={field.public ? undefined : 'off'}
              value={config[field.key] || ''}
              onChange={(e) => onConfigChange(field.key, e.target.value)}
              placeholder={field.placeholderIsExample
                ? tx(t.agents.connectors.ch_placeholder_example, { value: field.placeholder })
                : field.placeholder}
              className={`w-full px-2.5 py-1.5 bg-background/50 border rounded-modal typo-body text-foreground placeholder:text-foreground focus-ring ${isEmpty ? 'border-red-500/50' : TOOLS_BORDER}`}
            />
          </div>
        );
      })}

      {/* Credential picker */}
      <div>
        <label className="block typo-body font-medium text-foreground mb-1">{t.agents.connectors.ch_credential}</label>
        <CredentialPicker
          credentials={matchingCredentials}
          selectedId={credentialId}
          onChange={onCredentialChange}
        />
        {credentialId ? (
          <span className="typo-body text-emerald-400/70 mt-0.5 block">{t.agents.connectors.ch_connected}</span>
        ) : (
          <span className="typo-body text-amber-400/70 mt-0.5 block">{t.agents.connectors.ch_cred_needed}</span>
        )}
      </div>

      {/* Test notification button */}
      <div className="pt-1">
        {/* An action control: its busy state is Button's real spinner. The
            old `<LoadingSpinner/>` rendered null, so "sending" had no icon. */}
        <Button
          variant={testStatus === 'success' || testStatus === 'error' ? 'accent' : 'secondary'}
          accentColor={testStatus === 'success' ? 'emerald' : testStatus === 'error' ? 'rose' : undefined}
          size="sm"
          onClick={handleTestNotification}
          disabled={!enabled}
          loading={testStatus === 'sending'}
          loadingLabel={t.agents.connectors.ch_sending}
          icon={
            testStatus === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" />
              : testStatus === 'error' ? <AlertCircle className="w-3.5 h-3.5" />
                : <Send className="w-3.5 h-3.5" />
          }
        >
          {testStatus === 'success'
            ? t.agents.connectors.ch_delivered
            : testStatus === 'error'
              ? t.agents.connectors.ch_failed
              : t.agents.connectors.ch_test}
        </Button>
        {testStatus === 'error' && testError && (
          <p className="typo-caption text-red-400/80 mt-1 truncate" title={testError}>{testError}</p>
        )}
      </div>
    </div>
  );
}
