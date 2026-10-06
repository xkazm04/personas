/**
 * StreamingReveal - Athena mid-turn, at the foot of the transcript: her beat
 * (the `PROGRESS:` line she authors, else the phase) as a quiet line, then her
 * words as they arrive, revealed at an even reading pace with a calm caret
 * instead of jumping in whole chunks.
 *
 * The product deliberately never rendered the raw token stream, because it
 * leaked her machine grammar (OP:/QR:/TTS:) before the server-side strip
 * (`AthenaChatStreamingTurn`). This shows it, so it filters first: whole
 * directive lines go through `stripModelDirectives`, a trailing line that
 * could still BECOME a directive is held back until it proves it is prose,
 * and markdown marks resolve to their words. The finished reply then replaces
 * this block through the transcript's own renderer.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect, useMemo, useState } from 'react';
import { Square } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { stripModelDirectives } from '../../../../../athenaLabels';
import { useAthenaStore } from '../../../../../athenaStore';
import { NEXT_COPY as C } from '../../../nextCopy';
import { ISLAND_COPY as I } from './copy';
import { plainWords } from './plainWords';

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

const PHASE: Record<string, string> = { thinking: I.thinking, reviewing: I.reviewing, responding: C.working };

export function StreamingReveal({ onStop }: { onStop: () => void }) {
  const { shouldAnimate } = useMotion();
  const raw = useAthenaStore((s) => s.streamingText);
  const beat = useAthenaStore((s) => s.streamingBeat);
  const phase = useAthenaStore((s) => s.streamingPhase);
  const full = useMemo(() => visible(raw), [raw]);
  const shown = useReveal(full, shouldAnimate);
  const phaseLabel = phase?.kind === 'tool_use' && phase.toolName ? I.using(phase.toolName) : (PHASE[phase?.kind ?? ''] ?? C.working);

  return (
    <section className="animate-fade-slide-in" data-testid="companion-r5a-streaming" aria-busy>
      <div className="flex items-center gap-3">
        <span className="typo-label uppercase tracking-wider text-primary">{C.athena}</span>
        <span className="r5a-beat typo-caption min-w-0">
          <span className="text-foreground whitespace-nowrap">{phaseLabel}</span>
          {beat && <span className="min-w-0">{beat}</span>}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="xs" icon={<Square className="w-3 h-3" fill="currentColor" aria-hidden />} onClick={onStop} data-testid="companion-stop-turn">
          {I.stop}
        </Button>
      </div>
      <p className="mt-3 typo-body-lg text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
        {shown}
        <span className={`r5a-caret${shouldAnimate ? ' is-moving' : ''}`} aria-hidden />
      </p>
    </section>
  );
}
