/**
 * Her phase as an instrument readout: a lamp and one mono word (READY,
 * THINKING, TOOL · BASH, REVIEWING, WRITING), with the age of her last reply
 * when she is at rest. The lamp breathes only while she works.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import type { ReactNode } from 'react';
import type { StreamPhase } from '../../../../../extractStreamPhase';
import { R5B_COPY as C } from './copy';

export interface Phase {
  word: string;
  tool: string | null;
  color: string;
  live: boolean;
}

export function phaseOf(streaming: boolean, phase: StreamPhase | null): Phase {
  if (!streaming) return { word: C.phase.ready, tool: null, color: 'var(--primary)', live: false };
  const color = 'var(--status-info)';
  switch (phase?.kind) {
    case 'thinking':
      return { word: C.phase.thinking, tool: null, color, live: true };
    case 'tool_use':
      return { word: C.phase.tool, tool: phase.toolName ?? null, color, live: true };
    case 'reviewing':
      return { word: C.phase.reviewing, tool: null, color, live: true };
    case 'responding':
      return { word: C.phase.responding, tool: null, color, live: true };
    default:
      return { word: C.phase.working, tool: null, color, live: true };
  }
}

/** One line: lamp, phase word, tool name, and an optional trailing figure. */
export function PhaseReadout({ phase, animate, trail }: { phase: Phase; animate: boolean; trail?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0" data-testid="companion-r5b-phase">
      <span className={`r5b-lamp${phase.live && animate ? ' live' : ''}`} style={{ ['--c' as string]: phase.color }} aria-hidden />
      <span className="typo-code uppercase text-foreground whitespace-nowrap">
        {phase.word}
        {phase.tool && <span className="text-status-info"> · {phase.tool}</span>}
      </span>
      {trail}
    </span>
  );
}
