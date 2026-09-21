import { AnimatePresence, motion } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DevNote } from '@/lib/bindings/DevNote';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { noteAskBlocked } from '../../../noteGuards';
import { grokCopy } from './copy';
import { Keycap } from './Keycap';

interface Chip {
  keys: string[];
  label: string;
  onClick?: () => void;
}

function HintChip({ chip }: { chip: Chip }) {
  const inner = (
    <span className="inline-flex items-center gap-1.5 px-1.5 py-1 rounded-interactive text-foreground/85">
      {chip.keys.map((k) => (
        <Keycap key={k}>{k}</Keycap>
      ))}
      <span className="typo-caption">{chip.label}</span>
    </span>
  );
  if (!chip.onClick) return inner;
  return (
    <Tooltip content={chip.label}>
      <button
        type="button"
        onClick={chip.onClick}
        className="rounded-interactive hover:bg-secondary/50 focus-ring"
      >
        {inner}
      </button>
    </Tooltip>
  );
}

export function DeskHintRail({
  note,
  pendingReview,
  onFind,
  onHelp,
}: {
  note: DevNote | null;
  pendingReview: boolean;
  onFind: () => void;
  onHelp: () => void;
}) {
  const reduced = useReducedMotion();
  const chips: Chip[] = [
    { keys: ['↑↓←→'], label: grokCopy.hintMove },
    { keys: ['↵'], label: grokCopy.hintOpen },
    { keys: ['/'], label: grokCopy.hintFind, onClick: onFind },
    { keys: ['1–3'], label: grokCopy.hintRails },
  ];
  if (note && !noteAskBlocked(note)) {
    chips.push({ keys: ['a'], label: grokCopy.hintAsk });
  }
  if (note?.status === 'draft' && note.projectId) {
    chips.push({ keys: ['p'], label: grokCopy.hintPublish });
    chips.push({ keys: ['g'], label: grokCopy.hintGoals });
  }
  if (note) {
    chips.push({ keys: ['t'], label: grokCopy.hintThread });
    chips.push({ keys: ['r'], label: grokCopy.hintReply });
  }
  if (pendingReview) {
    chips.push({ keys: ['y'], label: grokCopy.hintYes });
    chips.push({ keys: ['n'], label: grokCopy.hintNo });
  }
  if (note) {
    chips.push({ keys: ['Del'], label: grokCopy.hintDelete });
  }
  chips.push({ keys: ['?'], label: grokCopy.hintHelp, onClick: onHelp });

  return (
    <div
      data-testid="grok-desk-hint-rail"
      className="sticky bottom-0 z-10 -mx-8 px-8 py-2.5 flex items-center gap-1 flex-wrap bg-background/85 backdrop-blur-md border-t border-primary/10"
    >
      <AnimatePresence initial={false}>
        {chips.map((chip) => (
          <motion.span
            key={chip.keys.join('') + chip.label}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
            className="inline-flex"
          >
            <HintChip chip={chip} />
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
