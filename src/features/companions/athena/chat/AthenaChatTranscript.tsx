/**
 * AthenaChatTranscript — the message list.
 *
 * Owns three things the rest of the chat should not have to think about:
 *  1. **Windowing.** Only the last N rounds are mounted (`athenaChatWindow`);
 *     everything older is one click (or one scroll) away.
 *  2. **Grouping.** Consecutive same-kind messages share an avatar gutter, and
 *     each new calendar day gets a separator.
 *  3. **Stable row props.** Every value handed to a `memo`'d row is either a
 *     primitive, a store object, or a `useCallback` — nothing freshly built.
 */

import { memo, useCallback, useMemo } from 'react';
import { ChevronUp } from 'lucide-react';
import type { BrainKind, CompanionMessage } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from '../companionStore';
import { daySeparatorLabel, startsNewDay } from './athenaChatDay';
import {
  AthenaChatMessageRow,
  type TurnSummaryJumpTarget,
} from './AthenaChatMessageRow';

/** Shared identity for "this turn spawned no jobs" — keeps rows memo-stable. */
const NO_JOBS: string[] = [];

/**
 * A PROGRESS aside is `role=assistant` but a distinct visual kind, so a real
 * reply after an aside still shows its avatar (and asides cluster together).
 */
function messageKind(msg: CompanionMessage | undefined): string {
  if (!msg) return '';
  if (msg.role === 'assistant' && msg.content.trimStart().startsWith('PROGRESS:')) {
    return 'assistant-aside';
  }
  return msg.role;
}

export interface AthenaChatTranscriptProps {
  /** The windowed slice to render. */
  messages: CompanionMessage[];
  /** Index of `messages[0]` within the full transcript. */
  offset: number;
  /** Loaded-but-hidden messages above the window. */
  hiddenCount: number;
  onShowEarlier: () => void;
  compact: boolean;
  streaming: boolean;
  interactive: boolean;
  onOpenInBrain: (kind: BrainKind, id: string) => void;
  onJumpSummary: (target: TurnSummaryJumpTarget) => void;
  onSend: (text: string) => void;
}

export const AthenaChatTranscript = memo(function AthenaChatTranscript({
  messages,
  offset,
  hiddenCount,
  onShowEarlier,
  compact,
  streaming,
  interactive,
  onOpenInBrain,
  onJumpSummary,
  onSend,
}: AthenaChatTranscriptProps) {
  const { t, tx } = useTranslation();
  const recallByEpisodeId = useCompanionStore((s) => s.recallByEpisodeId);
  const turnSummaryByEpisodeId = useCompanionStore((s) => s.turnSummaryByEpisodeId);
  const stepsByEpisodeId = useCompanionStore((s) => s.stepsByEpisodeId);
  const connectorJobIdsByEpisodeId = useCompanionStore(
    (s) => s.connectorJobIdsByEpisodeId,
  );

  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  const dayLabel = useCallback(
    (iso: string) =>
      daySeparatorLabel(
        iso,
        t.plugins.companion.day_today,
        t.plugins.companion.day_yesterday,
      ),
    [t],
  );

  return (
    <>
      {hiddenCount > 0 && (
        <div className="flex justify-center py-1">
          <button
            type="button"
            onClick={onShowEarlier}
            data-testid="companion-show-earlier"
            data-hidden-count={hiddenCount}
            className="inline-flex items-center gap-1.5 rounded-full border border-foreground/12 bg-foreground/[0.04] hover:bg-foreground/[0.08] px-3 py-1 typo-caption text-foreground transition-colors focus-ring"
          >
            <ChevronUp className="w-3 h-3" aria-hidden />
            {tx(
              hiddenCount === 1
                ? t.plugins.companion.transcript_earlier_one
                : t.plugins.companion.transcript_earlier_other,
              { count: hiddenCount },
            )}
          </button>
        </div>
      )}
      {messages.map((m, i) => {
        const prev = i > 0 ? messages[i - 1] : undefined;
        const next = i < messages.length - 1 ? messages[i + 1] : undefined;
        const myKind = messageKind(m);
        const isAssistant = m.role === 'assistant';
        const isLastAssistant = isAssistant && i === lastAssistantIdx;
        return (
          <AthenaChatMessageRow
            key={m.id}
            message={m}
            index={offset + i}
            compact={compact}
            groupStart={!prev || messageKind(prev) !== myKind}
            groupEnd={!next || messageKind(next) !== myKind}
            daySepLabel={
              startsNewDay(m.createdAt, prev?.createdAt) && m.createdAt
                ? dayLabel(m.createdAt)
                : null
            }
            recall={isAssistant ? recallByEpisodeId[m.id] : undefined}
            steps={isAssistant ? stepsByEpisodeId[m.id] : undefined}
            summary={isAssistant ? turnSummaryByEpisodeId[m.id] : undefined}
            jobIds={
              (isAssistant ? connectorJobIdsByEpisodeId[m.id] : undefined) ?? NO_JOBS
            }
            isLastAssistant={isLastAssistant}
            priorUserMessage={
              isLastAssistant && prev?.role === 'user' ? prev.content : ''
            }
            streaming={streaming}
            interactive={interactive}
            onOpenInBrain={onOpenInBrain}
            onJumpSummary={onJumpSummary}
            onSend={onSend}
          />
        );
      })}
    </>
  );
});
