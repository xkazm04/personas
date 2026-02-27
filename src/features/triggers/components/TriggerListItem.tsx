import { useState, useCallback, useRef, useEffect } from 'react';
import { Trash2, ToggleLeft, ToggleRight, Zap, X, Check, Copy, CheckCircle2, Play, Loader2, Terminal, ChevronDown, ChevronRight, History } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '@/api/tauriApi';
import type { DbPersonaTrigger } from '@/lib/types/types';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, parseTriggerConfig } from '@/lib/utils/triggerConstants';
import { formatInterval, formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';

export interface TriggerListItemProps {
  trigger: DbPersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  onToggleEnabled: (triggerId: string, currentEnabled: boolean) => void;
  onDelete: (triggerId: string) => void;
}

/** Brief config summary shown in collapsed state */
function ConfigSummary({ trigger }: { trigger: DbPersonaTrigger }) {
  const config = parseTriggerConfig(trigger.config);
  const parts: string[] = [];

  if (config.interval_seconds) {
    parts.push(`every ${formatInterval(Number(config.interval_seconds))}`);
  }
  if (config.endpoint) {
    // Show just the hostname
    try {
      const url = new URL(String(config.endpoint));
      parts.push(url.hostname);
    } catch {
      parts.push('custom endpoint');
    }
  }
  if (trigger.trigger_type === 'webhook') {
    parts.push('webhook listener');
  }

  if (parts.length === 0) return null;
  return (
    <span className="text-sm text-muted-foreground/35 truncate">
      {parts.join(' · ')}
    </span>
  );
}

function getWebhookUrl(triggerId: string) {
  return `http://localhost:9420/webhook/${triggerId}`;
}

function getCurlCommand(triggerId: string) {
  const url = getWebhookUrl(triggerId);
  return `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '{"test": true}'`;
}

export function TriggerListItem({
  trigger,
  credentialEventsList,
  onToggleEnabled,
  onDelete,
}: TriggerListItemProps) {
  const [expanded, setExpanded] = useState(false);

  // -- Interaction state (previously in parent) --
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLog, setActivityLog] = useState<PersonaExecution[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const startDeleteConfirm = useCallback(() => {
    setConfirmingDelete(true);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
  }, []);

  const confirmDelete = useCallback(() => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDelete(false);
    onDelete(trigger.id);
  }, [onDelete, trigger.id]);

  const cancelDelete = useCallback(() => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDelete(false);
  }, []);

  const copyWebhookUrl = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getWebhookUrl(trigger.id));
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Fallback for clipboard API failures
    }
  }, [trigger.id]);

  const copyCurlCommand = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getCurlCommand(trigger.id));
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2000);
    } catch {
      // Fallback for clipboard API failures
    }
  }, [trigger.id]);

  const handleTestFire = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const validation = await api.validateTrigger(trigger.id);
      if (!validation.valid) {
        const failedChecks = validation.checks
          .filter((c) => !c.passed)
          .map((c) => `${c.label}: ${c.message}`)
          .join('; ');
        setTestResult({ success: false, message: `Validation failed — ${failedChecks}` });
        setTesting(false);
        setTimeout(() => setTestResult(null), 8000);
        return;
      }
      const execution = await api.executePersona(trigger.persona_id, trigger.id);
      setTestResult({ success: true, message: `Config OK. Execution ${execution.id.slice(0, 8)} started` });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Failed to fire trigger' });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 8000);
    }
  }, [trigger.id, trigger.persona_id]);

  const toggleActivityLog = useCallback(async () => {
    if (activityOpen) {
      setActivityOpen(false);
      return;
    }
    setActivityOpen(true);
    setActivityLoading(true);
    try {
      const execs = await api.listExecutions(trigger.persona_id, 50);
      const filtered = execs
        .filter((e) => e.trigger_id === trigger.id)
        .slice(0, 10);
      setActivityLog(filtered);
    } catch {
      setActivityLog([]);
    } finally {
      setActivityLoading(false);
    }
  }, [activityOpen, trigger.id, trigger.persona_id]);

  const meta = TRIGGER_TYPE_META[trigger.trigger_type] || DEFAULT_TRIGGER_META;
  const Icon = meta.Icon;
  const colorClass = meta.color;

  return (
    <motion.div
      key={trigger.id}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl transition-colors hover:border-primary/25"
    >
      {/* ── Collapsed row: always visible ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2.5 w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-2xl"
      >
        <Icon className={`w-4 h-4 flex-shrink-0 ${colorClass}`} />

        <span className={`text-sm font-medium capitalize ${colorClass}`}>
          {trigger.trigger_type}
        </span>

        <ConfigSummary trigger={trigger} />

        <span className="ml-auto flex items-center gap-2">
          {/* Enabled toggle (stop propagation so it doesn't toggle expand) */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onToggleEnabled(trigger.id, trigger.enabled); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleEnabled(trigger.id, trigger.enabled); } }}
            className="p-0.5 hover:bg-secondary/60 rounded-lg transition-colors"
            title={trigger.enabled ? 'Disable' : 'Enable'}
          >
            {trigger.enabled ? (
              <ToggleRight className="w-5 h-5 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-muted-foreground/80" />
            )}
          </span>

          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/80 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`} />
        </span>
      </button>

      {/* ── Expanded details: config + actions ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">
              {/* Divider */}
              <div className="border-t border-primary/8" />

              {/* Config details */}
              {(trigger.config || trigger.trigger_type === 'webhook') && (() => {
                const config = parseTriggerConfig(trigger.config);
                return (Object.keys(config).length > 0 || trigger.trigger_type === 'webhook') ? (
                  <div className="text-sm text-muted-foreground/90 space-y-1">
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
                        <div className="flex items-center gap-1.5">
                          <div
                            className="flex-1 min-w-0 px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-lg cursor-text select-all"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-sm text-muted-foreground/90 font-mono break-all">
                              {getWebhookUrl(trigger.id)}
                            </span>
                          </div>
                          <button
                            onClick={copyWebhookUrl}
                            className={`flex-shrink-0 p-1.5 rounded-lg transition-all ${
                              copiedUrl
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'hover:bg-secondary/60 text-muted-foreground/90 hover:text-muted-foreground'
                            }`}
                            title="Copy webhook URL"
                          >
                            {copiedUrl ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        {config.webhook_secret && (
                          <div className="text-sm text-muted-foreground/80">
                            HMAC: {'--------'}{String(config.webhook_secret).slice(-4)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null;
              })()}

              {/* Test Result */}
              {testResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className={`px-2.5 py-1.5 rounded-lg text-sm font-mono ${
                    testResult.success
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'
                      : 'bg-red-500/10 text-red-400 border border-red-500/15'
                  }`}
                >
                  {testResult.success ? '\u2713' : '\u2717'} {testResult.message}
                </motion.div>
              )}

              {/* Curl command for webhooks */}
              {trigger.trigger_type === 'webhook' && (
                <button
                  onClick={copyCurlCommand}
                  className={`inline-flex items-center gap-1.5 text-sm transition-colors ${
                    copiedCurl
                      ? 'text-emerald-400'
                      : 'text-muted-foreground/80 hover:text-muted-foreground'
                  }`}
                >
                  <Terminal className="w-3 h-3" />
                  {copiedCurl ? 'Copied!' : 'Copy sample curl'}
                </button>
              )}

              {/* Actions row */}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  onClick={handleTestFire}
                  disabled={testing}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-primary/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                  title="Validate trigger config, then fire"
                >
                  {testing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {testing ? 'Validating...' : 'Test fire'}
                </button>

                <div className="flex-1" />

                {confirmingDelete ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={confirmDelete}
                      className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors"
                      title="Confirm delete"
                    >
                      <Check className="w-3.5 h-3.5 text-red-400" />
                    </button>
                    <button
                      onClick={cancelDelete}
                      className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors"
                      title="Cancel"
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground/90" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={startDeleteConfirm}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Delete trigger"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>

              {/* Activity Log Toggle */}
              <button
                onClick={toggleActivityLog}
                className="flex items-center gap-1.5 pt-1 border-t border-primary/5 text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors w-full"
              >
                {activityOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <History className="w-3 h-3" />
                Activity log
              </button>

              {/* Activity Log Content */}
              <AnimatePresence>
                {activityOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1">
                      {activityLoading ? (
                        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground/80">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Loading...
                        </div>
                      ) : activityLog.length === 0 ? (
                        <div className="py-2 text-sm text-muted-foreground/80">
                          No runs recorded for this trigger yet
                        </div>
                      ) : (
                        activityLog.map((exec) => (
                          <div
                            key={exec.id}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-background/30 border border-primary/5 text-sm"
                          >
                            <span className={`px-1.5 py-0.5 rounded text-sm font-medium ${badgeClass(getStatusEntry(exec.status))}`}>
                              {getStatusEntry(exec.status).label}
                            </span>
                            <span className="text-muted-foreground/90 font-mono">
                              {formatDuration(exec.duration_ms)}
                            </span>
                            <span className="text-muted-foreground/80 ml-auto">
                              {formatRelativeTime(exec.started_at)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
