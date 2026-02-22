import { useState, useRef, useMemo } from 'react';
import { Zap, Eye, EyeOff, Copy, CheckCircle2, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META } from '@/lib/utils/triggerConstants';
import { formatInterval } from '@/lib/utils/formatters';

/** Compute the next N scheduled run times starting from now */
function computeNextRuns(intervalSeconds: number, count: number): Date[] {
  const now = new Date();
  const runs: Date[] = [];
  for (let i = 1; i <= count; i++) {
    runs.push(new Date(now.getTime() + intervalSeconds * 1000 * i));
  }
  return runs;
}

/** Format a date as a short wall-clock time like "3:45 PM" or "Tomorrow 9:00 AM" */
function formatRunTime(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isToday) return time;
  if (isTomorrow) return `Tomorrow ${time}`;
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` ${time}`;
}

function SchedulePreview({ intervalSeconds, triggerType }: { intervalSeconds: number; triggerType: string }) {
  const runs = useMemo(() => computeNextRuns(intervalSeconds, 5), [intervalSeconds]);
  const firstRun = runs[0];
  const lastRun = runs[runs.length - 1];
  if (!firstRun || !lastRun) return null;

  // Timeline spans from now to last run
  const now = Date.now();
  const totalSpan = lastRun.getTime() - now;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-3 p-3 rounded-xl bg-primary/5 border border-primary/10"
    >
      {/* Human-readable summary */}
      <div className="flex items-center gap-2 mb-2.5">
        <Clock className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
        <p className="text-sm text-foreground/90">
          First {triggerType === 'polling' ? 'poll' : 'run'}:{' '}
          <span className="font-medium text-foreground/90">{formatRunTime(firstRun)}</span>
          , then every{' '}
          <span className="font-medium text-foreground/90">{formatInterval(intervalSeconds)}</span>
        </p>
      </div>

      {/* Mini timeline */}
      <div className="relative h-6 mx-1">
        {/* Track */}
        <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/15 -translate-y-1/2" />

        {/* "Now" marker */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
          <span className="text-sm text-muted-foreground/80 mt-1.5 absolute top-full whitespace-nowrap">now</span>
        </div>

        {/* Run dots */}
        {runs.map((run, i) => {
          const pct = ((run.getTime() - now) / totalSpan) * 100;
          return (
            <motion.div
              key={i}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.06, type: 'spring', stiffness: 500, damping: 25 }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center group"
              style={{ left: `${pct}%` }}
            >
              <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-primary' : 'bg-primary/40'} ring-2 ring-primary/10`} />
              <span className={`text-sm mt-1.5 absolute top-full whitespace-nowrap ${
                i === 0 ? 'text-primary/70 font-medium' : 'text-muted-foreground/80 opacity-0 group-hover:opacity-100 transition-opacity'
              }`}>
                {formatRunTime(run)}
              </span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

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
                  <span className={`text-sm font-medium ${isSelected ? 'text-foreground/90' : 'text-foreground/90'}`}>
                    {option.label}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground/90">
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
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                  !customInterval && interval === preset.value
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary/30 text-muted-foreground/80 border-border/30 hover:text-muted-foreground hover:bg-secondary/50'
                }`}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomInterval(true)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                customInterval
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-secondary/30 text-muted-foreground/80 border-border/30 hover:text-muted-foreground hover:bg-secondary/50'
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
                <p className="text-sm text-red-400/80 mt-1">{validationError}</p>
              )}
              {!validationError && (() => {
                const secs = parseInt(interval) || 0;
                if (secs < 60) return null;
                return (
                  <p className="text-sm text-primary/60 mt-1">Every {formatInterval(secs)}</p>
                );
              })()}
            </>
          )}
          {(() => {
            const secs = parseInt(interval) || 0;
            if (secs < 60) return null;
            const runsPerDay = Math.floor(86400 / secs);
            return (
              <>
                <p className="text-sm text-muted-foreground/90 mt-1.5">
                  This persona will {triggerType === 'polling' ? 'poll' : 'run'} every{' '}
                  <span className="text-foreground/80 font-medium">{formatInterval(secs)}</span>
                  , starting from when you enable it.{' '}
                  <span className="text-muted-foreground/80">
                    Approximately {runsPerDay.toLocaleString()} run{runsPerDay !== 1 ? 's' : ''} per day.
                  </span>
                </p>
                <SchedulePreview intervalSeconds={secs} triggerType={triggerType} />
              </>
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
              <p className="text-sm text-muted-foreground/80 mt-1">Link to a credential event instead of a custom endpoint</p>
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
                  className={`w-full px-3 py-2 pr-10 bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all ${showHmacSecret ? 'font-mono text-sm' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowHmacSecret(!showHmacSecret)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/90 hover:text-foreground/95 transition-colors"
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
                      : 'bg-background/50 border-primary/15 text-muted-foreground/90 hover:text-foreground/95 hover:border-primary/30'
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
            <p className="text-sm text-muted-foreground/80 mt-1">If set, incoming webhooks must include x-hub-signature-256 header</p>
          </div>
          <div className="p-3 bg-background/30 rounded-xl border border-primary/10">
            <p className="text-sm text-muted-foreground/90">A unique webhook URL will be shown after creation with a copy button</p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAddTrigger}
          className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20"
        >
          Create Trigger
        </button>
      </div>
    </motion.div>
  );
}
