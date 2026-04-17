import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Archive, RefreshCw, Trash2, AlertTriangle, Ban } from 'lucide-react';
import { listDeadLetterEvents, retryDeadLetterEvent, discardDeadLetterEvent } from '@/api/overview/events';
import { ConfirmDestructiveModal, useConfirmDestructive } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { useToastStore } from '@/stores/toastStore';
import type { PersonaEvent } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

/** Must match MAX_MANUAL_RETRIES in events.rs */
const MAX_MANUAL_RETRIES = 5;

export function DeadLetterTab() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<PersonaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionsInProgress, setActionsInProgress] = useState<Set<string>>(new Set());
  const startAction = useCallback((id: string) => {
    setActionsInProgress((prev) => new Set(prev).add(id));
  }, []);
  const endAction = useCallback((id: string) => {
    setActionsInProgress((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const { modal, confirm } = useConfirmDestructive();
  const addToast = useToastStore((s) => s.addToast);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDeadLetterEvents(100);
      setEvents(data);
    } catch {
      addToast('Failed to load dead letter events', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const handleRetry = async (id: string) => {
    startAction(id);
    try {
      await retryDeadLetterEvent(id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (err: unknown) {
      const kind = (err as { kind?: string })?.kind;
      if (kind === 'retry_exhausted') {
        addToast('Retry limit reached — this event cannot be retried again. Discard or investigate.', 'error');
      } else {
        addToast('Failed to retry event — please try again', 'error');
      }
    } finally {
      endAction(id);
    }
  };

  const handleDiscard = (evt: PersonaEvent) => {
    confirm({
      title: 'Discard Event',
      message: 'This dead-letter event will be permanently discarded.',
      confirmLabel: 'Discard',
      details: [
        { label: 'Type', value: evt.event_type },
        { label: 'Retries', value: String(evt.retry_count) },
      ],
      onConfirm: async () => {
        startAction(evt.id);
        try {
          await discardDeadLetterEvent(evt.id);
          setEvents((prev) => prev.filter((e) => e.id !== evt.id));
        } catch {
          addToast('Failed to discard event — please try again', 'error');
        } finally {
          endAction(evt.id);
        }
      },
    });
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-red-400" />
            <h3 className="text-sm font-semibold">{t.triggers.tab_dead_letter}</h3>
            <span className="text-xs text-foreground">
              ({events.length} event{events.length !== 1 ? 's' : ''})
            </span>
          </div>
          <button
            onClick={() => void loadEvents()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-card text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <p className="text-xs text-foreground">
          {t.triggers.dead_letter_help}
        </p>

        {loading && events.length === 0 && (
          <div className="flex items-center justify-center py-12 text-foreground text-sm">
            Loading...
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-foreground gap-2">
            <Archive className="w-8 h-8 opacity-30" />
            <p className="text-sm">{t.triggers.no_dead_letters}</p>
            <p className="text-xs opacity-70">{t.triggers.all_events_processed}</p>
          </div>
        )}

        {events.length > 0 && (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
            {events.map((evt) => (
              <motion.div
                key={evt.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0, overflow: 'hidden' }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="rounded-card border border-red-500/20 bg-red-500/5 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="text-sm font-medium truncate">{evt.event_type}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                        evt.retry_count >= MAX_MANUAL_RETRIES
                          ? 'bg-orange-500/20 text-orange-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}>
                        {evt.retry_count}/{MAX_MANUAL_RETRIES} retries
                        {evt.retry_count >= MAX_MANUAL_RETRIES && ' — exhausted'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-foreground">
                      <span>Source: {evt.source_type}</span>
                      {evt.source_id && <span>ID: {evt.source_id}</span>}
                      <span>{formatDate(evt.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {evt.retry_count >= MAX_MANUAL_RETRIES ? (
                      <span
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-input bg-orange-500/10 text-orange-400 cursor-not-allowed"
                        title="Retry limit exhausted — discard or investigate the root cause"
                      >
                        <Ban className="w-3 h-3" />
                        {t.triggers.exhausted_label}
                      </span>
                    ) : (
                      <button
                        onClick={() => void handleRetry(evt.id)}
                        disabled={actionsInProgress.has(evt.id)}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-input bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
                        title={`Retry this event (${evt.retry_count}/${MAX_MANUAL_RETRIES} attempts used)`}
                      >
                        <RefreshCw className={`w-3 h-3 ${actionsInProgress.has(evt.id) ? 'animate-spin' : ''}`} />
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => handleDiscard(evt)}
                      disabled={actionsInProgress.has(evt.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded-input bg-secondary/50 text-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 transition-colors"
                      title="Discard this event permanently"
                    >
                      <Trash2 className="w-3 h-3" />
                      Discard
                    </button>
                  </div>
                </div>

                {evt.error_message && (
                  <div className="text-xs text-red-300/80 bg-red-500/10 rounded px-2.5 py-1.5 font-mono break-all">
                    {evt.error_message}
                  </div>
                )}

                {evt.payload && (
                  <details className="text-xs">
                    <summary className="text-foreground cursor-pointer hover:text-foreground transition-colors">
                      Payload
                    </summary>
                    <pre className="mt-1 p-2 rounded bg-secondary/50 text-foreground overflow-x-auto text-[11px] max-h-32">
                      {(() => {
                        try { return JSON.stringify(JSON.parse(evt.payload), null, 2); }
                        catch { return evt.payload; }
                      })()}
                    </pre>
                  </details>
                )}
              </motion.div>
            ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <ConfirmDestructiveModal {...modal} />
    </div>
  );
}
