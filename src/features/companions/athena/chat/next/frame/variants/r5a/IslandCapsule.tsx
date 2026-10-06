/**
 * IslandCapsule - the island at rest: her mark, ONE label, the human gate and
 * the key that opens her. Everything here is a label, never a cut sentence:
 * "Running Bash", "Working on 5", or the conversation's own name. Her last
 * words sit behind the capsule as its tooltip, as plain text (ref links and
 * markdown resolved to their words, never shown raw).
 *
 * Typing while the capsule holds focus opens the conversation with that
 * character already in the composer, so the capsule IS the input's first
 * keystroke.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { forwardRef, type KeyboardEvent } from 'react';
import { Hand } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { IslandMark } from './IslandMark';
import { ISLAND_COPY as I } from './copy';

export interface CapsuleRead {
  label: string;
  /** She is mid-turn: the mark's ring sweeps. */
  working: boolean;
  /** Items blocked on the operator. */
  gated: number;
  /** Her latest reply as plain text, for the tooltip. */
  lastWords: string | null;
}

export const IslandCapsule = forwardRef<
  HTMLButtonElement,
  { read: CapsuleRead; onOpen: (seed?: string) => void; onOpenGate: () => void }
>(function IslandCapsule({ read, onOpen, onOpenGate }, ref) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.key === ' ') return;
    e.preventDefault();
    onOpen(e.key);
  };
  const capsule = (
    <Button
      ref={ref}
      variant="ghost"
      className="r5a-cap"
      onClick={() => onOpen()}
      onKeyDown={onKeyDown}
      aria-label={`${I.island}: ${read.label}. ${I.openChat}`}
      aria-keyshortcuts="Alt+C"
      data-testid="companion-r5a-island"
    >
      <IslandMark working={read.working} gated={read.gated > 0} />
      <span className={`typo-title r5a-cap-label${read.working ? '' : ' text-foreground'}`}>{read.label}</span>
    </Button>
  );
  return (
    <span className="flex items-center gap-1.5 pr-2 h-11">
      {read.lastWords ? (
        <Tooltip content={<span className="typo-body block max-w-[52ch]">{read.lastWords}</span>} placement="top" delay={400}>
          {capsule}
        </Tooltip>
      ) : (
        capsule
      )}
      {read.gated > 0 && (
        <Button
          variant="ghost"
          className="r5a-gate"
          onClick={onOpenGate}
          aria-label={`${I.gate(read.gated)}, ${I.keyWork}`}
          aria-keyshortcuts="Alt+W"
          data-testid="companion-r5a-island-gate"
        >
          <Hand aria-hidden />
          <span className="typo-data">{read.gated}</span>
        </Button>
      )}
      <span className="r5a-kbd typo-caption" aria-hidden>
        {I.keyChat}
      </span>
    </span>
  );
});
