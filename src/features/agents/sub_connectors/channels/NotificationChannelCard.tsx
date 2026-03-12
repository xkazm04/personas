import { useState } from 'react';
import { X, Send, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { CredentialPicker, channelIcon } from './CredentialPicker';
import type { CredentialMetadata } from '@/lib/types/types';

interface ConfigField {
  key: string;
  label: string;
  placeholder: string;
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
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  const handleTestNotification = async () => {
    setTestStatus('sending');
    setTestError('');
    try {
      const channelPayload = JSON.stringify({ type, enabled: true, config, credential_id: credentialId });
      await invoke<string>('test_notification_channel', { channelJson: channelPayload });
      setTestStatus('success');
      setTimeout(() => setTestStatus('idle'), 3000);
    } catch (err) {
      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setTestStatus('idle'), 5000);
    }
  };

  return (
    <div
      className={`border rounded-xl p-2.5 space-y-2 transition-colors ${
        enabled ? 'bg-secondary/30 border-primary/20' : 'bg-secondary/10 border-primary/20 opacity-60'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        {channelIcon(type)}
        <span className="text-sm font-medium text-foreground/80 flex-1 capitalize">{type}</span>
        <AccessibleToggle
          checked={enabled}
          onChange={onToggleEnabled}
          label={`Enable ${type} notifications`}
          size="sm"
        />
        <button
          onClick={onRemove}
          className="p-1 text-muted-foreground/80 hover:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Config fields */}
      {configFields.map((field) => {
        const isEmpty = enabled && hasValidationErrors && !config[field.key]?.trim();
        return (
          <div key={field.key}>
            <label className="block text-sm font-medium text-foreground/80 mb-1">{field.label}</label>
            <input
              type="text"
              value={config[field.key] || ''}
              onChange={(e) => onConfigChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className={`w-full px-2.5 py-1.5 bg-background/50 border rounded-xl text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/30 ${isEmpty ? 'border-red-500/50' : 'border-primary/20'}`}
            />
          </div>
        );
      })}

      {/* Credential picker */}
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1">Credential</label>
        <CredentialPicker
          credentials={matchingCredentials}
          selectedId={credentialId}
          onChange={onCredentialChange}
        />
        {credentialId ? (
          <span className="text-sm text-emerald-400/70 mt-0.5 block">Connected</span>
        ) : (
          <span className="text-sm text-amber-400/70 mt-0.5 block">Credential needed</span>
        )}
      </div>

      {/* Test notification button */}
      <div className="pt-1">
        <button
          onClick={handleTestNotification}
          disabled={!enabled || testStatus === 'sending'}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
            testStatus === 'success'
              ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-300'
              : testStatus === 'error'
                ? 'bg-red-500/15 border border-red-500/25 text-red-300'
                : 'bg-secondary/60 border border-primary/20 text-muted-foreground/90 hover:text-foreground/95 hover:bg-secondary/80'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {testStatus === 'sending' ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</>
          ) : testStatus === 'success' ? (
            <><CheckCircle2 className="w-3.5 h-3.5" /> Delivered</>
          ) : testStatus === 'error' ? (
            <><AlertCircle className="w-3.5 h-3.5" /> Failed</>
          ) : (
            <><Send className="w-3.5 h-3.5" /> Test Notification</>
          )}
        </button>
        {testStatus === 'error' && testError && (
          <p className="text-xs text-red-400/80 mt-1 truncate" title={testError}>{testError}</p>
        )}
      </div>
    </div>
  );
}
