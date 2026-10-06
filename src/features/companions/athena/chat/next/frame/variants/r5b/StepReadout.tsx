/**
 * A turn's machine work as an instrument readout. Folded it is one line: the
 * step count and a strip of ticks coloured by kind. Opened it is an aligned
 * table - kind in a fixed mono column, the row's own text beside it - with her
 * PROGRESS asides as her own rows. Never prose, never noise.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { MACHINE_TONE, type Turn } from '../../../exchange';
import { NEXT_COPY as N } from '../../../nextCopy';
import { R5B_COPY as C } from './copy';

interface Row { id: string; label: string; color: string; text: string }

/** Drop the row's own leading tag (`[lookup]`, `[Fleet]`) - the kind column already says it. */
function body(content: string): string {
  return content.trim().replace(/^\[[^\]]{1,40}\]\s*/, '');
}

function rowsOf(turn: Turn): Row[] {
  return [
    ...turn.asides.map((a, i) => ({ id: `aside-${i}`, label: C.athena.toLowerCase(), color: 'var(--primary)', text: a })),
    ...turn.machine.map((m) => ({ id: m.id, label: N.machine[m.kind], color: MACHINE_TONE[m.kind], text: body(m.content) })),
  ];
}

export function StepReadout({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false);
  const rows = rowsOf(turn);
  if (!rows.length) return null;
  return (
    <div data-testid="companion-r5b-steps">
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="companion-r5b-steps-toggle"
        icon={<ChevronRight className={`w-3.5 h-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />}
        className="!px-1.5 -mx-1.5"
      >
        <span className="typo-code text-foreground tabular-nums">{open ? C.hideSteps : C.steps(rows.length)}</span>
        <span className="inline-flex items-center gap-0.5" aria-hidden>
          {rows.slice(0, 16).map((r) => (
            <span key={r.id} className="block w-2.5 h-1 rounded-pill" style={{ background: r.color }} />
          ))}
        </span>
      </Button>
      {open && (
        <dl className="mt-2 grid grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 r5b-gutter pl-3 animate-fade-slide-in motion-reduce:animate-none">
          {rows.map((r) => (
            <div key={r.id} className="contents">
              <dt className="typo-code uppercase whitespace-nowrap" style={{ color: r.color }}>
                {r.label}
              </dt>
              <dd className="typo-code text-foreground [overflow-wrap:anywhere]">{r.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
