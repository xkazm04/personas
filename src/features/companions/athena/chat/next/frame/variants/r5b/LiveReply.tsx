/**
 * Her reply while it streams: the phase readout (what she is doing right now,
 * as one mono word and the tool), her beat line, and the words so far printed
 * at a measured pace with a caret. The printer never lags far behind the
 * stream (it speeds up with the backlog) and under reduced motion the text is
 * simply there, the caret still. Model directives are stripped before display,
 * as on every reply surface.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect, useRef, useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { Square } from 'lucide-react';
import { stripModelDirectives } from '../../../../../athenaLabels';
import { useAthenaStore } from '../../../../../athenaStore';
import { R5B_COPY as C } from './copy';
import { PhaseReadout, phaseOf } from './PhaseReadout';

/** Characters per millisecond: a calm base pace plus a share of the backlog. */
const rate = (backlog: number) => (40 + backlog * 1.5) / 1000;

function useMeasuredReveal(text: string, animate: boolean): number {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  useEffect(() => {
    if (!animate) return;
    // A new turn starts from an empty stream: the printer starts over with it.
    if (shownRef.current > text.length) shownRef.current = 0;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (t: number) => {
      const backlog = text.length - shownRef.current;
      if (backlog <= 0) return;
      carry += (t - last) * rate(backlog);
      last = t;
      const step = Math.floor(carry);
      if (step > 0) {
        carry -= step;
        shownRef.current = Math.min(text.length, shownRef.current + step);
        setShown(shownRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, animate]);
  return animate ? Math.min(shown, text.length) : text.length;
}

export function LiveReply({ animate, onStop }: { animate: boolean; onStop: () => void }) {
  const raw = useAthenaStore((s) => s.streamingText);
  const phase = useAthenaStore((s) => s.streamingPhase);
  const beat = useAthenaStore((s) => s.streamingBeat);
  const text = stripModelDirectives(raw);
  const shown = useMeasuredReveal(text, animate);
  const p = phaseOf(true, phase);
  return (
    <section className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-5" data-testid="companion-r5b-live" aria-busy>
      <div className="pt-1">
        <p className="typo-code uppercase text-primary">{C.athena}</p>
      </div>
      <div className="min-w-0 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PhaseReadout phase={p} animate={animate} />
          {beat && <span className="typo-caption">{beat}</span>}
          <Button variant="accent" tone="error" size="xs" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={onStop} data-testid="companion-stop-turn" className="ml-auto">
            {C.stop}
          </Button>
        </div>
        {text && (
          <p className="typo-body-lg text-foreground whitespace-pre-wrap [overflow-wrap:anywhere] max-w-[68ch]">
            {text.slice(0, shown)}
            <span className={`r5b-caret${animate ? ' live' : ''}`} aria-hidden />
          </p>
        )}
      </div>
    </section>
  );
}
