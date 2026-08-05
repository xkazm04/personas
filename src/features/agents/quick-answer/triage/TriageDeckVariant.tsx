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
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { useAnnounce } from '@/features/shared/components/feedback/AriaLiveProvider';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import { DeckActionBar, DeckFlank } from './deck/DeckActionBar';
import { kindCopy } from './deck/DeckChips';
import { DeckQueueRail, RAIL_WIDTH } from './deck/DeckQueueRail';
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
   * The deck owns NO live region of its own — it speaks through the app's.
   *
   * It used to hand-roll a `role="status"` div and swap its text. A live region
   * only speaks when its content MUTATES, so rejecting two cards with the same
   * words in a row produced one utterance and the second verdict was recorded
   * in silence. `AriaLiveProvider` exists for exactly this: it queues each
   * message and bumps a `key`, so every call remounts the region and every call
   * is heard once.
   *
   * The copy is read through a ref rather than depended on. `t` re-identifies
   * whenever a lazily-loaded locale SECTION lands, and this whole surface is
   * lazy — an utterance must be caused by a verdict or a deal, never by a chunk
   * arriving.
   */
  const announce = useAnnounce();
  const copy = useRef({ t, tx, announce, top });
  copy.current = { t, tx, announce, top };

  // One utterance per WRITE. `lastVerdict` is a fresh stamp every time (see
  // `DeckVerdictStamp`), so two identical verdicts in a row are two events.
  useEffect(() => {
    if (!lastVerdict) return;
    const c = copy.current;
    c.announce(c.tx(c.t.monitor.triage_announce_verdict, { verdict: lastVerdict.text }));
  }, [lastVerdict]);

  // One utterance per CARD DEALT. Keyed by id and not by the item object: the
  // polls that replace `queue.items` hand back new objects for the same card,
  // and re-announcing the card the reviewer is already looking at is noise.
  const topId = top?.id ?? null;
  useEffect(() => {
    if (!topId) return;
    const c = copy.current;
    if (!c.top) return;
    c.announce(
      c.tx(c.t.monitor.triage_announce_card, {
        kind: kindCopy(c.t, c.top.kind).one,
        title: c.top.title,
      }),
    );
  }, [topId]);

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
      {/* No live region here. Everything this surface announces — the verdict
          just recorded, then the card now being asked about — goes through the
          app's `AriaLiveProvider` (see the effects above), which is the only
          polite region the deck contributes to.

          The one live region that can still appear BELOW this point is
          `LoadingSpinner`'s `role="status"` inside `DeckLoading`, and it is up
          only while there is no card to announce at all. The card stack itself
          contributes none: `TriageCard`'s drag stamps and `TriageCardHeader`'s
          alert banner are paint and content respectively, not status. */}
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

        {/* Mirrors the rail so the card centres on the WINDOW rather than on
            whatever space the rail happens to leave. Without it the card is a
            flex sibling of the rail and slides right by half the rail's width,
            which is why the rail could never be widened.

            Only from `2xl` up, and that is the whole trade: the card wants 960px
            (736 + flanks + gaps + padding), so mirroring a 288px rail at 1280px
            would cost the card 256px to correct a 144px offset — a worse deal
            than the offset. Above `2xl` the arithmetic affords it and the card
            keeps its full width. See RAIL_WIDTH. */}
        <div aria-hidden className={`hidden shrink-0 2xl:block ${RAIL_WIDTH}`} />
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
