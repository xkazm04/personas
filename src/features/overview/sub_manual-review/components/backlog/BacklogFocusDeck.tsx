// Focus mode — the swipe deck the Backlog absorbed from the deleted Dev Tools
// Idea Triage page.
//
// The one structural change from the original: the deck no longer owns a data
// path. It renders the SAME filtered + sorted pending rows the table is showing
// (BacklogPanel derives them once and hands them to both), so switching
// Table ⇄ Focus can never change which items are in play — it only changes how
// you decide on them.
//
// Keyboard resolution (see BacklogDetailModal for the other half): the deck
// keeps ←/A reject and →/Z accept, because here the arrows ARE the verdict.
// The modal, a reading surface, walks the queue with ←/→ and decides on A/R.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Hammer, ScanSearch, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';

import * as devApi from '@/api/devTools/devTools';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { TriageCounts } from '@/lib/bindings/TriageCounts';

import { SwipeCard } from './SwipeCard';
import type { BacklogIdea } from './backlogModel';

/** How many cards are rendered at once — one live, two for depth. */
const STACK_DEPTH = 3;
/** Below this, a session is too trivial to celebrate. */
const MIN_SESSION_FOR_SUMMARY = 3;

export function BacklogFocusDeck({
  rows,
  counts,
  categoryLabel,
  busy,
  onAccept,
  onReject,
  onDelete,
}: {
  /** Pending rows, already filtered and ordered exactly as the table shows them. */
  rows: BacklogIdea[];
  counts: TriageCounts | null;
  categoryLabel: (key: string) => string;
  busy: boolean;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const r = t.overview.review;
  const addToast = useToastStore((s) => s.addToast);

  // Always act on the LATEST top card. A ref (rather than a dep) keeps the
  // keydown listener stable, so a rapid double-tap can't be swallowed by an
  // effect teardown/re-register racing the verdict that caused it.
  const pendingRef = useRef(rows);
  pendingRef.current = rows;

  const swipe = useCallback((direction: 'left' | 'right') => {
    const idea = pendingRef.current[0];
    if (!idea) return;
    void (direction === 'right' ? onAccept(idea.id) : onReject(idea.id));
  }, [onAccept, onReject]);

  const removeTop = useCallback(() => {
    const idea = pendingRef.current[0];
    if (!idea) return;
    void onDelete(idea.id);
  }, [onDelete]);

  // "Build now": queue a linked implementation task AND accept, in one move —
  // the direct idea→task path for obvious wins.
  const buildNow = useCallback(async () => {
    const idea = pendingRef.current[0];
    if (!idea) return;
    try {
      await devApi.createTask(idea.title, idea.projectId ?? undefined, idea.description, idea.id);
      addToast(r.backlog_build_queued, 'success');
      await onAccept(idea.id);
    } catch (err) {
      toastCatch('BacklogFocusDeck:buildNow')(err);
    }
  }, [addToast, r.backlog_build_queued, onAccept]);

  // Stable handler: ←/A reject, →/Z accept. Ignored inside text fields and
  // whenever a modifier is held (those belong to the browser / the app shell).
  //
  // On the app keyboard registry at route level rather than on `window`: this
  // deck stays mounted underneath the full-app triage deck, and a bare listener
  // meant `←` there rejected a backlog idea here too — invisibly, behind an
  // opaque overlay. `A` / `Z`, which the triage deck does not even bind, leaked
  // the same way, which is why the overlay claims the keyboard exclusively
  // rather than key-by-key. Unchanged when nothing is layered over the route.
  useAppKeyboard(
    (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) {
        return false;
      }

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        swipe('left');
        return true;
      }
      if (e.key === 'ArrowRight' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        swipe('right');
        return true;
      }
      return false;
    },
    { priority: ROUTE_DECISION_PRIORITY },
  );

  // End-of-session summary. Snapshot the decided counts the first time real
  // counts arrive; when pending later hits zero after a non-trivial run, fire
  // exactly one celebratory toast.
  const [start, setStart] = useState<{ accepted: number; rejected: number; at: number } | null>(null);
  const [fired, setFired] = useState(false);
  useEffect(() => {
    if (start || !counts) return;
    setStart({ accepted: counts.accepted, rejected: counts.rejected, at: Date.now() });
  }, [start, counts]);
  useEffect(() => {
    if (fired || !start || !counts || counts.pending !== 0) return;
    const accepted = counts.accepted - start.accepted;
    const rejected = counts.rejected - start.rejected;
    const total = accepted + rejected;
    if (total < MIN_SESSION_FOR_SUMMARY) return;
    const minutes = Math.max(1, Math.round((Date.now() - start.at) / 60000));
    addToast(tx(r.backlog_session_summary, { total, accepted, rejected, minutes }), 'success');
    setFired(true);
  }, [fired, start, counts, addToast, tx, r.backlog_session_summary]);

  const total = counts?.total ?? rows.length;
  const decided = Math.max(0, total - (counts?.pending ?? rows.length));
  const stack = rows.slice(0, STACK_DEPTH);

  return (
    <div className="h-full min-h-0 flex flex-col items-center justify-center gap-6 py-4 overflow-y-auto">
      {total > 0 && (
        <div className="w-full max-w-lg">
          <div className="flex items-center justify-between typo-caption text-muted-foreground mb-1.5">
            <span>{tx(r.backlog_deck_remaining, { count: rows.length })}</span>
            <span>{tx(r.backlog_deck_reviewed, { done: decided, total })}</span>
          </div>
          <div className="w-full h-1.5 bg-primary/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-300"
              style={{ width: `${total > 0 ? (decided / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
            <ScanSearch className="w-7 h-7 text-amber-400/50" />
          </div>
          <p className="typo-body text-foreground mb-1">{r.backlog_deck_empty_title}</p>
          <p className="typo-caption text-muted-foreground">{r.backlog_deck_empty_subtitle}</p>
        </div>
      ) : (
        <>
          <div className="relative w-full max-w-lg" style={{ height: 420 }}>
            <AnimatePresence>
              {stack.map((idea, i) => (
                <SwipeCard
                  key={idea.id}
                  idea={idea}
                  isTop={i === 0}
                  stackIndex={i}
                  categoryLabel={categoryLabel}
                  onSwipe={swipe}
                />
              ))}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-4">
            <motion.button
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              disabled={busy}
              onClick={() => swipe('left')}
              className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              title={r.backlog_deck_reject_title}
              aria-label={r.backlog_deck_reject_title}
            >
              <ThumbsDown className="w-5 h-5 text-red-400" />
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              disabled={busy}
              onClick={removeTop}
              className="w-10 h-10 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center hover:bg-primary/15 disabled:opacity-40 transition-colors"
              title={r.backlog_deck_delete_title}
              aria-label={r.backlog_deck_delete_title}
            >
              <Trash2 className="w-4 h-4 text-foreground" />
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              disabled={busy}
              onClick={() => void buildNow()}
              className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
              title={r.backlog_build_now_title}
              aria-label={r.backlog_build_now_title}
            >
              <Hammer className="w-4 h-4 text-amber-400" />
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              disabled={busy}
              onClick={() => swipe('right')}
              className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
              title={r.backlog_deck_accept_title}
              aria-label={r.backlog_deck_accept_title}
            >
              <ThumbsUp className="w-5 h-5 text-emerald-400" />
            </motion.button>
          </div>

          <p className="typo-caption text-muted-foreground flex items-center gap-3">
            <span className="flex items-center gap-1">
              <ChevronLeft className="w-3 h-3" aria-hidden /> / A = {r.backlog_deck_hint_reject}
            </span>
            <span className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3" aria-hidden /> / Z = {r.backlog_deck_hint_accept}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
