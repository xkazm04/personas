import { AnimatePresence, motion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DevNote } from '@/lib/bindings/DevNote';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { noteAskBlocked } from '../../noteGuards';
import { DESK_KEY, Keycap } from './Keycap';

interface Chip {
  id: string;
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
      <button type="button" onClick={chip.onClick} className="rounded-interactive hover:bg-secondary/50 focus-ring">
        {inner}
      </button>
    </Tooltip>
  );
}

/**
 * The sticky rail under the grid: the keys that apply to the SELECTED note,
 * right now. Chips come and go with the selection (Ask only when the note can
 * be asked about, Publish / Goals only for a mapped draft, Approve / Reject
 * only while its bubble carries a pending review), so the rail teaches the key
 * map one situation at a time instead of printing all of it.
 */
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
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const chips: Chip[] = [
    { id: 'move', keys: [DESK_KEY.arrows], label: t.notepad.desk_move },
    { id: 'open', keys: [DESK_KEY.enterGlyph], label: t.notepad.desk_hint_open },
    { id: 'find', keys: [DESK_KEY.find], label: t.notepad.desk_hint_find, onClick: onFind },
    { id: 'rails', keys: [DESK_KEY.rails], label: t.notepad.desk_hint_rails },
  ];
  if (note && !noteAskBlocked(note)) {
    chips.push({ id: 'ask', keys: [DESK_KEY.ask], label: t.notepad.desk_hint_ask });
  }
  if (note?.status === 'draft' && note.projectId) {
    chips.push({ id: 'publish', keys: [DESK_KEY.publish], label: t.notepad.desk_hint_publish });
    chips.push({ id: 'goals', keys: [DESK_KEY.goals], label: t.notepad.desk_hint_goals });
  }
  if (note) {
    chips.push({ id: 'thread', keys: [DESK_KEY.thread], label: t.notepad.thread_title });
    chips.push({ id: 'reply', keys: [DESK_KEY.reply], label: t.notepad.desk_hint_reply });
  }
  if (pendingReview) {
    chips.push({ id: 'approve', keys: [DESK_KEY.approve], label: t.notepad.review_approve });
    chips.push({ id: 'reject', keys: [DESK_KEY.reject], label: t.notepad.review_reject });
  }
  if (note) {
    chips.push({ id: 'delete', keys: [DESK_KEY.del], label: t.common.delete });
  }
  chips.push({ id: 'help', keys: [DESK_KEY.help], label: t.notepad.desk_hint_keys, onClick: onHelp });

  return (
    <div
      data-testid="notepad-desk-hint-rail"
      className="sticky bottom-0 z-10 -mx-8 px-8 py-2.5 flex items-center gap-1 flex-wrap bg-background/85 backdrop-blur-md border-t border-primary/10"
    >
      <AnimatePresence initial={false}>
        {chips.map((chip) => (
          <motion.span
            key={chip.id}
            data-testid={`notepad-desk-hint-${chip.id}`}
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
