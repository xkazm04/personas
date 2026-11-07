// The thread's door: an icon with the unread count, opening `NoteThreadPopover`
// anchored to itself. The same control docks on a desk card and in the editor's
// top row, so "open the thread" is one gesture wherever the note is.
import { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessagesSquare } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { useNoteUnread } from './noteThreadStore';
import { NoteThreadPopover } from './NoteThreadPopover';
import Button from '@/features/shared/components/buttons/Button';

export function NoteThreadButton({
  noteId,
  noteTitle,
  open,
  onOpenChange,
  quietWhenRead = false,
  testId,
}: {
  noteId: string;
  noteTitle: string;
  /** Controlled: the owner decides, because a bubble's "Read" opens it too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hide the icon (until hover / focus of a `group` ancestor) while nothing is unread. */
  quietWhenRead?: boolean;
  testId: string;
}) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const unread = useNoteUnread(noteId);
  const ref = useRef<HTMLButtonElement>(null);
  const label =
    unread > 0
      ? tx(unread === 1 ? t.notepad.thread_unread_aria_one : t.notepad.thread_unread_aria_other, { count: unread })
      : t.notepad.thread_open;
  const quiet = quietWhenRead && unread === 0 && !open;

  return (
    <>
      <Tooltip content={label} placement="bottom">
        <Button
          variant="ghost"
          size="xs"
          ref={ref}
          onClick={() => onOpenChange(!open)}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid={testId}
          data-unread={unread}
          className={quiet ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100' : ''}
        >
          <MessagesSquare className="w-3.5 h-3.5" aria-hidden />
          <AnimatePresence initial={false} mode="popLayout">
            {unread > 0 && (
              <motion.span
                key={unread}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }}
                className="typo-data"
                aria-hidden
              >
                {unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </Tooltip>
      {open && (
        <NoteThreadPopover noteId={noteId} noteTitle={noteTitle} anchorRef={ref} onClose={() => onOpenChange(false)} />
      )}
    </>
  );
}
