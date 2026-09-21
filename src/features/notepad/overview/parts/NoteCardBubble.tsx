// The newest unread thread entry, springing out of its desk card as a speech
// bubble for 10 s — Read · Approve / Reject · Comment, without opening anything.
//
// Rules (brief § Director decisions + § Risks):
//   - ONE bubble per card. A newer entry replaces the one showing and restarts
//     the clock — except that a system milestone does not bury a review still
//     waiting on the operator (the review is the one with a decision in it).
//   - The clock PAUSES while the pointer is over the bubble or focus is inside
//     it; typing a reason or a reply never races the timeout.
//   - Dismissing (or timing out) does NOT mark the entry read — the unread icon
//     keeps it. "Read" does, because it opens the thread, and opening is reading.
//   - A timed-out bubble is not re-posted to the LiveCommsStack.
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquareReply, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import Button from '@/features/shared/components/buttons/Button';
import type { NoteComment } from '@/lib/bindings/NoteComment';

import { onNoteComment } from '../../thread/noteThreadStore';
import { ReviewVerdictActions, ThreadComposer } from '../../thread/ThreadControls';
import {
  clipThreadBody,
  isPendingReview,
  threadAuthorLabel,
  threadAuthorTone,
  threadEntryLabel,
} from '../../thread/threadLabels';

export const BUBBLE_MS = 10_000;

/**
 * The card's bubble slot: the entry to show, or null. Subscribes to the thread
 * store's arrival feed for this note only; an entry that landed while its thread
 * was on screen (`viewed`) is already read and never bubbles.
 */
export function useCardBubble(noteId: string): { entry: NoteComment | null; dismiss: () => void } {
  const [entry, setEntry] = useState<NoteComment | null>(null);
  useEffect(
    () =>
      onNoteComment(({ comment, viewed }) => {
        if (comment.noteId !== noteId || viewed) return;
        setEntry((prev) => (prev && comment.kind === 'system' && isPendingReview(prev) ? prev : comment));
      }),
    [noteId],
  );
  const dismiss = useCallback(() => setEntry(null), []);
  return { entry, dismiss };
}

/**
 * Keyed by the entry id at the call site, so a replacement remounts the bubble
 * and its clock starts over.
 */
export function NoteCardBubble({
  entry,
  onDismiss,
  onRead,
}: {
  entry: NoteComment;
  onDismiss: () => void;
  /** Open the thread (which marks it read). */
  onRead: () => void;
}) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [replying, setReplying] = useState(false);
  const paused = hovered || focused;

  // The clock: a remaining budget that only runs while unpaused.
  const remaining = useRef(BUBBLE_MS);
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(onDismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, onDismiss]);

  const pending = isPendingReview(entry);
  const body = entry.kind === 'system' ? null : clipThreadBody(entry.bodyMd, 160);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      data-testid={`notepad-card-bubble-${entry.noteId}`}
      data-entry={entry.id}
      data-paused={paused}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.94 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 26 }}
      style={{ transformOrigin: 'bottom center' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className="absolute inset-x-2 bottom-full mb-2.5 z-20"
    >
      <div
        className={`relative flex flex-col gap-1.5 px-3 py-2.5 rounded-card border bg-background/95 backdrop-blur-md shadow-elevation-3 ${
          pending ? 'border-status-warning/40' : 'border-primary/20'
        }`}
      >
        {/* Tail toward the card. */}
        <span
          aria-hidden
          className={`absolute left-6 -bottom-1.5 w-3 h-3 rotate-45 border-b border-r bg-background ${
            pending ? 'border-status-warning/40' : 'border-primary/20'
          }`}
        />
        <div className="flex items-center gap-1.5 min-w-0 typo-caption pr-6">
          <span className={`typo-label truncate ${threadAuthorTone(entry)}`}>{threadAuthorLabel(entry, t.notepad, tx)}</span>
          <span aria-hidden className="text-foreground/85">·</span>
          <span className="truncate text-foreground/85">{threadEntryLabel(entry, t.notepad)}</span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t.notepad.bubble_dismiss}
          data-testid="notepad-card-bubble-dismiss"
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-input flex items-center justify-center text-foreground hover:bg-secondary/50 focus-ring"
        >
          <X className="w-3 h-3" aria-hidden />
        </button>
        {body && <p className="typo-body text-foreground line-clamp-3 break-words">{body}</p>}

        {replying ? (
          <ThreadComposer
            noteId={entry.noteId}
            autoFocus
            testIdPrefix="notepad-card-bubble-comment"
            onSent={onDismiss}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button variant="ghost" size="xs" onClick={onRead} data-testid="notepad-card-bubble-read">
              {t.notepad.bubble_read}
            </Button>
            {pending && (
              <ReviewVerdictActions comment={entry} testIdPrefix="notepad-card-bubble-review" onSettled={onDismiss} />
            )}
            <Button
              variant="ghost"
              size="xs"
              icon={<MessageSquareReply className="w-3.5 h-3.5" />}
              onClick={() => setReplying(true)}
              data-testid="notepad-card-bubble-comment"
            >
              {t.notepad.bubble_comment}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
