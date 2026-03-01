import { X } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
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
  return (
    <div
      className={`border rounded-xl p-2.5 space-y-2 transition-colors ${
        enabled ? 'bg-secondary/30 border-primary/15' : 'bg-secondary/10 border-primary/15 opacity-60'
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
            <label className="block text-sm font-mono text-muted-foreground/80 uppercase mb-1">{field.label}</label>
            <input
              type="text"
              value={config[field.key] || ''}
              onChange={(e) => onConfigChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className={`w-full px-2.5 py-1.5 bg-background/50 border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/30 ${isEmpty ? 'border-red-500/50' : 'border-primary/15'}`}
            />
          </div>
        );
      })}

      {/* Credential picker */}
      <div>
        <label className="block text-sm font-mono text-muted-foreground/80 uppercase mb-1">Credential</label>
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
    </div>
  );
}
