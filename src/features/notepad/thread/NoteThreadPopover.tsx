/* eslint-disable custom/enforce-base-modal --
 * An ANCHORED popover over the desk (or the editor's top row), not a centred
 * modal: it owns outside-click + Escape, sits beside the control that opened
 * it, and a BaseModal backdrop / focus trap would hide the card it is about. */
// The note's THREAD as a popover: every entry (reviews, comments, milestones),
// Approve / Reject on a pending review, and a composer at the foot.
//
// One component, two docks: anchored to a desk card's unread icon, and to the
// thread icon in the editor's top row. Opening it IS reading it — the thread is
// marked read and set as the viewed thread, so an entry that lands while it is
// open is read on arrival and never bubbles.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MessagesSquare, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { NoteComment } from '@/lib/bindings/NoteComment';

import { NOTEPAD_POPOVER_Z } from '../notepadLayers';
import { markThreadRead, setViewingThread, useNoteThread } from './noteThreadStore';
import { ReviewVerdictActions, ThreadComposer } from './ThreadControls';
import {
  isPendingReview,
  threadAuthorLabel,
  threadAuthorTone,
  threadEntryLabel,
  threadVerdictLabel,
} from './threadLabels';

const WIDTH = 368;
const GAP = 6;
const MARGIN = 8;
/** Long bodies are clipped here; the thread is a conversation, not a report viewer. */
const BODY_MAX = 1200;
/** Within this many px of the foot counts as "at the foot" for auto-follow. */
const NEAR_BOTTOM_PX = 40;

interface Pos {
  top: number;
  left: number;
}

/** Below the anchor, right edges aligned; flipped above when there is no room. */
function place(anchor: DOMRect, height: number): Pos {
  const left = Math.max(MARGIN, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - MARGIN));
  const below = anchor.bottom + GAP;
  const fitsBelow = below + height + MARGIN <= window.innerHeight;
  const top = fitsBelow || anchor.top - GAP - height < MARGIN ? Math.min(below, window.innerHeight - height - MARGIN) : anchor.top - GAP - height;
  return { top: Math.max(MARGIN, top), left };
}

export function NoteThreadPopover({
  noteId,
  noteTitle,
  anchorRef,
  onClose,
}: {
  noteId: string;
  noteTitle: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const { entries, loading, failed } = useNoteThread(noteId);

  // Opening is reading. `setViewingThread` first, so an entry that lands between
  // the two calls is read on arrival rather than counted.
  useEffect(() => {
    setViewingThread(noteId);
    void markThreadRead(noteId);
    return () => setViewingThread(null);
  }, [noteId]);

  // Measure after paint (the height depends on the entries), then follow the
  // anchor through scroll and resize.
  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      setPos(place(anchor.getBoundingClientRect(), panel.offsetHeight));
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, entries.length, loading]);

  // Newest at the foot, so the list follows new arrivals — but only while the
  // reader is already at the foot (live-log-stream-view.md (g)): someone
  // reading back through a long thread is not yanked down by a new entry. The
  // operator's own post always follows, because they just wrote it.
  const atBottomRef = useRef(true);
  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    atBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= NEAR_BOTTOM_PX;
  };
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ownPost = entries[entries.length - 1]?.authorKind === 'operator';
    if (atBottomRef.current || ownPost) list.scrollTop = list.scrollHeight;
    // Keyed on the count on purpose: a verdict stamped on an existing row is
    // not an arrival and must not move the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  // Outside press and Escape, through the shared dismissal hook. The panel is
  // portalled away from its anchor, so both are "inside" (a press on the anchor
  // is the toggle, never a dismissal). Escape is CLAIMED: the pad's Escape ladder
  // listens on `window` and stops at a handled event, so closing this popover
  // never also steps the pad back a layer.
  const dismissRefs = useMemo(() => [panelRef, anchorRef], [anchorRef]);
  useClickOutside(dismissRefs, true, onClose, { claimEscape: true });

  const showGhost = loading && entries.length === 0;
  const showEmpty = !loading && !failed && entries.length === 0;

  return createPortal(
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label={t.notepad.thread_title}
      data-testid={`notepad-thread-popover-${noteId}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: WIDTH,
        zIndex: NOTEPAD_POPOVER_Z,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="flex flex-col rounded-card border border-primary/20 bg-background/95 backdrop-blur-md shadow-elevation-3"
    >
      <header className="flex items-center gap-2 px-3.5 py-2.5 border-b border-primary/10">
        <MessagesSquare className="w-4 h-4 text-primary shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="typo-label text-foreground">{t.notepad.thread_title}</p>
          <p className="typo-caption text-foreground/85 truncate">{noteTitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          data-testid="notepad-thread-close"
          className="w-7 h-7 rounded-input flex items-center justify-center text-foreground hover:bg-secondary/50 transition-colors focus-ring"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </header>

      <ol ref={listRef} onScroll={onListScroll} className="flex flex-col gap-2 px-3.5 py-3 max-h-96 overflow-y-auto" aria-busy={showGhost}>
        {showGhost &&
          [0, 1, 2].map((i) => (
            <li key={`ghost-${i}`} aria-hidden className="h-14 rounded-card bg-secondary/25" data-testid="notepad-thread-ghost" />
          ))}
        {showEmpty && (
          <li className="flex items-center gap-2 py-3 typo-caption text-foreground/85" data-testid="notepad-thread-empty">
            <MessagesSquare className="w-4 h-4 shrink-0 text-foreground/85" aria-hidden />
            {t.notepad.thread_empty}
          </li>
        )}
        <AnimatePresence initial={false}>
          {entries.map((c) => (
            <motion.li
              key={c.id}
              layout={!reduced}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
            >
              <ThreadEntry comment={c} authorLabel={threadAuthorLabel(c, t.notepad, tx)} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>

      <div className="px-3.5 pb-3 pt-2 border-t border-primary/10">
        <ThreadComposer noteId={noteId} multiline autoFocus testIdPrefix="notepad-thread-composer" />
      </div>
    </motion.div>,
    document.body,
  );
}

/** One entry: who · what · when, the body, and the verdict row for a pending review. */
function ThreadEntry({ comment, authorLabel }: { comment: NoteComment; authorLabel: string }) {
  const { t } = useTranslation();
  const verdict = threadVerdictLabel(comment, t.notepad);
  const pending = isPendingReview(comment);
  const operator = comment.authorKind === 'operator';
  const body = comment.bodyMd.length > BODY_MAX ? `${comment.bodyMd.slice(0, BODY_MAX - 1)}…` : comment.bodyMd;
  return (
    <article
      data-testid={`notepad-thread-entry-${comment.id}`}
      data-kind={comment.kind}
      className={`flex flex-col gap-1.5 px-3 py-2 rounded-card border ${
        pending ? 'border-status-warning/35 bg-status-warning/5' : operator ? 'border-primary/15 bg-primary/5' : 'border-primary/10 bg-secondary/20'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0 typo-caption">
        <span className={`typo-label truncate ${threadAuthorTone(comment)}`}>{authorLabel}</span>
        <span aria-hidden className="text-foreground/85">·</span>
        <span className="text-foreground/85 truncate">{threadEntryLabel(comment, t.notepad)}</span>
        <RelativeTime timestamp={comment.createdAt} format="elapsed" className="ml-auto shrink-0 text-foreground/85 tabular-nums" />
      </div>
      {comment.kind !== 'system' && (
        <p className="typo-body text-foreground whitespace-pre-wrap break-words">{body}</p>
      )}
      {verdict && (
        <span
          className={`self-start px-1.5 rounded-interactive typo-caption ${
            comment.verdict === 'approved'
              ? 'bg-status-success/15 text-status-success'
              : comment.verdict === 'rejected'
                ? 'bg-status-error/15 text-status-error'
                : 'bg-status-warning/15 text-status-warning'
          }`}
        >
          {verdict}
        </span>
      )}
      {pending && <ReviewVerdictActions comment={comment} testIdPrefix={`notepad-thread-review-${comment.id}`} />}
    </article>
  );
}
