/**
 * R5 · A — athena chat round 5, variant slot A. A PLACEHOLDER: the round's
 * builder replaces this file with the variant. It takes the same props as
 * `FilamentFrame` and is dispatched by `../../../ChatVariantHost.tsx`.
 *
 * It renders the slot's name and a one-line read of the seeded workforce, so
 * a page-harness shot proves the data reached the slot
 * (`scripts/style/page-harness/athenaChatSurfaces.tsx`).
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { useWorkforce } from '../../../useWorkforce';

const COPY = {
  tab: 'R5 · A',
  empty: 'Round 5 slot A - the variant lands here.',
  read: (turns: number, live: number, waiting: number) => `${turns} messages · ${live} live sessions · ${waiting} waiting`,
} as const;

export function R5AFrame({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  return (
    <div
      className={`fixed inset-x-0 bottom-0 top-[112px] ${lifted ? 'z-[220]' : 'z-[120]'} pointer-events-none flex items-center justify-center`}
      data-testid="companion-panel"
      data-chat-variant="r5a"
    >
      <div className="pointer-events-auto rounded-card border border-primary/20 bg-background/95 shadow-elevation-4 px-8 py-6 flex flex-col gap-2 items-center">
        <span className="typo-title">{COPY.tab}</span>
        <span className="typo-body text-foreground">{COPY.empty}</span>
        <span className="typo-caption">{COPY.read(engine.messages.length, workforce.counts.live, workforce.counts.waiting)}</span>
      </div>
    </div>
  );
}

export default R5AFrame;
