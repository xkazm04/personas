import { Clock, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from './companionStore';

/**
 * Async-UX phase 4 — the strip of messages the user sent while a turn was
 * still streaming. Each waits its turn (FIFO) and is drained one-per-turn-
 * completion by CompanionPanel; the user can cancel any still-pending one
 * here. Renders nothing when the queue is empty. Mounted just above the
 * composer so "what's waiting to send" sits next to where it was typed.
 */
export function QueuedMessages() {
  const { t } = useTranslation();
  const queued = useCompanionStore((s) => s.queuedMessages);
  const remove = useCompanionStore((s) => s.removeQueuedMessage);
  if (queued.length === 0) return null;

  return (
    <div
      className="mx-3 mb-1.5 space-y-1"
      data-testid="companion-queued-messages"
      data-queued-count={queued.length}
    >
      {queued.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-2 rounded-input border border-foreground/10 bg-secondary/40 px-2.5 py-1.5 typo-caption"
          data-queued-mode={m.mode}
        >
          <Clock className="w-3.5 h-3.5 shrink-0 text-foreground" />
          <span className="flex-1 truncate text-foreground" title={m.text}>
            {m.text}
          </span>
          <span className="shrink-0 text-foreground">{t.plugins.companion.queued_badge}</span>
          <button
            type="button"
            onClick={() => remove(m.id)}
            className="shrink-0 text-foreground hover:text-foreground focus-ring rounded-interactive"
            aria-label={t.plugins.companion.queued_remove}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
