import { Bell, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { NotificationChannelCard } from './NotificationChannelCard';
import { AddChannelButton } from './AddChannelButton';
import { TOOLS_BORDER } from '@/lib/utils/designTokens';
import { AnimatedList } from '@/features/shared/components/display/AnimatedList';

export const channelTypes: Array<{
  type: NotificationChannelType;
  label: string;
  configFields: Array<{ key: string; label: string; placeholder: string }>;
}> = [
  { type: 'slack', label: 'Slack', configFields: [
    { key: 'webhook_url', label: 'Notification delivery URL', placeholder: 'e.g. https://hooks.slack.com/services/T00.../B00.../xxxx' },
    { key: 'channel', label: 'Channel (optional)', placeholder: '#general' },
  ] },
  { type: 'telegram', label: 'Telegram', configFields: [
    { key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF...' },
    { key: 'chat_id', label: 'Chat ID', placeholder: '123456789' },
  ] },
  { type: 'email', label: 'Email', configFields: [
    { key: 'to', label: 'To Address', placeholder: 'user@example.com' },
    { key: 'from', label: 'From Address (optional)', placeholder: 'noreply@personas.app' },
    { key: 'sendgrid_api_key', label: 'SendGrid API Key', placeholder: 'SG.xxxx' },
  ] },
];

interface ChannelListProps {
  channels: NotificationChannel[];
  credentials: CredentialMetadata[];
  connectorDefinitions: Array<{ name: string }>;
  validationErrors: string[];
  existingTypes: Set<NotificationChannelType>;
  onToggleEnabled: (index: number) => void;
  onRemove: (index: number) => void;
  onConfigChange: (index: number, key: string, value: string) => void;
  onCredentialChange: (index: number, id: string) => void;
  onAdd: (type: NotificationChannelType) => void;
}

export function ChannelList({
  channels, credentials, connectorDefinitions,
  validationErrors, existingTypes,
  onToggleEnabled, onRemove, onConfigChange, onCredentialChange, onAdd,
}: ChannelListProps) {
  const getMatchingCredentials = (type: string) => {
    if (!type) return [];
    const connectorName = type === 'email' ? 'gmail' : type;
    const connector = connectorDefinitions.find(c => c.name === connectorName);
    if (!connector) return [];
    return credentials.filter(c => c.service_type === connectorName);
  };

  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {/* In-App (always present, read-only) */}
      <div className={`flex items-center gap-3 p-2.5 bg-secondary/30 border ${TOOLS_BORDER} rounded-modal`}>
        <Bell className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <span className="text-sm font-medium text-foreground/80 flex-1">{t.agents.connectors.ch_in_app}</span>
        <span className="flex items-center gap-1 text-sm text-emerald-400/80">
          <Check className="w-3 h-3" /> {t.agents.connectors.ch_always_active}
        </span>
      </div>

      {/* External channels */}
      {channels.length > 0 && (
        <AnimatedList
          className="space-y-3"
          keys={channels.map((c, i) => `${c.type}_${i}`)}
        >
          {channels.map((channel, index) => {
            const typeDef = channelTypes.find(t => t.type === channel.type);
            return (
              <NotificationChannelCard
                key={`${channel.type}_${index}`}
                type={channel.type} enabled={channel.enabled} config={channel.config}
                credentialId={channel.credential_id}
                configFields={typeDef?.configFields ?? []}
                matchingCredentials={getMatchingCredentials(channel.type)}
                hasValidationErrors={validationErrors.length > 0}
                onToggleEnabled={() => onToggleEnabled(index)}
                onRemove={() => onRemove(index)}
                onConfigChange={(key, value) => onConfigChange(index, key, value)}
                onCredentialChange={(id) => onCredentialChange(index, id)}
              />
            );
          })}
        </AnimatedList>
      )}

      <AddChannelButton channelTypes={channelTypes} existingTypes={existingTypes} onAdd={onAdd} />

      {validationErrors.length > 0 && (
        <div className="space-y-1">
          {validationErrors.map((err, i) => (
            <p key={i} className="text-sm text-red-400">{err}</p>
          ))}
        </div>
      )}
    </div>
  );
}
