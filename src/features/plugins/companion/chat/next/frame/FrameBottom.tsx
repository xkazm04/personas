/**
 * FrameBottom — the bottom edge: chat or voice input and nothing else, on the
 * shared `ChatInputBar` (the same base as the Studio dock). The send path is
 * the classic composer's: a fresh nonce per submit through `sendOrQueue`, so a
 * message typed mid-turn interrupts or queues exactly as before. Dictation
 * uses the operator's chosen engine (`useSpeechInput`), finals appended to the
 * draft. When a decision card is open, an "About" chip leads the bar.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useTranslation } from '@/i18n/useTranslation';
import { createSendNonce } from '../../../sendNonceLedger';
import { useSpeechInput } from '../../../useSpeechInput';
import { useCompanionStore } from '../../../companionStore';
import type { AthenaChatEngine } from '../../athenaChatEngine';
import { aboutPrefix } from '../NextComposer';
import { NEXT_COPY as C } from '../nextCopy';
import type { WorkItem } from '../useWorkforce';

export function FrameBottom({
  engine,
  about,
  onClearAbout,
}: {
  engine: AthenaChatEngine;
  about: WorkItem | null;
  onClearAbout: () => void;
}) {
  const { t } = useTranslation();
  const streaming = useCompanionStore((s) => s.streaming);
  const [draft, setDraft] = useState('');
  const dictation = useSpeechInput();

  useEffect(() => {
    if (!dictation.finalText) return;
    setDraft((prev) => (prev ? `${prev.replace(/\s+$/, '')} ${dictation.finalText}` : dictation.finalText));
    dictation.reset();
  }, [dictation.finalText, dictation]);

  const shown = dictation.listening && dictation.interimText ? `${draft}${draft ? ' ' : ''}${dictation.interimText}` : draft;

  const submit = () => {
    const text = draft.trim();
    if (!text || !engine.initialized) return;
    engine.sendOrQueue(about ? aboutPrefix(about) + text : text, createSendNonce());
    setDraft('');
  };

  return (
    <ChatInputBar
      value={shown}
      onChange={setDraft}
      onSubmit={submit}
      multiline
      maxRows={5}
      placeholder={t.plugins.companion.composer_placeholder}
      disabled={!engine.initialized}
      busy={streaming}
      sendLabel={t.common.send}
      inputTestId="companion-input"
      boxShadow="none"
      className="!bg-transparent !border-0 !shadow-none"
      voice={{
        supported: dictation.supported,
        listening: dictation.listening,
        onToggle: () => (dictation.listening ? dictation.stop() : dictation.start()),
        startLabel: C.voice.start,
        listeningLabel: C.voice.listening,
      }}
      leading={
        about ? (
          <span className="inline-flex items-center gap-1.5 max-w-64 rounded-full border border-primary/35 bg-primary/10 pl-2.5 pr-1 py-0.5 typo-caption text-foreground">
            <span className="text-primary shrink-0">{C.about}:</span>
            <span className="truncate">{about.title}</span>
            <button type="button" onClick={onClearAbout} aria-label={C.clearAbout} className="p-0.5 rounded-full hover:bg-foreground/10 focus-ring">
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          </span>
        ) : undefined
      }
    />
  );
}
