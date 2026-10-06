/**
 * The transcript column that rises out of the command line. It opens AT the
 * latest turn (before paint, so the jump is never seen) and follows new words
 * only while you are at the bottom. Older turns come in pages of twelve.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect, useLayoutEffect, useMemo, useState, type MutableRefObject } from 'react';
import { ChevronUp } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useAthenaStore } from '../../../../../athenaStore';
import { QueuedMessages } from '../../../../../QueuedMessages';
import { QuickReplies } from '../../../../../QuickReplies';
import { useChatScroll } from '../../../../../useChatScroll';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { buildTurns } from '../../../exchange';
import { R5B_COPY as C } from './copy';
import { LiveReply } from './LiveReply';
import { TurnRow, type Flight } from './TurnRow';

const PAGE = 12;

export function Transcript({
  engine,
  animate,
  flight,
}: {
  engine: AthenaChatEngine;
  animate: boolean;
  flight: MutableRefObject<Flight | null>;
}) {
  const turns = useMemo(() => buildTurns(engine.messages), [engine.messages]);
  const [shown, setShown] = useState(PAGE);
  const streamingText = useAthenaStore((s) => s.streamingText);
  const quickReplies = useAthenaStore((s) => s.quickReplies);
  const { scrollRef, scrollToBottom, maybeAutoScroll } = useChatScroll(true);
  const hidden = Math.max(0, turns.length - shown);
  const visible = hidden > 0 ? turns.slice(hidden) : turns;

  useLayoutEffect(() => scrollToBottom('auto'), [scrollToBottom]);
  useEffect(maybeAutoScroll, [engine.messages, engine.streaming, streamingText, maybeAutoScroll]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto scrollbar-thin px-6 pt-6 pb-4" data-testid="companion-r5b-transcript">
      <div className="athena-exchange flex flex-col gap-8">
        {hidden > 0 && (
          <div className="flex justify-center">
            <Button variant="ghost" size="xs" icon={<ChevronUp className="w-3.5 h-3.5" />} onClick={() => setShown((n) => n + PAGE)}>
              <span className="typo-code">{C.earlier(hidden)}</span>
            </Button>
          </div>
        )}
        {turns.length === 0 && !engine.streaming && (
          <div className="py-10 text-center">
            <p className="typo-title-lg">{C.noMessage}</p>
            <p className="typo-caption mt-1">{C.noMessageSub}</p>
          </div>
        )}
        {visible.map((turn, i) => (
          <TurnRow
            key={turn.id}
            turn={turn}
            isLast={i === visible.length - 1}
            streaming={engine.streaming}
            interactive={engine.initialized}
            flight={flight}
            animateFlight={animate}
            onSend={engine.send}
          />
        ))}
        {engine.streaming && <LiveReply animate={animate} onStop={engine.interrupt} />}
        <div className="flex flex-col gap-2 pl-[calc(6.5rem+1.25rem)]">
          <QueuedMessages />
          {!engine.streaming && <QuickReplies options={quickReplies} disabled={!engine.initialized} onPick={engine.send} />}
        </div>
      </div>
    </div>
  );
}
