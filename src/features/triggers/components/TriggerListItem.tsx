import { useState } from 'react';
import { Trash2, ToggleLeft, ToggleRight, Zap, X, Check, Copy, CheckCircle2, Play, Loader2, Terminal, ChevronDown, ChevronRight, History } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, parseTriggerConfig } from '@/lib/utils/triggerConstants';
import { formatInterval, formatDuration, formatRelativeTime, EXECUTION_STATUS_COLORS, badgeClass } from '@/lib/utils/formatters';

export interface TriggerListItemProps {
  trigger: DbPersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  confirmingDeleteId: string | null;
  copiedTriggerId: string | null;
  testingTriggerId: string | null;
  testResult: { triggerId: string; success: boolean; message: string } | null;
  copiedCurlId: string | null;
  activityTriggerId: string | null;
  activityLog: PersonaExecution[];
  activityLoading: boolean;
  onToggleEnabled: (triggerId: string, currentEnabled: boolean) => void;
  onStartDeleteConfirm: (triggerId: string) => void;
  onConfirmDelete: (triggerId: string) => void;
  onCancelDelete: () => void;
  onTestFire: (triggerId: string, triggerPersonaId: string) => void;
  onCopyWebhookUrl: (triggerId: string, e: React.MouseEvent) => void;
  onCopyCurlCommand: (triggerId: string, e: React.MouseEvent) => void;
  onToggleActivityLog: (triggerId: string, personaId: string) => void;
  getWebhookUrl: (triggerId: string) => string;
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
    <span className="text-[11px] text-muted-foreground/35 truncate">
      {parts.join(' · ')}
    </span>
  );
}

export function TriggerListItem({
  trigger,
  credentialEventsList,
  confirmingDeleteId,
  copiedTriggerId,
  testingTriggerId,
  testResult,
  copiedCurlId,
  activityTriggerId,
  activityLog,
  activityLoading,
  onToggleEnabled,
  onStartDeleteConfirm,
  onConfirmDelete,
  onCancelDelete,
  onTestFire,
  onCopyWebhookUrl,
  onCopyCurlCommand,
  onToggleActivityLog,
  getWebhookUrl,
}: TriggerListItemProps) {
  const [expanded, setExpanded] = useState(false);

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
              <ToggleLeft className="w-5 h-5 text-muted-foreground/40" />
            )}
          </span>

          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`} />
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
                  <div className="text-xs text-muted-foreground/50 space-y-1">
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
                            <span className="text-[11px] text-muted-foreground/70 font-mono break-all">
                              {getWebhookUrl(trigger.id)}
                            </span>
                          </div>
                          <button
                            onClick={(e) => onCopyWebhookUrl(trigger.id, e)}
                            className={`flex-shrink-0 p-1.5 rounded-lg transition-all ${
                              copiedTriggerId === trigger.id
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'hover:bg-secondary/60 text-muted-foreground/50 hover:text-muted-foreground/80'
                            }`}
                            title="Copy webhook URL"
                          >
                            {copiedTriggerId === trigger.id ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
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

              {/* Test Result */}
              {testResult && testResult.triggerId === trigger.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono ${
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
                  onClick={(e) => onCopyCurlCommand(trigger.id, e)}
                  className={`inline-flex items-center gap-1.5 text-[11px] transition-colors ${
                    copiedCurlId === trigger.id
                      ? 'text-emerald-400'
                      : 'text-muted-foreground/40 hover:text-muted-foreground/70'
                  }`}
                >
                  <Terminal className="w-3 h-3" />
                  {copiedCurlId === trigger.id ? 'Copied!' : 'Copy sample curl'}
                </button>
              )}

              {/* Actions row */}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  onClick={() => onTestFire(trigger.id, trigger.persona_id)}
                  disabled={testingTriggerId === trigger.id}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-primary/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                  title="Test fire this trigger"
                >
                  {testingTriggerId === trigger.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  Test fire
                </button>

                <div className="flex-1" />

                {confirmingDeleteId === trigger.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onConfirmDelete(trigger.id)}
                      className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors"
                      title="Confirm delete"
                    >
                      <Check className="w-3.5 h-3.5 text-red-400" />
                    </button>
                    <button
                      onClick={onCancelDelete}
                      className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors"
                      title="Cancel"
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground/50" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onStartDeleteConfirm(trigger.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Delete trigger"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>

              {/* Activity Log Toggle */}
              <button
                onClick={() => onToggleActivityLog(trigger.id, trigger.persona_id)}
                className="flex items-center gap-1.5 pt-1 border-t border-primary/5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors w-full"
              >
                {activityTriggerId === trigger.id ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <History className="w-3 h-3" />
                Activity log
              </button>

              {/* Activity Log Content */}
              <AnimatePresence>
                {activityTriggerId === trigger.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1">
                      {activityLoading ? (
                        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground/30">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Loading...
                        </div>
                      ) : activityLog.length === 0 ? (
                        <div className="py-2 text-xs text-muted-foreground/30">
                          No runs recorded for this trigger yet
                        </div>
                      ) : (
                        activityLog.map((exec) => (
                          <div
                            key={exec.id}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-background/30 border border-primary/5 text-xs"
                          >
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${EXECUTION_STATUS_COLORS[exec.status] ? badgeClass(EXECUTION_STATUS_COLORS[exec.status]!) : ''}`}>
                              {exec.status}
                            </span>
                            <span className="text-muted-foreground/50 font-mono">
                              {formatDuration(exec.duration_ms)}
                            </span>
                            <span className="text-muted-foreground/30 ml-auto">
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
