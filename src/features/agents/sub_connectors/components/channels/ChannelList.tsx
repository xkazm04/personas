import { Bell, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import type { Translations } from '@/i18n/generated/types';
import { NotificationChannelCard } from './NotificationChannelCard';
import { AddChannelButton } from './AddChannelButton';
import { TOOLS_BORDER } from '@/lib/utils/designTokens';
import { AnimatedList } from '@/features/shared/components/display/AnimatedList';

type ConnectorsKey = keyof Translations['agents']['connectors'];

export const channelTypes: Array<{
  type: NotificationChannelType;
  /** Brand name shown as-is (Slack, Telegram); overridden by `labelKey` when set. */
  label: string;
  /** `t.agents.connectors.<labelKey>` for a channel name that is not a brand. */
  labelKey?: ConnectorsKey;
  configFields: Array<{
    key: string;
    /** `t.agents.connectors.<labelKey>`: the field label is display copy. */
    labelKey: ConnectorsKey;
    /** A technical example value, never translated. */
    placeholder: string;
    /** Render the placeholder through `ch_placeholder_example` ("e.g. ..."). */
    placeholderIsExample?: boolean;
    /**
     * Whether save-time validation may skip this field. It is DATA, not a
     * reading of `label`: validateChannels used to decide optionality with
     * `label.toLowerCase().includes('(optional)')`, which made a display
     * string load-bearing -- rewording the label, or routing it through
     * `t.*` for translation (as `labelKey` now does), silently turned both optional fields into
     * required ones and blocked save with no way for the user to satisfy it.
     */
    optional?: boolean;
    /**
     * A destination, not a secret: rendered readable. Everything NOT flagged
     * masks by default, so a field added without a verdict fails towards
     * over-masking (the credential-capture-form golden path: the default is
     * masked, and only a deliberate `public` flag opens it). The vault's own
     * form for these same keys (`builtin_connectors.rs`: `webhook_url`,
     * `bot_token`, `sendgrid_api_key` are all `"type":"password"`) masks
     * them; this form rendered every field as plain text, so a Slack webhook
     * URL or a Telegram bot token sat readable on screen and in screen-shares.
     */
    public?: boolean;
  }>;
}> = [
  { type: 'slack', label: 'Slack', configFields: [
    { key: 'webhook_url', labelKey: 'ch_field_webhook_url', placeholder: 'https://hooks.slack.com/services/T00.../B00.../xxxx', placeholderIsExample: true },
    { key: 'channel', labelKey: 'ch_field_channel_optional', placeholder: '#general', optional: true, public: true },
  ] },
  { type: 'telegram', label: 'Telegram', configFields: [
    { key: 'bot_token', labelKey: 'ch_field_bot_token', placeholder: '123456:ABC-DEF...' },
    { key: 'chat_id', labelKey: 'ch_field_chat_id', placeholder: '123456789', public: true },
  ] },
  { type: 'email', label: 'Email', labelKey: 'ch_type_email', configFields: [
    { key: 'to', labelKey: 'ch_field_to_address', placeholder: 'user@example.com', public: true },
    { key: 'from', labelKey: 'ch_field_from_address_optional', placeholder: 'noreply@personas.app', optional: true, public: true },
    { key: 'sendgrid_api_key', labelKey: 'ch_field_sendgrid_key', placeholder: 'SG.xxxx' },
  ] },
];

/** Display name of a channel type: a brand as-is, otherwise its translated label. */
export function channelTypeLabel(
  t: Translations,
  def: { label: string; labelKey?: ConnectorsKey },
): string {
  return def.labelKey ? t.agents.connectors[def.labelKey] : def.label;
}

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
  channels, credentials,
  validationErrors, existingTypes,
  onToggleEnabled, onRemove, onConfigChange, onCredentialChange, onAdd,
}: ChannelListProps) {
  const getMatchingCredentials = (type: string) => {
    if (!type) return [];
    const connectorName = type === 'email' ? 'gmail' : type;
    // Match on the credential's service type alone: a catalog that has not
    // loaded yet must not hide a credential the vault already holds.
    return credentials.filter(c => c.service_type === connectorName);
  };

  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {/* In-App (always present, read-only) */}
      <div className={`flex items-center gap-3 p-2.5 bg-secondary/30 border ${TOOLS_BORDER} rounded-modal`}>
        <Bell className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <span className="typo-body text-foreground flex-1">{t.agents.connectors.ch_in_app}</span>
        <span className="flex items-center gap-1 typo-body text-emerald-400/80">
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
            <p key={i} className="typo-body text-red-400">{err}</p>
          ))}
        </div>
      )}
    </div>
  );
}
