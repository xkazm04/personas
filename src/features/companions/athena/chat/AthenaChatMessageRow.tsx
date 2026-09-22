/**
 * AthenaChatMessageRow — one transcript row and everything pinned under it.
 *
 * `memo`'d, and that is the point: a long conversation keeps dozens of
 * `MarkdownRenderer`s mounted, and the chat body re-renders on every store
 * write a turn produces. With stable props (store objects, primitives, and
 * `useCallback` handlers) an unchanged row skips its whole subtree.
 *
 * Anything that would break memoization is deliberately NOT a prop here — job
 * rows and the last-turn actions read what they need themselves. See
 * `AthenaChatMessageJobs` / `AthenaChatTurnActions`.
 */

import { memo } from 'react';
import type {
  BrainKind,
  CompanionMessage,
  CompanionRecallPreview,
} from '@/api/companion';
import { Bubble } from '../Bubble';
import { OperationalThread } from '../OperationalThread';
import { RecallStrip } from '../RecallStrip';
import { TurnSummaryChip } from '../TurnSummaryChip';
import type { TodoStep } from '../operationalSteps';
import type { StoredTurnSummary } from '../companionStore';
import { systemMarkerOf } from '../systemMarkers';
import { AthenaChatCanvasNote } from './AthenaChatCanvasNote';
import { AthenaChatMessageJobs } from './AthenaChatMessageJobs';
import { AthenaChatSystemNote } from './AthenaChatSystemNote';
import { AthenaChatTurnActions } from './AthenaChatTurnActions';
import { parseCanvasNote } from './athenaChatCanvasSummary';

export type TurnSummaryJumpTarget = 'approvals' | 'chatCards' | 'dashboard' | 'cockpit';

export interface AthenaChatMessageRowProps {
  message: CompanionMessage;
  /** Absolute index in the full transcript — stable across window expansion. */
  index: number;
  compact: boolean;
  /** First message of a consecutive same-kind run — shows the avatar. */
  groupStart: boolean;
  groupEnd: boolean;
  /** Localized day label when this row opens a new calendar day. */
  daySepLabel: string | null;
  recall: CompanionRecallPreview | undefined;
  steps: TodoStep[] | undefined;
  summary: StoredTurnSummary | undefined;
  /** Connector/background jobs attached to this episode. Stable empty array. */
  jobIds: string[];
  /** This is the newest assistant reply — it carries the turn actions. */
  isLastAssistant: boolean;
  /** The user message directly above it, for refine chips. */
  priorUserMessage: string;
  streaming: boolean;
  interactive: boolean;
  onOpenInBrain: (kind: BrainKind, id: string) => void;
  onJumpSummary: (target: TurnSummaryJumpTarget) => void;
  onSend: (text: string) => void;
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-1" data-testid="companion-day-separator">
      <div className="flex-1 h-px bg-foreground/10" aria-hidden />
      <span className="rounded-full bg-foreground/[0.06] border border-foreground/10 px-2.5 py-0.5 typo-caption text-foreground">
        {label}
      </span>
      <div className="flex-1 h-px bg-foreground/10" aria-hidden />
    </div>
  );
}

export const AthenaChatMessageRow = memo(function AthenaChatMessageRow({
  message,
  index,
  compact,
  groupStart,
  groupEnd,
  daySepLabel,
  recall,
  steps,
  summary,
  jobIds,
  isLastAssistant,
  priorUserMessage,
  streaming,
  interactive,
  onOpenInBrain,
  onJumpSummary,
  onSend,
}: AthenaChatMessageRowProps) {
  // A system row is one of four things (see `systemMarkers` /
  // `athenaChatSystemKind`). Markers stay with `Bubble`, which draws them as
  // dividers; a `[canvas]` readback becomes its one-line summary; everything
  // else is app-authored content and gets the margin-note treatment rather
  // than an assistant-shaped bubble with Athena's face beside text she never
  // wrote. The episode bodies themselves are untouched — this is display only.
  const isSystem = message.role === 'system';
  const canvasNote = isSystem ? parseCanvasNote(message.content) : null;
  const isSystemNote = isSystem && !canvasNote && !systemMarkerOf(message.content);

  return (
    <div className={`animate-fade-slide-in ${compact ? 'space-y-0.5' : 'space-y-1'}`}>
      {daySepLabel && <DaySeparator label={daySepLabel} />}
      {canvasNote ? (
        <AthenaChatCanvasNote note={canvasNote} />
      ) : isSystemNote ? (
        <AthenaChatSystemNote content={message.content} compact={compact} index={index} />
      ) : (
        <>
          {recall && <RecallStrip preview={recall} onOpenInBrain={onOpenInBrain} />}
          <Bubble
            role={message.role}
            index={index}
            onOpenInBrain={onOpenInBrain}
            createdAt={message.createdAt}
            groupStart={groupStart}
            groupEnd={groupEnd}
            compact={compact}
          >
            {message.content}
          </Bubble>
          {steps && steps.length > 0 && <OperationalThread steps={steps} />}
          <AthenaChatMessageJobs jobIds={jobIds} />
          {summary && <TurnSummaryChip summary={summary} onJump={onJumpSummary} />}
          {isLastAssistant && !streaming && (
            <AthenaChatTurnActions
              content={message.content}
              priorUserMessage={priorUserMessage}
              onSend={onSend}
              disabled={!interactive || streaming}
            />
          )}
        </>
      )}
    </div>
  );
});
