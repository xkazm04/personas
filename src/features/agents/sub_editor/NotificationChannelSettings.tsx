import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Hash, Send, Mail, Plus, X, Check, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';

interface NotificationChannelSettingsProps {
  /** Persona ID for persisted mode — omit for draft mode */
  personaId?: string;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  /** Draft mode: external channel state */
  draftChannels?: NotificationChannel[];
  /** Draft mode: callback on every change (no save button shown) */
  onDraftChannelsChange?: (channels: NotificationChannel[]) => void;
}

const channelTypes: Array<{ type: NotificationChannelType; label: string; icon: typeof Hash; configFields: Array<{ key: string; label: string; placeholder: string }> }> = [
  { type: 'slack', label: 'Slack', icon: Hash, configFields: [{ key: 'channel', label: 'Channel', placeholder: '#general' }] },
  { type: 'telegram', label: 'Telegram', icon: Send, configFields: [{ key: 'chat_id', label: 'Chat ID', placeholder: '123456789' }] },
  { type: 'email', label: 'Email', icon: Mail, configFields: [{ key: 'to', label: 'To Address', placeholder: 'user@example.com' }] },
];

function channelIcon(type: string) {
  switch (type) {
    case 'slack': return <Hash className="w-4 h-4 text-purple-400" />;
    case 'telegram': return <Send className="w-4 h-4 text-blue-400" />;
    case 'email': return <Mail className="w-4 h-4 text-amber-400" />;
    default: return <Bell className="w-4 h-4 text-muted-foreground/90" />;
  }
}

function CredentialPicker({
  credentials: creds,
  selectedId,
  onChange,
}: {
  credentials: CredentialMetadata[];
  selectedId: string | undefined;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = creds.find((c) => c.id === selectedId);
  // Options: empty option + credentials
  const optionCount = creds.length + 1;

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex((i) => Math.min(i + 1, optionCount - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusIndex === 0) { onChange(''); setOpen(false); }
        else if (focusIndex > 0) { const cred = creds[focusIndex - 1]; if (cred) { onChange(cred.id); setOpen(false); } }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, focusIndex, optionCount, creds, onChange]);

  useEffect(() => {
    if (open) setFocusIndex(-1);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
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
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/80 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute top-full mt-1 left-0 right-0 bg-background border border-primary/15 rounded-xl shadow-lg z-20 overflow-hidden"
            role="listbox"
            aria-label="Select credential"
          >
            <button
              role="option"
              aria-selected={!selectedId}
              onClick={() => { onChange(''); setOpen(false); }}
              className={`flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors ${
                focusIndex === 0 ? 'bg-secondary/60' : 'hover:bg-secondary/50'
              } ${!selectedId ? 'text-foreground/80' : 'text-muted-foreground/90'}`}
            >
              <span className="text-muted-foreground/80">—</span>
              <span>None</span>
            </button>
            {creds.map((cred, i) => (
              <button
                key={cred.id}
                role="option"
                aria-selected={cred.id === selectedId}
                onClick={() => { onChange(cred.id); setOpen(false); }}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function NotificationChannelSettings({ personaId, credentials, connectorDefinitions, draftChannels, onDraftChannelsChange }: NotificationChannelSettingsProps) {
  const isDraftMode = draftChannels !== undefined && onDraftChannelsChange !== undefined;
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const updatePersona = usePersonaStore((s) => s.updatePersona);

  const [channels, setChannelsInternal] = useState<NotificationChannel[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // In draft mode, use external state; otherwise internal state
  const effectiveChannels = isDraftMode ? draftChannels : channels;
  const setChannels = isDraftMode
    ? (updater: NotificationChannel[] | ((prev: NotificationChannel[]) => NotificationChannel[])) => {
        const next = typeof updater === 'function' ? updater(draftChannels) : updater;
        onDraftChannelsChange(next);
      }
    : (updater: NotificationChannel[] | ((prev: NotificationChannel[]) => NotificationChannel[])) => {
        if (typeof updater === 'function') {
          setChannelsInternal(updater);
        } else {
          setChannelsInternal(updater);
        }
      };

  // Close dropdown on click-outside or Escape key
  useEffect(() => {
    if (!showAddMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAddMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAddMenu]);

  // Load channels from persona's notification_channels JSON string (persisted mode only)
  const loadChannels = useCallback(() => {
    if (isDraftMode) return; // draft mode uses external state
    if (!selectedPersona?.notification_channels) {
      setChannelsInternal([]);
      return;
    }
    try {
      const parsed = JSON.parse(selectedPersona.notification_channels);
      setChannelsInternal(Array.isArray(parsed) ? parsed : []);
    } catch {
      setChannelsInternal([]);
    }
    setIsDirty(false);
  }, [selectedPersona?.notification_channels, isDraftMode]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const handleAddChannel = (type: NotificationChannelType) => {
    const newChannel: NotificationChannel = {
      type,
      config: {},
      enabled: true,
    };
    setChannels([...effectiveChannels, newChannel]);
    if (!isDraftMode) setIsDirty(true);
    setShowAddMenu(false);
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

  const validateChannels = (): string[] => {
    const errors: string[] = [];
    for (const channel of channels) {
      if (!channel.enabled) continue;
      const typeDef = channelTypes.find(t => t.type === channel.type);
      if (!typeDef) continue;
      for (const field of typeDef.configFields) {
        if (!channel.config[field.key]?.trim()) {
          errors.push(`${typeDef.label}: ${field.label} is required`);
        }
      }
    }
    return errors;
  };

  const handleSave = async () => {
    if (isDraftMode || !personaId) return;
    const errors = validateChannels();
    setValidationErrors(errors);
    if (errors.length > 0) return;

    setIsSaving(true);
    try {
      await updatePersona(personaId, {
        notification_channels: JSON.stringify(effectiveChannels),
      });
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to save notification channels:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Get matching credentials for a channel type
  const getMatchingCredentials = (type: string) => {
    const connectorName = type === 'email' ? 'gmail' : type;
    const connector = connectorDefinitions.find(c => c.name === connectorName);
    if (!connector) return credentials;
    return credentials.filter(c => c.service_type === connectorName);
  };

  const existingTypes = new Set(effectiveChannels.map(c => c.type));

  return (
    <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider flex items-center gap-2">
          <Bell className="w-4 h-4" />
          Notification Channels
        </h3>
      </div>

      <div className="space-y-3">
        {/* In-App (always present, read-only) */}
        <div className="flex items-center gap-3 p-2.5 bg-secondary/30 border border-primary/15 rounded-xl">
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
          const matchingCreds = getMatchingCredentials(channel.type);

          return (
            <div
              key={`${channel.type}_${index}`}
              className={`border rounded-xl p-2.5 space-y-2 transition-colors ${
                channel.enabled ? 'bg-secondary/30 border-primary/15' : 'bg-secondary/10 border-primary/15 opacity-60'
              }`}
            >
              {/* Header row */}
              <div className="flex items-center gap-3">
                {channelIcon(channel.type)}
                <span className="text-sm font-medium text-foreground/80 flex-1 capitalize">{channel.type}</span>

                {/* Enable/disable toggle */}
                <AccessibleToggle
                  checked={channel.enabled}
                  onChange={() => handleToggleEnabled(index)}
                  label={`Enable ${channel.type} notifications`}
                  size="sm"
                />

                {/* Delete */}
                <button
                  onClick={() => handleRemoveChannel(index)}
                  className="p-1 text-muted-foreground/80 hover:text-red-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Config fields */}
              {typeDef?.configFields.map((field) => {
                const isEmpty = channel.enabled && validationErrors.length > 0 && !channel.config[field.key]?.trim();
                return (
                <div key={field.key}>
                  <label className="block text-sm font-mono text-muted-foreground/80 uppercase mb-1">{field.label}</label>
                  <input
                    type="text"
                    value={channel.config[field.key] || ''}
                    onChange={(e) => handleConfigChange(index, field.key, e.target.value)}
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
                  credentials={matchingCreds}
                  selectedId={channel.credential_id}
                  onChange={(id) => handleCredentialChange(index, id)}
                />
                {channel.credential_id ? (
                  <span className="text-sm text-emerald-400/70 mt-0.5 block">Connected</span>
                ) : (
                  <span className="text-sm text-amber-400/70 mt-0.5 block">Credential needed</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Add channel button */}
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            aria-expanded={showAddMenu}
            aria-haspopup="listbox"
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-primary/15 hover:border-primary/40 text-sm text-muted-foreground/80 hover:text-primary/80 transition-all w-full"
          >
            <Plus className="w-4 h-4" />
            Add Channel
            <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${showAddMenu ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {showAddMenu && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute top-full mt-1 left-0 right-0 bg-background border border-primary/15 rounded-xl shadow-lg z-10 overflow-hidden"
                role="listbox"
                aria-label="Add notification channel"
              >
                {channelTypes
                  .filter(t => !existingTypes.has(t.type))
                  .map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.type}
                        onClick={() => handleAddChannel(t.type)}
                        role="option"
                        aria-selected={false}
                        className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-secondary/50 text-sm text-foreground/80 transition-colors"
                      >
                        <Icon className="w-4 h-4 text-muted-foreground/90" />
                        {t.label}
                      </button>
                    );
                  })}
                {channelTypes.filter(t => !existingTypes.has(t.type)).length === 0 && (
                  <div className="px-4 py-2.5 text-sm text-muted-foreground/90">All channel types added</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="space-y-1">
            {validationErrors.map((err, i) => (
              <p key={i} className="text-sm text-red-400">{err}</p>
            ))}
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
