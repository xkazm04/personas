// "Who is working on this note right now?" — the desk card's presence chip and
// the breathing edge that goes with it.
import { motion } from 'framer-motion';
import { Sparkles, SquareTerminal } from 'lucide-react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import type { NoteWorking } from '../../thread/useNoteWorking';
import { splitElapsedTemplate } from '../../thread/threadLabels';

const TONE = {
  athena: { text: 'text-brand-purple', wash: 'bg-brand-purple/10 border-brand-purple/30', fill: 'bg-brand-purple' },
  fleet: { text: 'text-status-info', wash: 'bg-status-info/10 border-status-info/30', fill: 'bg-status-info' },
} as const;

/**
 * Avatar glyph + label + a TICKING elapsed span. The label is the translation's
 * own `…{elapsed}…` template split around the placeholder, so the live
 * `RelativeTime` sits exactly where the locale put the number.
 */
export function NotePresenceChip({ noteId, working }: { noteId: string; working: NoteWorking }) {
  if (!working.kind || !working.label) return null;
  const tone = TONE[working.kind];
  const Glyph = working.kind === 'athena' ? Sparkles : SquareTerminal;
  const [before, after] = working.since && working.elapsedTemplate ? splitElapsedTemplate(working.elapsedTemplate) : [working.label, ''];
  return (
    <span
      className={`inline-flex items-center gap-1.5 min-w-0 max-w-full h-6 pl-1 pr-2 rounded-interactive border typo-caption ${tone.wash} ${tone.text}`}
      data-testid={`notepad-card-presence-${noteId}`}
      data-kind={working.kind}
    >
      <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${tone.wash}`} aria-hidden>
        <Glyph className="w-3 h-3" />
      </span>
      <span className="truncate">
        {before}
        {working.since && working.elapsedTemplate && (
          <RelativeTime timestamp={working.since} format="elapsed" showTooltip={false} className="tabular-nums" />
        )}
        {after}
      </span>
    </span>
  );
}

/**
 * The top edge while someone works on the note: the status edge is replaced by
 * the worker's colour, breathing. Static under reduced motion — still coloured,
 * so the state reads without the movement.
 */
export function WorkingEdge({ working }: { working: NoteWorking }) {
  const reduced = useReducedMotion();
  if (!working.kind) return null;
  const tone = TONE[working.kind];
  return (
    <motion.span
      aria-hidden
      className={`absolute inset-x-0 top-0 h-1 ${tone.fill} pointer-events-none`}
      initial={{ opacity: 0 }}
      animate={reduced ? { opacity: 0.9 } : { opacity: [0.35, 1, 0.35] }}
      exit={{ opacity: 0 }}
      transition={reduced ? { duration: 0 } : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      data-testid="notepad-card-working-edge"
    />
  );
}
