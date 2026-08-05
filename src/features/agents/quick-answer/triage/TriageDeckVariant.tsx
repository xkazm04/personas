/**
 * TriageDeckVariant — "momentum triage": one decision at a time, embodied.
 *
 * The reviewer holds a stack of cards and flicks through it. There is no queue
 * list, no detail rail, no second column — the design bet is that a triage
 * surface which shows you everything you have left is a triage surface you
 * never finish. This is the variant for clearing forty items in five minutes:
 * a card, two directions, and a keyboard that never makes you look down.
 *
 * The physics are ported from the app's existing swipe deck (`SwipeCard` /
 * `BacklogFocusDeck`) rather than re-invented, so the gesture a reviewer
 * already knows from the Backlog transfers here unchanged. `deck/TriageCard`
 * documents every constant and the two bugs the port deliberately does not
 * inherit; `deck/useDeckControls` owns verdict dispatch and the keyboard.
 *
 * Question items are the interesting exception: they collect an answer rather
 * than a verdict, so their cards are undraggable — see `deck/QuestionPanel`.
 *
 * This surface REPLACED the 576px anchored Quick Answer popover: the same
 * title-bar button now opens the deck over the whole app. `QuickAnswerBody` and
 * its children survive because two other surfaces still render them (the
 * channel-timeline rail and the reviews rail) — only the popover shell is gone.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import { DeckActionBar, DeckFlank } from './deck/DeckActionBar';
import { kindCopy } from './deck/DeckChips';
import { DeckQueueRail } from './deck/DeckQueueRail';
import { DeckCleared, DeckLoading } from './deck/DeckStates';
import { DeckTopBar } from './deck/DeckTopBar';
import { QuestionPanel } from './deck/QuestionPanel';
import { ReasonStrip } from './deck/ReasonStrip';
import { TriageCard } from './deck/TriageCard';
import { useDeckControls } from './deck/useDeckControls';
import { TRIAGE_KINDS } from './triageTypes';
import type { UnifiedTriageQueue } from './useUnifiedTriage';

/** One live card, two for depth. More is just paint. */
const STACK_DEPTH = 3;

export function TriageDeckVariant({
  queue,
  onClose,
  onOpenMonitor,
  title,
}: {
  queue: UnifiedTriageQueue;
  onClose: () => void;
  onOpenMonitor?: () => void;
  /** Surface title — supplied translated by the host. */
  title: string;
}) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const {
    top,
    containerRef,
    scrollerRef,
    lastVerdict,
    answers,
    setAnswer,
    cardRef,
    textareaRef,
    commit,
    decideTop,
    submitAnswers,
    fireBranch,
    followLink,
    capture,
    reasonDraft,
    setReasonDraft,
    resolveReason,
    canAccept,
  } = useDeckControls(queue, onClose);

  /**
   * The deck's ONE live region.
   *
   * Composed rather than rendered inline so it starts EMPTY: a live region that
   * already has its text on first paint is not a change, and most screen
   * readers will not speak it. Filling it one commit later makes the first card
   * announce like every card after it.
   */
  const spoken = [
    lastVerdict ? tx(t.monitor.triage_announce_verdict, { verdict: lastVerdict }) : null,
    top ? tx(t.monitor.triage_announce_card, { kind: kindCopy(t, top.kind).one, title: top.title }) : null,
  ]
    .filter(Boolean)
    .join(' ');
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => setAnnouncement(spoken), [spoken]);

  const stack = queue.items.slice(0, STACK_DEPTH);
  const showLoading = queue.loading && stack.length === 0;
  // "You filtered it away" and "you finished" are different endings.
  const filteredOut = TRIAGE_KINDS.some((k) => !queue.activeKinds.has(k) && queue.allCounts[k] > 0);

  return (
    // A real dialog, not a bare section. It covers the whole app below the
    // title bar with an opaque background, so `role="dialog"` + `aria-modal`
    // are simply the truth — and they are what stops a screen reader walking
    // the route still rendered underneath. The trap, the first focus and the
    // restore-to-trigger live in `useDeckDialog` (BaseModal's approach; see
    // that file for why BaseModal itself is not reused here).
    <motion.section
      ref={containerRef}
      // eslint-disable-next-line custom/enforce-base-modal -- full-app surface pinned under the title bar: no backdrop, no centred panel, no modal-stack position, and its own Escape grammar (Esc blurs a field, then resolves an open reason prompt, then closes). BaseModal's approach IS reused — see useDeckDialog.
      role="dialog"
      aria-modal="true"
      className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col bg-background"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      aria-label={t.monitor.triage_deck_aria}
      data-testid="triage-deck-variant"
    >
      {/* ONE polite region for the whole surface: what was just recorded, then
          what is now being asked. Replaces the two permanent `role="status"`
          stamps that used to announce "Reject… Approve" on every deal. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <DeckTopBar queue={queue} title={title} onOpenMonitor={onOpenMonitor} onClose={onClose} />

      <div className="relative flex min-h-0 flex-1">
        {/* The queue, previewable but never decidable — see `DeckQueueRail`.
            It reads the DEALT order, so what it lists is exactly what the deck
            will hand over next, and a click pins a row to the front without
            touching the keyboard's contract with the top card. */}
        <DeckQueueRail items={queue.items} skips={queue.skips} onJump={queue.focusItem} />

        <div className="relative flex min-h-0 flex-1 items-center justify-center gap-6 px-6 py-8 xl:gap-12">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/5 to-transparent"
          aria-hidden
        />

        {showLoading ? (
          <DeckLoading reduced={reduced} />
        ) : !top ? (
          <DeckCleared
            decided={queue.decidedCount}
            summary={queue.summary}
            filtered={filteredOut}
            // "You cleared the batch" and "you cleared the queue" are different
            // endings, and until now the deck told the same story for both.
            remaining={queue.backlog.hasMore ? queue.backlog.pending - queue.backlog.loaded : 0}
            reduced={reduced}
            onReload={queue.reload}
            onLoadMore={queue.loadMore}
          />
        ) : (
          <>
            {/* Both flanks go inert while a reason is being asked for: the
                verdict is already committed and a second one has nowhere to go. */}
            <DeckFlank
              tone="danger"
              icon={ThumbsDown}
              label={top.verdictLabels.reject}
              disabled={!!capture}
              onClick={() => decideTop('reject')}
            />

            {/* Widened from 42rem: the card carries markdown prose, and the
                extra measure is what the docked ledger's single row bought
                back from the three-row grid it replaced. */}
            <div className="relative h-full max-h-[34rem] min-h-[19rem] w-full max-w-[46rem]">
              {stack.map((item, i) => (
                <TriageCard
                  key={item.id}
                  item={item}
                  index={i}
                  draggable={!item.input}
                  reduced={reduced}
                  cycle={queue.skips.get(item.id) ?? 0}
                  cardRef={i === 0 ? cardRef : undefined}
                  scrollerRef={i === 0 ? scrollerRef : undefined}
                  onCommit={commit}
                  answerSlot={
                    i === 0 && item.input ? (
                      <QuestionPanel
                        item={item}
                        answers={answers}
                        onAnswer={setAnswer}
                        onSubmit={submitAnswers}
                        onBranch={fireBranch}
                        textareaRef={textareaRef}
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>

            <DeckFlank
              tone="success"
              icon={ThumbsUp}
              label={top.verdictLabels.accept}
              disabled={!canAccept || !!capture}
              onClick={() => decideTop('accept')}
            />
          </>
        )}
        </div>
      </div>

      {/* The reason strip TAKES OVER the action bar rather than layering over
          it: the verdict is already committed, so leaving the verdict controls
          live would invite a second one. */}
      {capture ? (
        <ReasonStrip
          prompt={capture.prompt}
          draft={reasonDraft}
          onDraft={setReasonDraft}
          onResolve={resolveReason}
        />
      ) : top ? (
        <DeckActionBar
          item={top}
          canAccept={canAccept}
          onVerdict={decideTop}
          onBranch={fireBranch}
          onLink={followLink}
        />
      ) : null}
    </motion.section>
  );
}

export default TriageDeckVariant;
