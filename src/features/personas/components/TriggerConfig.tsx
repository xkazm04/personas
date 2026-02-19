import { useState, useEffect, useRef, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Plus, Trash2, ToggleLeft, ToggleRight, Zap, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, parseTriggerConfig } from '@/lib/utils/triggerConstants';
import { formatInterval } from '@/lib/utils/formatters';

export function TriggerConfig() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const credentialEvents = usePersonaStore((s) => s.credentialEvents);
  const fetchCredentialEvents = usePersonaStore((s) => s.fetchCredentialEvents);
  const createTrigger = usePersonaStore((state) => state.createTrigger);
  const updateTrigger = usePersonaStore((state) => state.updateTrigger);
  const deleteTrigger = usePersonaStore((state) => state.deleteTrigger);

  const [showAddForm, setShowAddForm] = useState(false);
  const [triggerType, setTriggerType] = useState<string>('manual');
  const [interval, setInterval] = useState('3600');
  const [customInterval, setCustomInterval] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [hmacSecret, setHmacSecret] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startDeleteConfirm = useCallback((triggerId: string) => {
    setConfirmingDeleteId(triggerId);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmingDeleteId(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  // Derive a simple event list from credentialEvents
  const credentialEventsList = credentialEvents.map((e) => ({ id: e.id, name: e.name }));

  useEffect(() => {
    fetchCredentialEvents();
  }, [fetchCredentialEvents]);

  const personaId = selectedPersona?.id || '';
  const triggers = selectedPersona?.triggers || [];

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/40">
        No persona selected
      </div>
    );
  }

  const handleAddTrigger = async () => {
    const config: Record<string, unknown> = {};
    if (triggerType === 'schedule' || triggerType === 'polling') {
      const parsed = parseInt(interval);
      if (isNaN(parsed) || parsed < 60) {
        setValidationError('Interval must be at least 60 seconds.');
        return;
      }
      setValidationError(null);
      config.interval_seconds = parsed;
      if (triggerType === 'polling') {
        if (selectedEventId) {
          config.event_id = selectedEventId;
        } else {
          config.endpoint = endpoint;
        }
      }
    } else if (triggerType === 'webhook') {
      if (hmacSecret) {
        config.hmac_secret = hmacSecret;
      }
    }

    await createTrigger(personaId, {
      trigger_type: triggerType,
      config,
      enabled: true,
    });

    setShowAddForm(false);
    setInterval('3600');
    setCustomInterval(false);
    setEndpoint('');
    setSelectedEventId('');
    setHmacSecret('');
  };

  const handleToggleEnabled = async (triggerId: string, currentEnabled: boolean) => {
    await updateTrigger(personaId, triggerId, { enabled: !currentEnabled });
  };

  const handleDelete = async (triggerId: string) => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDeleteId(null);
    await deleteTrigger(personaId, triggerId);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">Triggers</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-medium transition-all shadow-lg shadow-primary/20"
        >
          <Plus className="w-4 h-4" />
          Add Trigger
        </button>
      </div>

      {/* Add Trigger Form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl p-4 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                Trigger Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { type: 'manual', label: 'Manual', description: 'Run on demand' },
                  { type: 'schedule', label: 'Schedule', description: 'Run on a timer' },
                  { type: 'polling', label: 'Polling', description: 'Check an endpoint' },
                  { type: 'webhook', label: 'Webhook', description: 'Listen for events' },
                ] as const).map((option) => {
                  const meta = TRIGGER_TYPE_META[option.type] || DEFAULT_TRIGGER_META;
                  const Icon = meta.Icon;
                  const colorClass = meta.color;
                  const isSelected = triggerType === option.type;

                  return (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => setTriggerType(option.type)}
                      className={`flex flex-col gap-2 p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
                          : 'border-primary/15 bg-background/50 hover:border-primary/25 hover:bg-secondary/30'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${colorClass}`} />
                        <span className={`text-sm font-medium ${isSelected ? 'text-foreground/90' : 'text-foreground/70'}`}>
                          {option.label}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground/50">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {(triggerType === 'schedule' || triggerType === 'polling') && (
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                  Interval
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {([
                    { label: '1 min', value: '60' },
                    { label: '5 min', value: '300' },
                    { label: '15 min', value: '900' },
                    { label: '1 hour', value: '3600' },
                    { label: '6 hours', value: '21600' },
                    { label: '24 hours', value: '86400' },
                  ] as const).map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => { setInterval(preset.value); setCustomInterval(false); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        !customInterval && interval === preset.value
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-secondary/30 text-muted-foreground/60 border-border/30 hover:text-muted-foreground hover:bg-secondary/50'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomInterval(true)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      customInterval
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-secondary/30 text-muted-foreground/60 border-border/30 hover:text-muted-foreground hover:bg-secondary/50'
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {customInterval ? (
                  <>
                    <input
                      type="number"
                      value={interval}
                      onChange={(e) => {
                        setInterval(e.target.value);
                        if (validationError) setValidationError(null);
                      }}
                      min="60"
                      placeholder="Seconds (min 60)"
                      className={`w-full px-3 py-2 bg-background/50 border rounded-xl text-foreground font-mono text-sm focus:outline-none focus:ring-2 transition-all ${
                        validationError
                          ? 'border-red-500/30 ring-1 ring-red-500/30 focus:ring-red-500/40 focus:border-red-500/40'
                          : 'border-primary/15 focus:ring-primary/40 focus:border-primary/40'
                      }`}
                    />
                    {validationError && (
                      <p className="text-xs text-red-400/80 mt-1">{validationError}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground/40">
                    Every {formatInterval(parseInt(interval) || 3600)}
                  </p>
                )}
              </div>
            )}

            {triggerType === 'polling' && (
              <>
                {credentialEventsList.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                      <Zap className="w-3.5 h-3.5 inline mr-1 text-amber-400" />
                      Credential Event (optional)
                    </label>
                    <select
                      value={selectedEventId}
                      onChange={(e) => setSelectedEventId(e.target.value)}
                      className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                    >
                      <option value="">None - use endpoint URL instead</option>
                      {credentialEventsList.map(evt => (
                        <option key={evt.id} value={evt.id}>{evt.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground/40 mt-1">Link to a credential event instead of a custom endpoint</p>
                  </div>
                )}
                {!selectedEventId && (
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                      Endpoint URL
                    </label>
                    <input
                      type="text"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="https://api.example.com/poll"
                      className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                    />
                  </div>
                )}
              </>
            )}

            {triggerType === 'webhook' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                    HMAC Secret (optional)
                  </label>
                  <input
                    type="text"
                    value={hmacSecret}
                    onChange={(e) => setHmacSecret(e.target.value)}
                    placeholder="Leave empty for no signature verification"
                    className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground/40 mt-1">If set, incoming webhooks must include x-hub-signature-256 header</p>
                </div>
                <div className="p-3 bg-background/30 rounded-xl border border-primary/10">
                  <p className="text-xs text-muted-foreground/50">Webhook URL will be generated after creation</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTrigger}
                className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-medium transition-all shadow-lg shadow-primary/20"
              >
                Create Trigger
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trigger List */}
      <div className="space-y-2">
        {triggers.map((trigger: DbPersonaTrigger) => {
          const meta = TRIGGER_TYPE_META[trigger.trigger_type] || DEFAULT_TRIGGER_META;
          const Icon = meta.Icon;
          const colorClass = meta.color;

          return (
            <motion.div
              key={trigger.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-3 bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <Icon className={`w-5 h-5 mt-0.5 ${colorClass}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium capitalize ${colorClass}`}>
                        {trigger.trigger_type}
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-md font-mono ${
                        trigger.enabled
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                          : 'bg-secondary/60 text-muted-foreground/40 border border-primary/10'
                      }`}>
                        {trigger.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>

                    {trigger.config && (() => {
                      const config = parseTriggerConfig(trigger.config);
                      return (Object.keys(config).length > 0 || trigger.trigger_type === 'webhook') ? (
                        <div className="mt-2 text-xs text-muted-foreground/50 space-y-1">
                          {config.interval_seconds && (
                            <div>Interval: {formatInterval(Number(config.interval_seconds))}</div>
                          )}
                          {config.event_id && (
                            <div className="flex items-center gap-1">
                              <Zap className="w-3 h-3 text-amber-400/60" />
                              Event: {credentialEventsList.find(e => e.id === config.event_id)?.name || config.event_id}
                            </div>
                          )}
                          {config.endpoint && (
                            <div className="truncate">Endpoint: {config.endpoint}</div>
                          )}
                          {trigger.trigger_type === 'webhook' && (
                            <div className="mt-2 space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground/50 font-mono truncate flex-1">
                                  Webhook endpoint (desktop)
                                </span>
                              </div>
                              {config.hmac_secret && (
                                <div className="text-xs text-muted-foreground/40">
                                  HMAC: {'--------'}{String(config.hmac_secret).slice(-4)}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleToggleEnabled(trigger.id, trigger.enabled)}
                    className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors"
                    title={trigger.enabled ? 'Disable' : 'Enable'}
                  >
                    {trigger.enabled ? (
                      <ToggleRight className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-muted-foreground/40" />
                    )}
                  </button>
                  {confirmingDeleteId === trigger.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(trigger.id)}
                        className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors"
                        title="Confirm delete"
                      >
                        <Check className="w-4 h-4 text-red-400" />
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(null)}
                        className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4 text-muted-foreground/50" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startDeleteConfirm(trigger.id)}
                      className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Delete trigger"
                    >
                      <Trash2 className="w-4 h-4 text-red-400/70" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}

        {triggers.length === 0 && (
          <div className="text-center py-10 text-muted-foreground/40 text-sm">
            No triggers configured. Add one to automate this persona.
          </div>
        )}
      </div>
    </div>
  );
}
