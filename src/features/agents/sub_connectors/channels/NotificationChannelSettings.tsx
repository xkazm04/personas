import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Check } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { useEditorDirty } from '@/features/agents/sub_editor/EditorDocument';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { NotificationChannelCard } from './NotificationChannelCard';
import { AddChannelButton } from './AddChannelButton';

interface NotificationChannelSettingsProps {
  /** Persona ID for persisted mode -- omit for draft mode */
  personaId?: string;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  /** Draft mode: external channel state */
  draftChannels?: NotificationChannel[];
  /** Draft mode: callback on every change (no save button shown) */
  onDraftChannelsChange?: (channels: NotificationChannel[]) => void;
}

const channelTypes: Array<{ type: NotificationChannelType; label: string; configFields: Array<{ key: string; label: string; placeholder: string }> }> = [
  { type: 'slack', label: 'Slack', configFields: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
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

export function NotificationChannelSettings({ personaId, credentials, connectorDefinitions, draftChannels, onDraftChannelsChange }: NotificationChannelSettingsProps) {
  const isDraftMode = draftChannels !== undefined && onDraftChannelsChange !== undefined;
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);

  const [channels, setChannelsInternal] = useState<NotificationChannel[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const effectiveChannels = isDraftMode ? draftChannels : channels;
  const setChannels = isDraftMode
    ? (updater: NotificationChannel[] | ((prev: NotificationChannel[]) => NotificationChannel[])) => {
        const next = typeof updater === 'function' ? updater(draftChannels) : updater;
        onDraftChannelsChange(next);
      }
    : (updater: NotificationChannel[] | ((prev: NotificationChannel[]) => NotificationChannel[])) => {
        if (typeof updater === 'function') setChannelsInternal(updater);
        else setChannelsInternal(updater);
      };

  const loadChannels = useCallback(() => {
    if (isDraftMode) return;
    if (!selectedPersona?.notification_channels) { setChannelsInternal([]); return; }
    try {
      const parsed = JSON.parse(selectedPersona.notification_channels);
      setChannelsInternal(Array.isArray(parsed) ? parsed : []);
    } catch { /* intentional: non-critical -- JSON parse fallback */ setChannelsInternal([]); }
    setIsDirty(false);
  }, [selectedPersona?.notification_channels, isDraftMode]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  const handleAddChannel = (type: NotificationChannelType) => {
    setChannels([...effectiveChannels, { type, config: {}, enabled: true }]);
    if (!isDraftMode) setIsDirty(true);
  };

  const handleRemoveChannel = (index: number) => {
    setChannels(effectiveChannels.filter((_, i) => i !== index));
    if (!isDraftMode) setIsDirty(true);
  };

  const handleToggleEnabled = (index: number) => {
    setChannels(effectiveChannels.map((c, i) => i === index ? { ...c, enabled: !c.enabled } : c));
    if (!isDraftMode) setIsDirty(true);
  };

  const handleConfigChange = (index: number, key: string, value: string) => {
    setChannels(effectiveChannels.map((c, i) => i === index ? { ...c, config: { ...c.config, [key]: value } } : c));
    if (!isDraftMode) setIsDirty(true);
    if (validationErrors.length > 0) setValidationErrors([]);
  };

  const handleCredentialChange = (index: number, credentialId: string) => {
    setChannels(effectiveChannels.map((c, i) => i === index ? { ...c, credential_id: credentialId || undefined } : c));
    if (!isDraftMode) setIsDirty(true);
  };

  // Fields whose label contains "(optional)" are skipped during validation.
  const validateChannels = (): string[] => {
    const errors: string[] = [];
    for (const channel of effectiveChannels) {
      if (!channel.enabled) continue;
      const typeDef = channelTypes.find(t => t.type === channel.type);
      if (!typeDef) continue;
      for (const field of typeDef.configFields) {
        if (field.label.toLowerCase().includes('(optional)')) continue;
        if (!channel.config[field.key]?.trim()) errors.push(`${typeDef.label}: ${field.label} is required`);
      }
    }
    return errors;
  };

  const handleSave = async () => {
    if (isDraftMode || !personaId) return;
    setSaveError(null);
    const errors = validateChannels();
    setValidationErrors(errors);
    if (errors.length > 0) return;
    setIsSaving(true);
    try {
      await applyPersonaOp(personaId, { kind: 'UpdateNotifications', notification_channels: JSON.stringify(effectiveChannels) });
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to save notification channels:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save channels');
      setIsDirty(true);
    }
    finally { setIsSaving(false); }
  };

  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const stableSave = useCallback(async () => { await saveRef.current(); }, []);
  const unregisterDirty = useEditorDirty('notifications', isDirty && !isDraftMode, stableSave);
  useEffect(() => unregisterDirty, [unregisterDirty]);

  const getMatchingCredentials = (type: string) => {
    const connectorName = type === 'email' ? 'gmail' : type;
    const connector = connectorDefinitions.find(c => c.name === connectorName);
    if (!connector) return credentials;
    return credentials.filter(c => c.service_type === connectorName);
  };

  const existingTypes = new Set(effectiveChannels.map(c => c.type));

  return (
    <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl p-4">
      <SectionHeader
        className="mb-6"
        icon={<Bell className="w-3.5 h-3.5" />}
        label="Notification Channels"
      />

      <div className="space-y-3">
        {/* In-App (always present, read-only) */}
        <div className="flex items-center gap-3 p-2.5 bg-secondary/30 border border-primary/20 rounded-xl">
          <Bell className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-sm font-medium text-foreground/80 flex-1">In-App Messages</span>
          <span className="flex items-center gap-1 text-sm text-emerald-400/80">
            <Check className="w-3 h-3" />
            Always active
          </span>
        </div>

        {/* External channels */}
        {effectiveChannels.map((channel, index) => {
          const typeDef = channelTypes.find(t => t.type === channel.type);
          return (
            <NotificationChannelCard
              key={`${channel.type}_${index}`}
              type={channel.type}
              enabled={channel.enabled}
              config={channel.config}
              credentialId={channel.credential_id}
              configFields={typeDef?.configFields ?? []}
              matchingCredentials={getMatchingCredentials(channel.type)}
              hasValidationErrors={validationErrors.length > 0}
              onToggleEnabled={() => handleToggleEnabled(index)}
              onRemove={() => handleRemoveChannel(index)}
              onConfigChange={(key, value) => handleConfigChange(index, key, value)}
              onCredentialChange={(id) => handleCredentialChange(index, id)}
            />
          );
        })}

        {/* Add channel button */}
        <AddChannelButton
          channelTypes={channelTypes}
          existingTypes={existingTypes}
          onAdd={handleAddChannel}
        />

        {/* Errors */}
        {(validationErrors.length > 0 || saveError) && (
          <div role="alert" className="space-y-1">
            {validationErrors.map((err, i) => (
              <p key={i} className="text-sm text-red-400">{err}</p>
            ))}
            {saveError && (
              <p className="text-sm text-red-400">{saveError}</p>
            )}
          </div>
        )}

        {/* Save button (persisted mode only) */}
        {!isDraftMode && isDirty && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm bg-primary hover:bg-primary/90 text-foreground shadow-lg shadow-primary/20 transition-all"
          >
            {isSaving ? 'Saving...' : 'Save Channels'}
          </button>
        )}
      </div>
    </div>
  );
}
