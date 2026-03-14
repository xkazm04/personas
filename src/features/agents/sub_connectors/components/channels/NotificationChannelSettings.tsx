import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { useEditorDirty } from '@/features/agents/sub_editor';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { ChannelList, channelTypes } from './ChannelList';
import { TOOLS_BORDER } from '@/lib/utils/designTokens';

interface NotificationChannelSettingsProps {
  personaId?: string;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  draftChannels?: NotificationChannel[];
  onDraftChannelsChange?: (channels: NotificationChannel[]) => void;
}

export function NotificationChannelSettings({ personaId, credentials, connectorDefinitions, draftChannels, onDraftChannelsChange }: NotificationChannelSettingsProps) {
  const isDraftMode = draftChannels !== undefined && onDraftChannelsChange !== undefined;
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);

  const [channels, setChannelsInternal] = useState<NotificationChannel[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

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
    try { const parsed = JSON.parse(selectedPersona.notification_channels); setChannelsInternal(Array.isArray(parsed) ? parsed : []); }
    catch { setChannelsInternal([]); }
    setIsDirty(false);
  }, [selectedPersona?.notification_channels, isDraftMode]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  const handleAddChannel = (type: NotificationChannelType) => { setChannels([...effectiveChannels, { type, config: {}, enabled: true }]); if (!isDraftMode) setIsDirty(true); };
  const handleRemoveChannel = (index: number) => { setChannels(effectiveChannels.filter((_, i) => i !== index)); if (!isDraftMode) setIsDirty(true); };
  const handleToggleEnabled = (index: number) => { setChannels(effectiveChannels.map((c, i) => i === index ? { ...c, enabled: !c.enabled } : c)); if (!isDraftMode) setIsDirty(true); };
  const handleConfigChange = (index: number, key: string, value: string) => {
    setChannels(effectiveChannels.map((c, i) => i === index ? { ...c, config: { ...c.config, [key]: value } } : c));
    if (!isDraftMode) setIsDirty(true);
    if (validationErrors.length > 0) setValidationErrors([]);
  };
  const handleCredentialChange = (index: number, credentialId: string) => {
    setChannels(effectiveChannels.map((c, i) => i === index ? { ...c, credential_id: credentialId || undefined } : c));
    if (!isDraftMode) setIsDirty(true);
  };

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
    try { await applyPersonaOp(personaId, { kind: 'UpdateNotifications', notification_channels: JSON.stringify(effectiveChannels) }); setIsDirty(false); }
    catch (error) {
      console.error('Failed to save notification channels:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save channels');
      setIsDirty(true);
    }
    finally { setIsSaving(false); }
  };

  const saveRef = useRef(handleSave); saveRef.current = handleSave;
  const stableSave = useCallback(async () => { await saveRef.current(); }, []);
  const unregisterDirty = useEditorDirty('notifications', isDirty && !isDraftMode, stableSave);
  useEffect(() => unregisterDirty, [unregisterDirty]);

  const existingTypes = new Set(effectiveChannels.map(c => c.type));

  return (
    <div className={`bg-secondary/40 backdrop-blur-sm border ${TOOLS_BORDER} rounded-xl p-4`}>
      <SectionHeader className="mb-6" icon={<Bell className="w-3.5 h-3.5" />} label="Notification Channels" />
      <ChannelList
        channels={effectiveChannels} credentials={credentials} connectorDefinitions={connectorDefinitions}
        validationErrors={validationErrors} existingTypes={existingTypes}
        onToggleEnabled={handleToggleEnabled} onRemove={handleRemoveChannel}
        onConfigChange={handleConfigChange} onCredentialChange={handleCredentialChange}
        onAdd={handleAddChannel}
      />
      {!isDraftMode && isDirty && (
        <button onClick={handleSave} disabled={isSaving}
          title={isSaving ? 'Saving channels...' : undefined}
          className="flex items-center gap-2 px-4 py-2 mt-3 rounded-xl font-medium text-sm bg-primary hover:bg-primary/90 text-foreground shadow-lg shadow-primary/20 transition-all">
          {isSaving ? 'Saving...' : 'Save Channels'}
        </button>
      )}
      {saveError && (
        <div className="px-3 py-2 mt-2 rounded-xl border border-red-500/20 bg-red-500/10 text-sm text-red-400/80">
          {saveError}
        </div>
      )}
    </div>
  );
}
