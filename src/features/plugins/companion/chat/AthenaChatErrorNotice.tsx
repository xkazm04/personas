/**
 * AthenaChatErrorNotice — the failed-turn chip, with a one-click retry.
 *
 * The store keeps the RAW error (retry/debug); this renders the
 * registry-TRANSLATED message, so the scariest moment of the conversation
 * isn't hardcoded English on a non-English UI (2026-07-16 UAT F-MAJOR-10).
 */

import { RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useCompanionStore } from '../companionStore';

export function AthenaChatErrorNotice({ onSend }: { onSend: (text: string) => void }) {
  const { t } = useTranslation();
  const sendError = useCompanionStore((s) => s.sendError);
  const streaming = useCompanionStore((s) => s.streaming);
  if (!sendError) return null;

  return (
    <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400 flex items-start justify-between gap-3">
      <span className="min-w-0 break-words">
        {resolveErrorTranslated(t, sendError).message}
      </span>
      <button
        type="button"
        onClick={() => {
          // On a failed turn the optimistic user bubble is still in `messages`,
          // so the newest user message is exactly what we re-send. Read it at
          // click time so this chip never subscribes to the transcript.
          const store = useCompanionStore.getState();
          const lastUser = [...store.messages].reverse().find((m) => m.role === 'user');
          if (!lastUser) return;
          store.setSendError(null);
          onSend(lastUser.content);
        }}
        disabled={streaming}
        className="shrink-0 inline-flex items-center gap-1 rounded-interactive border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 text-rose-400 font-medium transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="companion-retry-send"
      >
        <RotateCcw className="w-3 h-3" />
        {t.common.retry}
      </button>
    </div>
  );
}
