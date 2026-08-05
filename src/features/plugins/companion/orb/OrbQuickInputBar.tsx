import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useCompanionStore } from '../companionStore';
import { useSpeechInput } from '../useSpeechInput';

/**
 * Compact bottom input bar for the companion Orb — lets the user fire a
 * quick text (or dictated) message to Athena WITHOUT opening the full chat
 * panel. Toggled by the affordance button on {@link AthenaOrb}; rendered as
 * a sibling of the orb (not a descendant) so its `fixed` positioning resolves
 * against the viewport rather than the orb's own transformed wrapper.
 *
 * Submits through `voiceTurnRequest` — the same always-mounted bridge
 * `useHoldToTalk` uses to run a full `send()` turn (streaming + transcript +
 * TTS) in `CompanionPanel` while it stays closed. The most recent assistant
 * reply (read from the shared `messages` store, kept live by that same send
 * pipeline) surfaces above the input so the reply is readable without ever
 * opening the chat window.
 */
export function OrbQuickInputBar({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const dictation = useSpeechInput();
  const streaming = useCompanionStore((s) => s.streaming);
  const lastReply = useCompanionStore((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const m = s.messages[i];
      if (m?.role === 'assistant') return m.content;
    }
    return null;
  });

  useEffect(() => {
    if (!dictation.finalText) return;
    setText((prev) =>
      prev ? `${prev.replace(/\s+$/, '')} ${dictation.finalText}` : dictation.finalText,
    );
    dictation.reset();
  }, [dictation.finalText, dictation]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    useCompanionStore.getState().setVoiceTurnRequest(trimmed);
    setText('');
  };

  const displayValue =
    dictation.listening && dictation.interimText
      ? `${text}${text ? ' ' : ''}${dictation.interimText}`
      : text;

  return (
    <div
      data-testid="orb-quick-input-bar"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-10 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex w-full max-w-sm flex-col gap-2">
        {lastReply && (
          <div
            data-testid="orb-quick-input-last-reply"
            aria-label={t.plugins.companion.orb_quick_input_last_reply_label}
            className="rounded-card border border-primary/20 bg-background/95 p-3 shadow-elevation-3 backdrop-blur"
          >
            <p className="line-clamp-3 typo-caption leading-relaxed text-foreground/90">
              {lastReply}
            </p>
          </div>
        )}
        <ChatInputBar
          value={displayValue}
          onChange={setText}
          onSubmit={submit}
          placeholder={t.plugins.companion.orb_quick_input_placeholder}
          disabled={streaming}
          busy={streaming}
          size="sm"
          autoFocus
          inputTestId="orb-quick-input"
          sendTestId="orb-quick-input-send"
          sendAriaLabel={t.plugins.companion.send}
          voice={{
            supported: dictation.supported,
            listening: dictation.listening,
            onToggle: () => (dictation.listening ? dictation.stop() : dictation.start()),
            startLabel: t.plugins.companion.dictate_start,
            listeningLabel: t.plugins.companion.dictate_stop,
          }}
          trailing={
            <button
              type="button"
              onClick={onClose}
              data-testid="orb-quick-input-close"
              aria-label={t.plugins.companion.orb_quick_input_close}
              title={t.plugins.companion.orb_quick_input_close}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary/60 hover:text-primary"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          }
        />
      </div>
    </div>
  );
}
