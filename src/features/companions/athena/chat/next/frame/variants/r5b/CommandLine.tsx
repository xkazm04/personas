/**
 * The command line: one precise row at the bottom of the screen - her phase
 * readout (which also folds the conversation up and down) and the composer.
 * Engaged (focus, Alt+T, or a send) the SAME frame rises into the transcript
 * column, wider and taller, and folds back down with Esc. While she works a
 * readout row with her beat line rides above the composer, so the slim state
 * still says what she is doing.
 *
 * Sending goes through `sendOrQueue` with a fresh nonce, exactly like the
 * product's composer; the text's on-screen position is handed to the
 * transcript as a flight so the message glides into its row instead of popping.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect, useState, type MutableRefObject } from 'react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { createSendNonce } from '../../../../../sendNonceLedger';
import { useSpeechInput } from '../../../../../useSpeechInput';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { NEXT_COPY as N } from '../../../nextCopy';
import type { WorkItem } from '../../../useWorkforce';
import { aboutPrefix } from '../../FrameBottom';
import { R5B_COPY as C } from './copy';
import { PhaseReadout, phaseOf } from './PhaseReadout';
import { Transcript } from './Transcript';
import type { Flight } from './TurnRow';

export interface ConsoleSize { rest: number; open: number; height: number }

function lastReplyAt(engine: AthenaChatEngine): string | null {
  for (let i = engine.messages.length - 1; i >= 0; i--) {
    const m = engine.messages[i]!;
    if (m.role === 'assistant' && !m.content.trimStart().startsWith('PROGRESS:')) return m.createdAt;
  }
  return null;
}

export function CommandLine({
  engine,
  engaged,
  size,
  animate,
  about,
  flight,
  inputRoot,
  onEngage,
  onToggle,
}: {
  engine: AthenaChatEngine;
  engaged: boolean;
  size: ConsoleSize;
  animate: boolean;
  about: WorkItem | null;
  flight: MutableRefObject<Flight | null>;
  inputRoot: MutableRefObject<HTMLDivElement | null>;
  /** Raise the transcript; false when something else holds the stage (a gate's surface). */
  onEngage: (why: 'focus' | 'send') => boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const streaming = useAthenaStore((s) => s.streaming);
  const phase = phaseOf(streaming, useAthenaStore((s) => s.streamingPhase));
  const beat = useAthenaStore((s) => s.streamingBeat);
  const [draft, setDraft] = useState('');
  const dictation = useSpeechInput();
  const replyAt = lastReplyAt(engine);

  useEffect(() => {
    if (!dictation.finalText) return;
    setDraft((prev) => (prev ? `${prev.replace(/\s+$/, '')} ${dictation.finalText}` : dictation.finalText));
    dictation.reset();
  }, [dictation.finalText, dictation]);
  const shown = dictation.listening && dictation.interimText ? `${draft}${draft ? ' ' : ''}${dictation.interimText}` : draft;

  const submit = () => {
    const text = draft.trim();
    if (!text || !engine.initialized) return;
    const field = inputRoot.current?.querySelector('textarea');
    // The flight only leaves when the transcript is (or is about to be) up to catch it.
    if (onEngage('send') && field) flight.current = { text, rect: field.getBoundingClientRect() };
    engine.sendOrQueue(about ? aboutPrefix(about) + text : text, createSendNonce());
    setDraft('');
  };

  return (
    <div
      className="r5b-console r5b-grow rounded-modal shadow-elevation-3 pointer-events-auto flex flex-col overflow-hidden"
      style={{ width: engaged ? size.open : size.rest }}
      data-testid="companion-r5b-console"
      data-engaged={engaged ? 'true' : 'false'}
      data-r5b-piece="console"
    >
      {/* The column rises out of the line: height and width are CSS transitions on one frame. */}
      <div className="r5b-grow min-h-0" style={{ height: engaged ? size.height : 0, opacity: engaged ? 1 : 0 }} aria-hidden={!engaged}>
        {engaged && <Transcript engine={engine} animate={animate} flight={flight} />}
      </div>

      {(streaming || about) && !engaged && (
        <div className="flex items-center gap-3 px-4 pt-2 min-w-0">
          {about && <span className="typo-code uppercase text-status-warning whitespace-nowrap">{C.about} · {N.kind[about.kind]}</span>}
          {streaming && beat && <span className="typo-caption min-w-0">{beat}</span>}
        </div>
      )}

      <div className={`flex items-center gap-1 pl-3 pr-1 ${engaged ? 'r5b-rule' : ''}`}>
        <Tooltip content={`${engaged ? C.closeTranscript : C.openTranscript} · Alt+T`} placement="top">
          <Button
            variant="ghost"
            size="xs"
            onClick={onToggle}
            aria-expanded={engaged}
            aria-keyshortcuts="Alt+T"
            aria-label={engaged ? C.closeTranscript : C.openTranscript}
            data-testid="companion-r5b-readout"
            className="shrink-0 !px-2"
          >
            <PhaseReadout
              phase={phase}
              animate={animate}
              trail={!streaming && replyAt ? <RelativeTime timestamp={replyAt} className="typo-code text-muted tabular-nums whitespace-nowrap" showTooltip={false} /> : null}
            />
          </Button>
        </Tooltip>
        <div ref={inputRoot} className="flex-1 min-w-0" data-testid="companion-composer" onFocusCapture={() => onEngage('focus')}>
          <ChatInputBar
            value={shown}
            onChange={setDraft}
            onSubmit={submit}
            multiline
            maxRows={5}
            placeholder={C.placeholder}
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
          />
        </div>
      </div>
    </div>
  );
}
