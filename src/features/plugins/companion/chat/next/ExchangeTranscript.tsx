/**
 * ExchangeTranscript — layer one's conversation, and nothing else.
 *
 * Typography carries provenance (the strategy the owner picked from the
 * Switchboard prototype): her words at `typo-body-lg` in full foreground on a
 * 68ch measure, yours at the same size but medium weight and muted, labels as
 * tracked uppercase kickers, everything machine-made reduced to a strip of
 * coloured ticks with no text at all. Clicking the strip, or the "set aside"
 * line, hands the turn to the nested layer, where there is room to read it.
 */

import { memo, useMemo, useState } from 'react';
import { Brain, ChevronUp, CornerDownRight } from 'lucide-react';
import type { CompanionMessage } from '@/api/companion';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { stripModelDirectives } from '../../athenaLabels';
import { useCompanionStore } from '../../companionStore';
import { AthenaChatTurnActions } from '../AthenaChatTurnActions';
import { buildTurns, MACHINE_TONE, type Turn } from './exchange';
import { NEXT_COPY as C } from './nextCopy';

const PAGE = 12;

export interface ExchangeTranscriptProps {
  messages: CompanionMessage[];
  streaming: boolean;
  interactive: boolean;
  onSend: (text: string) => void;
  /** Open the nested layer on this turn's machine rows / sidecars. */
  onOpenTurn: (turn: Turn) => void;
  /** Open the nested layer on what this turn set aside (approvals, cards). */
  onOpenWaiting: () => void;
  /** Tighter measure for narrow columns. */
  measure?: 'reading' | 'wide';
}

export const ExchangeTranscript = memo(function ExchangeTranscript({
  messages,
  streaming,
  interactive,
  onSend,
  onOpenTurn,
  onOpenWaiting,
  measure = 'reading',
}: ExchangeTranscriptProps) {
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const [shown, setShown] = useState(PAGE);
  const hidden = Math.max(0, turns.length - shown);
  const visible = hidden > 0 ? turns.slice(hidden) : turns;
  const lastReplyId = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const r = turns[i]!.replies;
      if (r.length) return r[r.length - 1]!.id;
    }
    return null;
  }, [turns]);

  return (
    <div className={`mx-auto w-full ${measure === 'reading' ? 'max-w-[74ch]' : 'max-w-[96ch]'} space-y-7`}>
      {hidden > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className="inline-flex items-center gap-1.5 rounded-full border border-foreground/12 px-3 py-1 typo-caption text-foreground/80 hover:bg-foreground/[0.06] focus-ring"
          >
            <ChevronUp className="w-3.5 h-3.5" aria-hidden />
            {C.earlierTurns(hidden)}
          </button>
        </div>
      )}
      {visible.map((turn) => (
        <TurnBlock
          key={turn.id}
          turn={turn}
          lastReplyId={lastReplyId}
          streaming={streaming}
          interactive={interactive}
          onSend={onSend}
          onOpenTurn={onOpenTurn}
          onOpenWaiting={onOpenWaiting}
        />
      ))}
    </div>
  );
});

const TRIGGER_LABEL: Record<Turn['trigger'], string> = {
  user: C.you,
  autonomous: C.autonomousTurn,
  proactive: C.proactiveTurn,
  fleet: C.fleetTurn,
};

function TurnBlock({
  turn,
  lastReplyId,
  streaming,
  interactive,
  onSend,
  onOpenTurn,
  onOpenWaiting,
}: {
  turn: Turn;
  lastReplyId: string | null;
  streaming: boolean;
  interactive: boolean;
  onSend: (text: string) => void;
  onOpenTurn: (turn: Turn) => void;
  onOpenWaiting: () => void;
}) {
  const lastReply = turn.replies[turn.replies.length - 1];
  const summary = useCompanionStore((s) => (lastReply ? s.turnSummaryByEpisodeId[lastReply.id] : undefined));
  const recall = useCompanionStore((s) => (lastReply ? s.recallByEpisodeId[lastReply.id] : undefined));
  const memories = recall
    ? recall.doctrine.length + recall.facts.length + recall.procedurals.length + recall.goals.length + recall.backlog.length
    : 0;
  // A quiet autonomous wake (machine rows, no words) collapses to its strip.
  if (!turn.ask && turn.replies.length === 0 && turn.asides.length === 0 && turn.machine.length === 0) return null;

  return (
    <section className="animate-fade-slide-in" data-testid="athena-next-turn">
      <div className="flex items-baseline gap-3">
        <span
          className={`typo-label uppercase tracking-wider shrink-0 ${
            turn.trigger === 'user' ? 'text-accent' : turn.trigger === 'proactive' ? 'text-brand-purple' : 'text-primary'
          }`}
        >
          {TRIGGER_LABEL[turn.trigger]}
        </span>
        {turn.ask && (
          <p className="typo-body-lg text-muted-foreground whitespace-pre-wrap break-words min-w-0">
            {turn.ask.content}
          </p>
        )}
        <RelativeTime
          timestamp={turn.createdAt}
          className="ml-auto typo-caption text-muted tabular-nums shrink-0"
        />
      </div>

      {turn.asides.map((a, i) => (
        <p key={i} className="mt-2 pl-3 border-l-2 border-foreground/15 typo-body italic text-foreground/70 max-w-[68ch]">
          {a}
        </p>
      ))}

      {turn.replies.map((r) => (
        <div key={r.id} className="mt-3 typo-body-lg text-foreground max-w-[68ch] break-words athena-chat-md">
          <MarkdownRenderer content={stripModelDirectives(r.content)} className="athena-chat-md" codeBlockActions />
        </div>
      ))}

      {(turn.machine.length > 0 || memories > 0 || summary) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {turn.machine.length > 0 && <TickStrip turn={turn} onOpen={() => onOpenTurn(turn)} />}
          {memories > 0 && (
            <Tooltip content={C.memories(memories)}>
              <button
                type="button"
                onClick={() => onOpenTurn(turn)}
                className="inline-flex items-center gap-1 typo-caption text-muted hover:text-foreground focus-ring rounded-interactive"
              >
                <Brain className="w-3.5 h-3.5" aria-hidden />
                {memories}
              </button>
            </Tooltip>
          )}
          {summary && (summary.approvals > 0 || summary.chatCards > 0 || summary.continuation) && (
            <button
              type="button"
              onClick={onOpenWaiting}
              className="inline-flex items-center gap-1.5 typo-caption text-accent hover:underline focus-ring rounded-interactive"
            >
              <CornerDownRight className="w-3.5 h-3.5" aria-hidden />
              {C.movedAside}:{' '}
              {[
                summary.approvals > 0 && C.approvalsN(summary.approvals),
                summary.chatCards > 0 && C.cardsN(summary.chatCards),
                summary.continuation && C.continues,
              ]
                .filter(Boolean)
                .join(' · ')}
            </button>
          )}
        </div>
      )}

      {lastReply && lastReply.id === lastReplyId && !streaming && (
        <div className="mt-3">
          <AthenaChatTurnActions
            content={lastReply.content}
            priorUserMessage={turn.ask?.content ?? ''}
            onSend={onSend}
            disabled={!interactive || streaming}
          />
        </div>
      )}
    </section>
  );
}

/** Machine rows as signal: one 12x5 tick per row, coloured by kind. */
function TickStrip({ turn, onOpen }: { turn: Turn; onOpen: () => void }) {
  const shown = turn.machine.slice(0, 24);
  const extra = turn.machine.length - shown.length;
  return (
    <Tooltip content={C.machineTicks(turn.machine.length)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={C.machineTicks(turn.machine.length)}
        className="group inline-flex items-center gap-1 py-1.5 px-1 -mx-1 rounded-interactive hover:bg-foreground/[0.05] focus-ring"
      >
        {shown.map((m) => (
          <span
            key={m.id}
            className="block w-3 h-[5px] rounded-sm transition-transform group-hover:scale-y-150"
            style={{ background: MACHINE_TONE[m.kind] }}
            aria-hidden
          />
        ))}
        {extra > 0 && <span className="typo-caption text-muted ml-1">+{extra}</span>}
      </button>
    </Tooltip>
  );
}
