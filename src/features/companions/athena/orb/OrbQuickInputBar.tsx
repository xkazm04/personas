/**
 * Compact quick-exchange bar for the companion Orb — a full round trip with
 * Athena without opening the chat panel. Toggled from {@link AthenaOrb};
 * rendered as a SIBLING of the orb (not a descendant) so its `fixed`
 * positioning resolves against the viewport rather than the orb's transformed
 * wrapper.
 *
 * Submits through `voiceTurnRequest` — the same always-mounted bridge
 * hold-to-talk uses to run a full `send()` turn (streaming + transcript + TTS)
 * while the panel stays closed.
 *
 * **The reading half is the point of this surface, and it used to be an
 * afterthought:** the reply was a three-line clamp of raw text, so any answer
 * with structure arrived as a wall with its ending cut off, and the only way to
 * see the rest was to open the very window this bar exists to avoid. It is now
 * a real reading surface — rendered as markdown at reading size, sized to the
 * content, and scrollable past that. The governing rule is a paragraph fits
 * without scrolling and anything longer scrolls rather than truncating; nothing
 * here ever ends in an ellipsis.
 *
 * Both halves are height-bounded (reply ≤ 38vh, composer ≤ 6 rows) so a long
 * answer and a long question can coexist without the bar walking off screen.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useCompanionStore } from '../companionStore';
import { BubbleReadAloud } from '../BubbleReadAloud';
import { TypingDots } from '../TypingDots';
import { useSpeechInput } from '../useSpeechInput';
import { useTtsSettings } from '../useTtsSettings';
import { useTtsVoiceSelection } from '../useTtsVoiceSelection';
import { lastAssistantText } from '../chat/athenaChatPreview';

export function OrbQuickInputBar({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const [text, setText] = useState('');
  const dictation = useSpeechInput();
  const streaming = useCompanionStore((s) => s.streaming);
  const messages = useCompanionStore((s) => s.messages);
  const lastReply = lastAssistantText(messages);
  const voice = useTtsVoiceSelection();
  const voiceSettings = useTtsSettings();

  const replyRef = useRef<HTMLDivElement>(null);
  // A new reply is read from its beginning. Without this the surface keeps the
  // previous answer's scroll offset and the next one appears to start mid-way.
  // Assigning `scrollTop` rather than calling `scrollTo`: the jump should be
  // instant either way, and jsdom implements the property but not the method.
  useEffect(() => {
    if (replyRef.current) replyRef.current.scrollTop = 0;
  }, [lastReply]);

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
      {/* 50% wider than the original `max-w-sm`: the bar is where a whole
          exchange happens now, and 384px could not hold one side of it. */}
      <div className="pointer-events-auto flex w-full max-w-xl flex-col gap-2">
        {(lastReply || streaming) && (
          <div
            data-testid="orb-quick-input-last-reply"
            aria-label={c.orb_quick_input_last_reply_label}
            className="rounded-card border border-primary/20 bg-background/95 shadow-elevation-3 backdrop-blur"
          >
            <div className="flex items-center gap-1.5 px-3 pt-2">
              <span className="typo-caption font-medium text-primary">{c.name}</span>
              {streaming && (
                <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
                  <span className="typo-caption text-foreground opacity-70">{c.working}</span>
                  <TypingDots />
                </span>
              )}
              <button
                type="button"
                onClick={() => useCompanionStore.getState().setState('open')}
                data-testid="orb-quick-input-expand"
                aria-label={c.orb_quick_input_expand}
                title={c.orb_quick_input_expand}
                className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary/60 hover:text-primary focus-ring"
              >
                <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            {lastReply && (
              <>
                {/* Reading size, not caption size — this is the primary content
                    of the surface. Markdown so a structured answer keeps its
                    structure; `athena-chat-md` gives it the same chat-scale
                    hierarchy the panel uses, so the two never disagree. */}
                <div
                  ref={replyRef}
                  className="companion-scroll max-h-[38vh] overflow-y-auto scrollbar-thin px-3 py-2"
                >
                  <MarkdownRenderer
                    content={lastReply}
                    className="athena-chat-md typo-body leading-relaxed"
                    codeBlockActions
                  />
                </div>
                <div className="flex items-center gap-1.5 px-3 pb-2">
                  <BubbleReadAloud
                    content={lastReply}
                    voice={voice}
                    voiceSettings={voiceSettings}
                  />
                </div>
              </>
            )}
          </div>
        )}
        <ChatInputBar
          value={displayValue}
          onChange={setText}
          onSubmit={submit}
          placeholder={c.orb_quick_input_placeholder}
          disabled={streaming}
          busy={streaming}
          size="sm"
          autoFocus
          // A paragraph fits; past six rows the field scrolls rather than
          // growing into the reply above it.
          multiline
          maxRows={6}
          inputTestId="orb-quick-input"
          sendTestId="orb-quick-input-send"
          sendAriaLabel={c.send}
          voice={{
            supported: dictation.supported,
            listening: dictation.listening,
            onToggle: () => (dictation.listening ? dictation.stop() : dictation.start()),
            startLabel: c.dictate_start,
            listeningLabel: c.dictate_stop,
          }}
          trailing={
            <button
              type="button"
              onClick={onClose}
              data-testid="orb-quick-input-close"
              aria-label={c.orb_quick_input_close}
              title={c.orb_quick_input_close}
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
