import { useState, useRef } from 'react';
import { Zap, Eye, EyeOff, Copy, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META } from '@/lib/utils/triggerConstants';
import { formatInterval } from '@/lib/utils/formatters';

export interface TriggerAddFormProps {
  credentialEventsList: { id: string; name: string }[];
  onCreateTrigger: (triggerType: string, config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function TriggerAddForm({ credentialEventsList, onCreateTrigger, onCancel }: TriggerAddFormProps) {
  const [triggerType, setTriggerType] = useState<string>('manual');
  const [interval, setInterval] = useState('3600');
  const [customInterval, setCustomInterval] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [hmacSecret, setHmacSecret] = useState('');
  const [showHmacSecret, setShowHmacSecret] = useState(false);
  const [copiedHmac, setCopiedHmac] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const triggerTypeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const copyHmacSecret = async () => {
    if (!hmacSecret) return;
    try {
      await navigator.clipboard.writeText(hmacSecret);
      setCopiedHmac(true);
      setTimeout(() => setCopiedHmac(false), 2000);
    } catch {
      // Fallback for clipboard API failures
    }
  };

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

    await onCreateTrigger(triggerType, config);
  };

  return (
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
        <div
          className="grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-label="Trigger type"
        >
          {([
            { type: 'manual', label: 'Manual', description: 'Run on demand' },
            { type: 'schedule', label: 'Schedule', description: 'Run on a timer' },
            { type: 'polling', label: 'Polling', description: 'Check an endpoint' },
            { type: 'webhook', label: 'Webhook', description: 'Listen for events' },
          ] as const).map((option, index) => {
            const meta = TRIGGER_TYPE_META[option.type] || DEFAULT_TRIGGER_META;
            const Icon = meta.Icon;
            const colorClass = meta.color;
            const isSelected = triggerType === option.type;

            return (
              <button
                key={option.type}
                ref={(el) => { triggerTypeRefs.current[index] = el; }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setTriggerType(option.type)}
                onKeyDown={(e) => {
                  const types = ['manual', 'schedule', 'polling', 'webhook'] as const;
                  let nextIndex = -1;
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    nextIndex = (index + 1) % types.length;
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    nextIndex = (index - 1 + types.length) % types.length;
                  }
                  if (nextIndex >= 0) {
                    setTriggerType(types[nextIndex]!);
                    triggerTypeRefs.current[nextIndex]?.focus();
                  }
                }}
                className={`flex flex-col gap-2 p-3 rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
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
          {customInterval && (
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
              {!validationError && (() => {
                const secs = parseInt(interval) || 0;
                if (secs < 60) return null;
                return (
                  <p className="text-xs text-primary/60 mt-1">Every {formatInterval(secs)}</p>
                );
              })()}
            </>
          )}
          {(() => {
            const secs = parseInt(interval) || 0;
            if (secs < 60) return null;
            const runsPerDay = Math.floor(86400 / secs);
            return (
              <p className="text-xs text-muted-foreground/50 mt-1.5">
                This persona will {triggerType === 'polling' ? 'poll' : 'run'} every{' '}
                <span className="text-foreground/60 font-medium">{formatInterval(secs)}</span>
                , starting from when you enable it.{' '}
                <span className="text-muted-foreground/40">
                  Approximately {runsPerDay.toLocaleString()} run{runsPerDay !== 1 ? 's' : ''} per day.
                </span>
              </p>
            );
          })()}
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
            <div className="relative flex items-center gap-1.5">
              <div className="relative flex-1">
                <input
                  type={showHmacSecret ? 'text' : 'password'}
                  value={hmacSecret}
                  onChange={(e) => setHmacSecret(e.target.value)}
                  placeholder="Leave empty for no signature verification"
                  className={`w-full px-3 py-2 pr-10 bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all ${showHmacSecret ? 'font-mono text-xs' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowHmacSecret(!showHmacSecret)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
                  title={showHmacSecret ? 'Hide secret' : 'Show secret'}
                >
                  {showHmacSecret ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {hmacSecret && (
                <button
                  type="button"
                  onClick={copyHmacSecret}
                  className={`flex-shrink-0 p-2 rounded-xl border transition-all ${
                    copiedHmac
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                      : 'bg-background/50 border-primary/15 text-muted-foreground/50 hover:text-foreground/70 hover:border-primary/30'
                  }`}
                  title={copiedHmac ? 'Copied!' : 'Copy secret'}
                >
                  {copiedHmac ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground/40 mt-1">If set, incoming webhooks must include x-hub-signature-256 header</p>
          </div>
          <div className="p-3 bg-background/30 rounded-xl border border-primary/10">
            <p className="text-xs text-muted-foreground/50">A unique webhook URL will be shown after creation with a copy button</p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-xs transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAddTrigger}
          className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-xs font-medium transition-all shadow-lg shadow-primary/20"
        >
          Create Trigger
        </button>
      </div>
    </motion.div>
  );
}
