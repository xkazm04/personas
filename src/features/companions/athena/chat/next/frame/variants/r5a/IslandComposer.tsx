/**
 * IslandComposer - the island's bottom row whenever it is open: the shared
 * `ChatInputBar` (the Studio dock's base) with the classic send path, a fresh
 * nonce per submit through `sendOrQueue`, so a message typed mid-turn
 * interrupts or queues exactly as before. Dictation finals append to the draft.
 *
 * It stays the same instance across the conversation and decision sheets, so
 * a half-typed draft survives opening a decision. While a decision is open a
 * short "Re: this decision" chip leads the row (a label, never the item's
 * title cut mid-word) and the message carries the `[re: ...]` prefix
 * `FrameBottom` uses, so Athena answers about the item in front of you.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect, useRef, useState } from 'react';
import { Hand } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useTranslation } from '@/i18n/useTranslation';
import { createSendNonce } from '../../../../../sendNonceLedger';
import { useSpeechInput } from '../../../../../useSpeechInput';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { NEXT_COPY as C } from '../../../nextCopy';
import type { WorkItem } from '../../../useWorkforce';
import { aboutPrefix } from '../../FrameBottom';
import { ISLAND_COPY as I } from './copy';

export function IslandComposer({
  engine,
  about,
  seed,
  autoFocus,
  onLaunch,
}: {
  engine: AthenaChatEngine;
  about: WorkItem | null;
  /** A first character typed on the resting capsule. */
  seed: string;
  autoFocus: boolean;
  /** Where the sent words were, so they can fly into the transcript. */
  onLaunch: (text: string, from: DOMRect) => void;
}) {
  const { t } = useTranslation();
  const streaming = useAthenaStore((s) => s.streaming);
  const [draft, setDraft] = useState(seed);
  const dictation = useSpeechInput();
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dictation.finalText) return;
    setDraft((prev) => (prev ? `${prev.replace(/\s+$/, '')} ${dictation.finalText}` : dictation.finalText));
    dictation.reset();
  }, [dictation.finalText, dictation]);

  const shown = dictation.listening && dictation.interimText ? `${draft}${draft ? ' ' : ''}${dictation.interimText}` : draft;

  const submit = () => {
    const text = draft.trim();
    if (!text || !engine.initialized) return;
    const field = rowRef.current?.querySelector<HTMLElement>('[data-testid="companion-input"]');
    if (field && !about) onLaunch(text, field.getBoundingClientRect());
    engine.sendOrQueue(about ? aboutPrefix(about) + text : text, createSendNonce());
    setDraft('');
  };

  return (
    <div ref={rowRef} className="r5a-compose" data-testid="companion-composer">
      <ChatInputBar
        value={shown}
        onChange={setDraft}
        onSubmit={submit}
        multiline
        maxRows={5}
        autoFocus={autoFocus}
        placeholder={t.athena.composer_placeholder}
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
            <span className="r5a-about typo-label" data-testid="companion-r5a-about">
              <Hand className="w-3.5 h-3.5 text-role-human" aria-hidden />
              {I.aboutThis(I.noun[about.kind] ?? about.kind)}
            </span>
          ) : undefined
        }
      />
    </div>
  );
}
