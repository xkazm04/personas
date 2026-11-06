import { Clock, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaStore } from './athenaStore';

import Button from '@/features/shared/components/buttons/Button';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
/**
 * Async-UX phase 4 — the strip of messages the user sent while a turn was
 * still streaming. Each waits its turn (FIFO) and is drained one-per-turn-
 * completion by AthenaChatPanel; the user can cancel any still-pending one
 * here. Renders nothing when the queue is empty. Mounted just above the
 * composer so "what's waiting to send" sits next to where it was typed.
 */
export function QueuedMessages() {
  const { t } = useTranslation();
  // The flat mirror = the ACTIVE conversation's queue; removals target the
  // same conversation the strip is showing.
  const queued = useAthenaStore((s) => s.queuedMessages);
  const activeConversationId = useAthenaStore((s) => s.activeConversationId);
  const remove = useAthenaStore((s) => s.removeQueuedMessage);
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
          <Tooltip content={m.text}>
            <span className="flex-1 truncate text-foreground" >
              {m.text}
            </span>
          </Tooltip>
          <span className="shrink-0 text-foreground">{t.athena.queued_badge}</span>
          <Button
            type="button"
            onClick={() => remove(activeConversationId, m.id)}
            aria-label={t.athena.queued_remove}
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
