/**
 * Fusion · Athena mid-turn, at the foot of the transcript, on the same x-axis
 * grid as a finished turn. R5 · A's smooth reveal: her beat (the `PROGRESS:`
 * line she authors, else the phase) as a quiet line, then her words as they
 * arrive at an even reading pace with a calm caret. Plus Current's live
 * pieces under it: what she recalled (`RecallStrip`), her plan
 * (`OperationalThread`), connector jobs in flight and the slow-turn notice.
 *
 * The product never rendered the raw token stream because it leaked machine
 * grammar (OP:/QR:/TTS:); this filters first - whole directive lines through
 * `stripModelDirectives`, a trailing line that could still BECOME one held
 * back - and markdown marks resolve to their words.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Square } from 'lucide-react';
import type { BrainKind } from '@/api/companion';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { stripModelDirectives } from '../../../../../athenaLabels';
import { useAthenaStore } from '../../../../../athenaStore';
import { OperationalThread } from '../../../../../OperationalThread';
import { RecallStrip } from '../../../../../RecallStrip';
import { AthenaChatMessageJobs } from '../../../../AthenaChatMessageJobs';
import { AthenaChatSlowNotice } from '../../../../AthenaChatSlowNotice';
import { NEXT_COPY as C } from '../../../nextCopy';
import { FUSION_COPY as F } from './copy';
import { plainWords } from './text';

const DIRECTIVE_PREFIX = /^(?:O|OP|Q|QR|T|TT|TTS|P|PR|PRO|PROG|PROGR|PROGRE|PROGRES|PROGRESS|\{)$/;

function visible(raw: string): string {
  const text = stripModelDirectives(raw);
  const cut = text.lastIndexOf('\n');
  const tail = text.slice(cut + 1).trim();
  const held = DIRECTIVE_PREFIX.test(tail) ? text.slice(0, Math.max(0, cut)) : text;
  return plainWords(held);
}

/** Characters revealed so far, easing toward the full length: even pace, catches up on bursts. */
function useReveal(full: string, animate: boolean): string {
  const [n, setN] = useState(0);
  const [prev, setPrev] = useState(full);
  if (full !== prev) {
    setPrev(full);
    // A new turn (the text no longer extends what was shown) restarts the reveal.
    if (!full.startsWith(prev.slice(0, n))) setN(0);
  }
  useEffect(() => {
    if (!animate || n >= full.length) return;
    const id = requestAnimationFrame(() => {
      const backlog = full.length - n;
      setN((v) => Math.min(full.length, v + Math.max(1, Math.ceil(backlog / 18))));
    });
    return () => cancelAnimationFrame(id);
  }, [animate, n, full]);
  return animate ? full.slice(0, n) : full;
}

const PHASE: Record<string, string> = { thinking: F.thinking, reviewing: F.reviewing, responding: C.working };

export function StreamingTurn({
  onStop,
  onOpenInBrain,
  lastStreamEventAtRef,
}: {
  onStop: () => void;
  onOpenInBrain: (kind: BrainKind, id: string) => void;
  lastStreamEventAtRef: MutableRefObject<number>;
}) {
  const { shouldAnimate } = useMotion();
  const streaming = useAthenaStore((s) => s.streaming);
  const raw = useAthenaStore((s) => s.streamingText);
  const beat = useAthenaStore((s) => s.streamingBeat);
  const phase = useAthenaStore((s) => s.streamingPhase);
  const recall = useAthenaStore((s) => s.streamingRecall);
  const steps = useAthenaStore((s) => s.streamingSteps);
  const jobs = useAthenaStore((s) => s.pendingConnectorJobIds);
  const full = useMemo(() => visible(raw), [raw]);
  const shown = useReveal(full, shouldAnimate);
  const phaseLabel = phase?.kind === 'tool_use' && phase.toolName ? F.using(phase.toolName) : (PHASE[phase?.kind ?? ''] ?? C.working);

  return (
    <section className="fu-turn animate-fade-slide-in" data-testid="companion-fusion-streaming" aria-busy>
      <span className="fu-who is-sticky">
        <span className="fu-who-her">
          <span className={`fu-face-sm is-live${shouldAnimate ? ' is-moving' : ''}`} aria-hidden />
          <span className="typo-label text-primary">{F.athena}</span>
        </span>
      </span>
      <div className="fu-said">
        {recall && <RecallStrip preview={recall} onOpenInBrain={onOpenInBrain} />}
        <div className="fu-beat">
          {/* The phase leads her beat on the same line; alone, it IS the line. */}
          {beat && <span className="typo-caption fu-when">{phaseLabel}</span>}
          <span className="typo-body min-w-0">{beat ?? phaseLabel}</span>
          <Button
            variant="ghost"
            size="xs"
            icon={<Square className="w-3 h-3" fill="currentColor" aria-hidden />}
            onClick={onStop}
            data-testid="companion-stop-turn"
          >
            {F.stop}
          </Button>
        </div>
        {shown && (
          <p className="typo-body-lg text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
            {shown}
            <span className={`fu-caret${shouldAnimate ? ' is-moving' : ''}`} aria-hidden />
          </p>
        )}
        {steps.length > 0 && <OperationalThread steps={steps} />}
        <AthenaChatMessageJobs jobIds={jobs} />
        <AthenaChatSlowNotice streaming={streaming} lastStreamEventAtRef={lastStreamEventAtRef} />
      </div>
    </section>
  );
}
