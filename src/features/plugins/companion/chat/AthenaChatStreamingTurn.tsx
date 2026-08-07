/**
 * AthenaChatStreamingTurn — what the user sees while Athena is working.
 *
 * ONE progress surface, on purpose. A CLI turn used to report itself in four
 * places at once — a phase label naming the tool ("Reading files…"), a live
 * narration log of every tool call with durations, an activity-tray task per
 * slow tool, and the plan checklist — which turned "she's thinking" into a
 * scrolling machine readout. Now the bubble says she is working, the typing
 * dots say it is still true, and the Stop control sits right next to them. The
 * only detail that survives is the TodoWrite plan, because that is HER plan for
 * the user's request, not a transcript of her tooling.
 *
 * Her own `PROGRESS:` beats still win over the generic label — those are
 * authored prose, not machine grammar.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from '../companionStore';
import { Bubble } from '../Bubble';
import { OperationalThread } from '../OperationalThread';
import { RecallStrip } from '../RecallStrip';
import { TypingDots } from '../TypingDots';
import type { BrainKind } from '@/api/companion';
import { AthenaChatMessageJobs } from './AthenaChatMessageJobs';
import { AthenaChatSlowNotice } from './AthenaChatSlowNotice';
import { CHAT_EASE } from './athenaChatMorph';

/** Inline stop affordance — lives beside the dots, inside the status line. */
function StopReply({ compact, onClick }: { compact: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const label = t.plugins.companion.stop_turn;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid="companion-stop-turn"
      className={`ml-1 inline-flex items-center gap-1 rounded-full border border-foreground/15 bg-foreground/[0.06] hover:bg-foreground/15 hover:border-foreground/25 text-foreground typo-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 ${
        compact ? 'p-1' : 'pl-1.5 pr-2 py-0.5'
      }`}
    >
      <Square className="w-2.5 h-2.5 shrink-0" fill="currentColor" aria-hidden />
      {!compact && label}
    </button>
  );
}

export function AthenaChatStreamingTurn({
  compact,
  messageCount,
  lastStreamEventAtRef,
  onInterrupt,
  onOpenInBrain,
}: {
  compact: boolean;
  /** Bubble index for the a11y/test attribute — one past the last message. */
  messageCount: number;
  lastStreamEventAtRef: React.MutableRefObject<number>;
  onInterrupt: () => void;
  onOpenInBrain: (kind: BrainKind, id: string) => void;
}) {
  const { t } = useTranslation();
  const streaming = useCompanionStore((s) => s.streaming);
  const streamingBeat = useCompanionStore((s) => s.streamingBeat);
  const streamingRecall = useCompanionStore((s) => s.streamingRecall);
  const streamingSteps = useCompanionStore((s) => s.streamingSteps);
  const pendingConnectorJobIds = useCompanionStore((s) => s.pendingConnectorJobIds);

  return (
    <AnimatePresence initial={false}>
      {streaming && (
        <motion.div
          key="companion-streaming-bubble"
          className="space-y-1"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: CHAT_EASE }}
        >
          {streamingRecall && (
            <RecallStrip preview={streamingRecall} onOpenInBrain={onOpenInBrain} />
          )}
          {/*
            We deliberately do NOT render the live token stream: the
            token-by-token prose reflowed constantly and leaked Athena's machine
            grammar (OP:/QR:/TTS: directives) before the server-side strip. The
            full reply replaces this bubble in one piece when the turn finishes.
            See docs/features/companion/conversation-orchestration.md.
          */}
          <Bubble role="assistant" streaming index={messageCount} compact={compact}>
            <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
              <span>{streamingBeat ?? t.plugins.companion.working}</span>
              <TypingDots />
              <StopReply compact={compact} onClick={onInterrupt} />
            </span>
          </Bubble>
          {streamingSteps.length > 0 && <OperationalThread steps={streamingSteps} />}
          <AthenaChatSlowNotice
            streaming={streaming}
            lastStreamEventAtRef={lastStreamEventAtRef}
          />
          <AthenaChatMessageJobs jobIds={pendingConnectorJobIds} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
