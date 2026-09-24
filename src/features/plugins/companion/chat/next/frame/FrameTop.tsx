/**
 * FrameTop — the top edge: her latest words, four rows that scroll, and the
 * mode keys. Expanding stretches the piece down the centre column into the
 * whole conversation; a turn's tick strip opens that turn's detail in place.
 * The header row stays fixed in both states; only the words scroll.
 *
 * The dev row (the op ledger, with the save-log key) rides under the keys
 * exactly as it does under the Current header. The expanded conversation opens
 * at the latest turn and follows new turns while you are at the bottom.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Square } from 'lucide-react';
import type { CompanionMessage } from '@/api/companion';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { ConversationSwitcher } from '../../../ConversationSwitcher';
import { DevOpLedger } from '../../../DevOpLedger';
import { QueuedMessages } from '../../../QueuedMessages';
import { QuickReplies } from '../../../QuickReplies';
import { TypingDots } from '../../../TypingDots';
import { stripModelDirectives } from '../../../athenaLabels';
import { useChatScroll } from '../../../useChatScroll';
import { useCompanionStore } from '../../../companionStore';
import type { AthenaChatEngine } from '../../athenaChatEngine';
import { ExchangeTranscript } from '../ExchangeTranscript';
import { TurnPane } from '../NextPanes';
import { AssistantProse } from '../../refs/AssistantProse';
import type { Turn } from '../exchange';
import { NEXT_COPY as C } from '../nextCopy';
import { FrameKeys } from './FrameKeys';
import type { FrameLook } from './frameLook';

function latestReply(messages: CompanionMessage[]): CompanionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'assistant' && !m.content.trimStart().startsWith('PROGRESS:')) return m;
  }
  return null;
}

export function FrameTop({
  look,
  engine,
  expanded,
  onExpand,
  onOpenWaiting,
}: {
  look: FrameLook;
  engine: AthenaChatEngine;
  expanded: boolean;
  onExpand: () => void;
  onOpenWaiting: () => void;
}) {
  const { t } = useTranslation();
  const streaming = useCompanionStore((s) => s.streaming);
  const beat = useCompanionStore((s) => s.streamingBeat);
  const quickReplies = useCompanionStore((s) => s.quickReplies);
  const autonomous = useSystemStore((s) => s.companionAutonomousMode);
  const devMode = useSystemStore((s) => s.companionDevMode);
  const devAvailable = useCompanionStore((s) => s.devModeAvailable);
  const [turn, setTurn] = useState<Turn | null>(null);
  const last = useMemo(() => latestReply(engine.messages), [engine.messages]);
  const reading = expanded && !turn;
  // The same bottom-aware pin the Current transcript uses: new turns follow
  // the reader only while they are at the bottom.
  const { scrollRef, scrollToBottom, maybeAutoScroll } = useChatScroll(reading);
  // Where the reader was before opening a turn's detail, so "back" returns there.
  const savedScroll = useRef<number | null>(null);

  // Expanding lands at the latest turn, coming back from a turn's detail at the
  // saved position. Before paint, so the jump is never seen.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!reading || !el) return;
    const saved = savedScroll.current;
    savedScroll.current = null;
    if (saved === null) scrollToBottom('auto');
    else el.scrollTop = saved;
  }, [reading, scrollRef, scrollToBottom]);
  useEffect(maybeAutoScroll, [engine.messages, engine.streaming, maybeAutoScroll]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-3 px-4 pt-3 pb-2 text-foreground">
        <img
          src="/athena/athena_baseline.jpg"
          alt=""
          aria-hidden
          draggable={false}
          className={`w-8 h-8 rounded-full object-cover select-none ${autonomous ? 'ring-2 ring-primary/60' : 'ring-1 ring-primary/25'}`}
        />
        <ConversationSwitcher />
        <span className="flex-1" />
        <FrameKeys look={look} expanded={expanded} onExpand={onExpand} />
      </div>
      <Collapse open={devAvailable && devMode} unmountWhenClosed className="shrink-0"><DevOpLedger /></Collapse>

      {expanded ? (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 sm:px-9 pt-7 pb-8 border-t border-foreground/10"
        >
          {turn ? (
            <>
              <button
                type="button"
                onClick={() => setTurn(null)}
                className="mb-4 inline-flex items-center gap-1.5 rounded-interactive px-2 py-1 typo-body text-foreground/80 hover:bg-foreground/[0.06] focus-ring"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden />
                {C.backToChat}
              </button>
              <TurnPane turn={turn} />
            </>
          ) : (
            <ExchangeTranscript
              messages={engine.messages}
              streaming={engine.streaming}
              interactive={engine.initialized}
              onSend={engine.send}
              onOpenTurn={(next) => {
                savedScroll.current = scrollRef.current?.scrollTop ?? null;
                setTurn(next);
              }}
              onOpenWaiting={onOpenWaiting}
            />
          )}
        </div>
      ) : (
        <div className="px-5 pb-4">
          <div role="status" aria-live="polite">
          {streaming && (
            <div className="flex items-center gap-3">
              <span className={look.label}>{C.working}</span>
              <span className={`${look.message} truncate`}>{beat ?? t.plugins.companion.working}</span>
              <TypingDots />
              <button
                type="button"
                onClick={engine.interrupt}
                data-testid="companion-stop-turn"
                className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-status-error/15 text-status-error px-3 py-1 typo-label hover:bg-status-error/25 focus-ring"
              >
                <Square className="w-3 h-3" fill="currentColor" aria-hidden />
                {t.plugins.companion.stop_turn}
              </button>
            </div>
          )}
          </div>
          {streaming ? null : last ? (
            // A div, not a button: rendered markdown carries its own buttons
            // (code-block copy), and a button may not contain buttons.
            <div
              role="button"
              tabIndex={0}
              onClick={onExpand}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onExpand()}
              aria-label={C.expandConversation}
              className={`block w-full cursor-pointer text-left rounded-interactive focus-ring max-h-[4lh] overflow-y-auto scrollbar-thin pr-2 athena-chat-md ${look.message}`}
            >
              {/* Four rows of the reply's own line height (`lh`), then it
                  scrolls: no mask, so nothing is clipped out of reach. No
                  fold, but ref links and the id net apply as everywhere. */}
              <AssistantProse content={stripModelDirectives(last.content)} fold={false} />
            </div>
          ) : (
            <p className={look.message}>{C.noMessageYet}</p>
          )}
          <div className="mt-2 flex flex-col gap-2">
            <QueuedMessages />
            {!streaming && <QuickReplies options={quickReplies} disabled={!engine.initialized} onPick={engine.send} />}
          </div>
        </div>
      )}
    </div>
  );
}
