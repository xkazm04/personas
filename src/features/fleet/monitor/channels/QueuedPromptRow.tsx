import { memo } from 'react';
import { Clock, SendHorizontal, Wand2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import type { QueuedPrompt } from './conversationModel';

/* ----------------------------------------------------------------------------
 * A PROMPT THAT HAS NOT LANDED YET.
 *
 * The composer no longer disables while a directive is in flight — what it does
 * instead is put the next thing you typed HERE, at the bottom of the
 * conversation, in the same place the sent version will appear. That is the
 * whole trade: a disabled button hides the queue in the operator's head, a row
 * puts it on the screen where its order, its phase and its failure are all
 * legible without asking.
 *
 * It reads as a `mine` bubble deliberately (right-aligned, primary tint) — it is
 * the same message, one step earlier — but dashed, because it is not in the
 * channel yet and a solid bubble would claim it was.
 * -------------------------------------------------------------------------- */

export const QueuedPromptRow = memo(function QueuedPromptRow({
  prompt, onRetry, onDrop,
}: {
  prompt: QueuedPrompt;
  onRetry: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const { t } = useTranslation();
  const failed = prompt.phase === 'failed';

  return (
    <div className="py-1 flex justify-end">
      <div
        className={`max-w-[78%] px-3 py-2 rounded-card border border-dashed ${
          failed
            ? 'border-status-error/40 bg-status-error/[0.06]'
            : 'border-primary/25 bg-primary/[0.07]'
        }`}
      >
        <p className="typo-body text-foreground opacity-75 whitespace-pre-wrap break-words">
          {prompt.text}
        </p>

        <div className="mt-0.5 flex items-center gap-1.5 typo-caption">
          {prompt.phase === 'queued' && (
            <span className="flex items-center gap-1 text-foreground opacity-45">
              <Clock className="w-3 h-3" aria-hidden />
              {t.monitor.conv_queued_waiting}
            </span>
          )}
          {prompt.phase === 'sending' && (
            // No spinner: this is a SURFACE row reporting on itself, not a
            // control the operator is holding down. The phase word is the
            // state, and the row's own dashed edge is the pending affordance.
            <span className="flex items-center gap-1 text-foreground opacity-45">
              {prompt.goal ? (
                <Wand2 className="w-3 h-3" aria-hidden />
              ) : (
                <SendHorizontal className="w-3 h-3" aria-hidden />
              )}
              {prompt.goal ? t.monitor.conv_composer_routing : t.monitor.conv_queued_sending}
            </span>
          )}
          {failed && (
            <>
              <span className="text-status-error">{t.monitor.conv_queued_failed}</span>
              {/* The text stays on screen and stays recoverable: a failed post
                  that vanishes takes the sentence with it. */}
              <Button variant="link" size="xs" onClick={() => onRetry(prompt.id)}>
                {t.monitor.conv_queued_retry}
              </Button>
              <Button variant="link" size="xs" onClick={() => onDrop(prompt.id)}>
                {t.monitor.conv_queued_drop}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
