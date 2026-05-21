/**
 * Composer — the textarea + dictation + send/improve buttons at the
 * bottom of the companion panel. Owns its own draft state; emits send
 * + improve callbacks to the panel orchestrator.
 *
 * Three input paths:
 *   - Direct typing into the textarea (auto-grows up to ~6 lines).
 *   - Dictation via the mic button (browser SpeechRecognition through
 *     `useDictation`). Interim text shown as a display tail; final
 *     chunks fold into the persistent draft.
 *   - External seeding via `useCompanionStore.pendingPrompt` (set by
 *     "Play in chat" affordances on Overview surfaces). `autoSend` skips
 *     the manual click and fires onSend immediately; `__TEST_FORCE_DRAFT__`
 *     is a test-only escape hatch that downgrades autoSend to draft-only
 *     so Playwright specs can verify the seed wiring without queuing a
 *     real LLM call.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Send, Wrench } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { useCompanionStore } from './companionStore';
import { useDictation } from './useDictation';

export function Composer({
  disabled,
  onSend,
  onImprove,
  improveEnabled,
  improving,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  onImprove: (text: string) => void;
  improveEnabled: boolean;
  improving: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation();

  const pendingPrompt = useCompanionStore((s) => s.pendingPrompt);
  useEffect(() => {
    if (!pendingPrompt) return;
    useCompanionStore.getState().setPendingPrompt(null);
    const forceDraft = (globalThis as { __TEST_FORCE_DRAFT__?: boolean })
      .__TEST_FORCE_DRAFT__;
    if (pendingPrompt.autoSend && !disabled && !forceDraft) {
      onSend(pendingPrompt.text);
    } else {
      setDraft(pendingPrompt.text);
    }
  }, [pendingPrompt, disabled, onSend]);

  useEffect(() => {
    if (!dictation.finalText) return;
    setDraft((prev) =>
      prev ? `${prev.replace(/\s+$/, '')} ${dictation.finalText}` : dictation.finalText,
    );
    dictation.reset();
  }, [dictation.finalText, dictation]);

  const submit = useCallback(() => {
    if (disabled || !draft.trim()) return;
    onSend(draft);
    setDraft('');
  }, [disabled, draft, onSend]);

  const submitImprove = useCallback(() => {
    if (disabled || improving || !draft.trim()) return;
    onImprove(draft);
    setDraft('');
  }, [disabled, improving, draft, onImprove]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  // Auto-grow up to ~6 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const placeholder = useMemo(
    () => t.plugins.companion.composer_placeholder,
    [t.plugins.companion.composer_placeholder],
  );

  // Visual indicator for what's currently being recognized — appended to the
  // textarea's value while listening. Kept in a separate variable so we don't
  // overwrite the user's draft; it's purely a display tail.
  const displayValue =
    dictation.listening && dictation.interimText
      ? `${draft}${draft ? ' ' : ''}${dictation.interimText}`
      : draft;

  return (
    <div className="border-t border-foreground/10 px-3 py-3 shrink-0">
      <div className="flex items-end gap-2 rounded-card bg-foreground/5 px-3 py-2">
        <textarea
          ref={taRef}
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          data-testid="companion-composer"
          className="flex-1 bg-transparent border-0 outline-none resize-none typo-body text-foreground placeholder:text-foreground/40 disabled:opacity-50"
          aria-label={placeholder}
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            disabled={disabled}
            className={`p-2 rounded-interactive transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed ${
              dictation.listening
                ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                : dictation.error
                  ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                  : 'bg-foreground/5 text-foreground hover:bg-foreground/10 hover:text-foreground'
            }`}
            aria-label={
              dictation.listening
                ? t.plugins.companion.dictate_stop
                : t.plugins.companion.dictate_start
            }
            title={
              dictation.error
                ? t.plugins.companion.dictate_error
                : dictation.listening
                  ? t.plugins.companion.dictate_listening_hint
                  : t.plugins.companion.dictate_start_hint
            }
            aria-pressed={dictation.listening}
          >
            {dictation.listening ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
        )}
        {improveEnabled && (
          <button
            onClick={submitImprove}
            disabled={disabled || improving || !draft.trim()}
            className="p-2 rounded-interactive bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-ring"
            aria-label={t.plugins.companion.improve_send}
            title={t.plugins.companion.improve_send_title}
          >
            {improving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wrench className="w-4 h-4" />
            )}
          </button>
        )}
        <button
          onClick={submit}
          disabled={disabled || !draft.trim()}
          data-testid="companion-send"
          className="p-2 rounded-interactive bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity focus-ring"
          aria-label={t.plugins.companion.send}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
