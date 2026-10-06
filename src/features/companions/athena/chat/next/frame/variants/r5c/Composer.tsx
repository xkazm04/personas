/**
 * Folio · the page's last line: where you write to her. The product's own
 * `ChatInputBar` and send path (a fresh nonce through `sendOrQueue`, dictation
 * appended to the draft), set without its pill so it reads as a line of the
 * page. Two Folio additions:
 *
 * - The OUTGOING LINE: an invisible twin of the draft carries the layout id the
 *   next ask in the transcript will wear (`r5c-line-<n>`), so on send the same
 *   line visibly travels from here into the page instead of popping in there.
 * - While a folio page is open, the reply is ABOUT that page: a footnote mark
 *   and the kind, never a truncated title.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useTranslation } from '@/i18n/useTranslation';
import { createSendNonce } from '../../../../../sendNonceLedger';
import { useSpeechInput } from '../../../../../useSpeechInput';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { NEXT_COPY as N } from '../../../nextCopy';
import type { WorkItem } from '../../../useWorkforce';
import { aboutPrefix } from '../../FrameBottom';
import { FOLIO_COPY as C } from './copy';
import { kindInk } from './marks';

export interface About {
  item: WorkItem;
  mark: string;
}

export function Composer({ engine, about, onClearAbout }: { engine: AthenaChatEngine; about: About | null; onClearAbout: () => void }) {
  const { t } = useTranslation();
  const streaming = useAthenaStore((s) => s.streaming);
  const [draft, setDraft] = useState('');
  const dictation = useSpeechInput();
  const nextLine = engine.messages.reduce((n, m) => (m.role === 'user' ? n + 1 : n), 0) + 1;

  useEffect(() => {
    if (!dictation.finalText) return;
    setDraft((prev) => (prev ? `${prev.replace(/\s+$/, '')} ${dictation.finalText}` : dictation.finalText));
    dictation.reset();
  }, [dictation.finalText, dictation]);

  const shown = dictation.listening && dictation.interimText ? `${draft}${draft ? ' ' : ''}${dictation.interimText}` : draft;

  const submit = () => {
    const text = draft.trim();
    if (!text || !engine.initialized) return;
    engine.sendOrQueue(about ? aboutPrefix(about.item) + text : text, createSendNonce());
    setDraft('');
  };

  return (
    <div className="r5c-composer typo-body">
      {draft.trim() && (
        // The outgoing line's twin: invisible, it only lends the transcript a
        // starting box for the same line's flight.
        <motion.span layoutId={`r5c-line-${nextLine}`} className="r5c-outgoing typo-body-lg" aria-hidden>
          {draft.trim()}
        </motion.span>
      )}
      <ChatInputBar
        value={shown}
        onChange={setDraft}
        onSubmit={submit}
        multiline
        maxRows={5}
        starters={
          engine.messages.length === 0
            ? C.firstLines.map(([chip, fill], i) => ({ id: `r5c-first-${i}`, label: chip, fill }))
            : undefined
        }
        placeholder={t.athena.composer_placeholder}
        disabled={!engine.initialized}
        busy={streaming}
        sendLabel={t.common.send}
        inputTestId="companion-input"
        boxShadow="none"
        className="!bg-transparent !border-0 !shadow-none !backdrop-blur-none"
        voice={{
          supported: dictation.supported,
          listening: dictation.listening,
          onToggle: () => (dictation.listening ? dictation.stop() : dictation.start()),
          startLabel: N.voice.start,
          listeningLabel: N.voice.listening,
        }}
        leading={
          about ? (
            <span className="r5c-about" style={{ ['--ink' as string]: kindInk(about.item.kind) }}>
              <span className="sr-only">{C.aboutThis}: </span>
              <span className="r5c-about-mark typo-heading" aria-hidden>
                {about.mark}
              </span>
              <span className="r5c-sc typo-label">{N.kind[about.item.kind]}</span>
              <Button variant="ghost" size="icon-sm" onClick={onClearAbout} aria-label={N.clearAbout}>
                <X className="w-3.5 h-3.5" aria-hidden />
              </Button>
            </span>
          ) : undefined
        }
      />
    </div>
  );
}
