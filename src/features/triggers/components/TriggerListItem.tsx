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

            {(trigger.config || trigger.trigger_type === 'webhook') && (() => {
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
                className={`mt-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono ${
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
              <div className="mt-2">
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
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onTestFire(trigger.id, trigger.persona_id)}
            disabled={testingTriggerId === trigger.id}
            className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
            title="Test fire this trigger"
          >
            {testingTriggerId === trigger.id ? (
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            ) : (
              <Play className="w-4 h-4 text-primary/70" />
            )}
          </button>
          <button
            onClick={() => onToggleEnabled(trigger.id, trigger.enabled)}
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
                onClick={() => onConfirmDelete(trigger.id)}
                className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors"
                title="Confirm delete"
              >
                <Check className="w-4 h-4 text-red-400" />
              </button>
              <button
                onClick={onCancelDelete}
                className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors"
                title="Cancel"
              >
                <X className="w-4 h-4 text-muted-foreground/50" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onStartDeleteConfirm(trigger.id)}
              className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Delete trigger"
            >
              <Trash2 className="w-4 h-4 text-red-400/70" />
            </button>
          )}
        </div>
      </div>

      {/* Activity Log Toggle */}
      <button
        onClick={() => onToggleActivityLog(trigger.id, trigger.persona_id)}
        className="flex items-center gap-1.5 mt-2 pt-2 border-t border-primary/5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors w-full"
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
            <div className="mt-2 space-y-1">
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
    </motion.div>
  );
}
