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
 * ── PROTOTYPE NOTE (sanctioned i18n exception) ────────────────────────────
 * Every user-facing string in this file and in `./deck/*` is a provisional
 * English literal, NOT a `t.section.key`. This is a throwaway round-1 variant
 * being A/B'd against a sibling; a parallel session owns the locale files, and
 * extraction happens at consolidation once a winner is picked. This is the one
 * place in the repo where hardcoded JSX copy is intentional — do not copy the
 * pattern anywhere else.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { DeckActionBar, DeckFlank } from './deck/DeckActionBar';
import { DeckCleared, DeckLoading } from './deck/DeckStates';
import { DeckTopBar } from './deck/DeckTopBar';
import { QuestionPanel } from './deck/QuestionPanel';
import { TriageCard } from './deck/TriageCard';
import { useDeckControls } from './deck/useDeckControls';
import { TRIAGE_KINDS } from './triageTypes';
import type { UnifiedTriageQueue } from './useUnifiedTriage';

/** One live card, two for depth. More is just paint. */
const STACK_DEPTH = 3;

export function TriageDeckVariant({
  queue,
  onClose,
  switcher,
}: {
  queue: UnifiedTriageQueue;
  onClose: () => void;
  switcher?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const {
    top,
    answer,
    setAnswer,
    cardRef,
    textareaRef,
    commit,
    decideTop,
    submitAnswer,
    fireBranch,
    canAccept,
  } = useDeckControls(queue, onClose);

  const stack = queue.items.slice(0, STACK_DEPTH);
  const showLoading = queue.loading && stack.length === 0;
  // "You filtered it away" and "you finished" are different endings.
  const filteredOut = TRIAGE_KINDS.some((k) => !queue.activeKinds.has(k) && queue.allCounts[k] > 0);

  return (
    <motion.section
      className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col bg-background"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      aria-label="Triage deck"
      data-testid="triage-deck-variant"
    >
      <DeckTopBar queue={queue} switcher={switcher} onClose={onClose} />

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
            filtered={filteredOut}
            reduced={reduced}
            onReload={queue.reload}
          />
        ) : (
          <>
            <DeckFlank
              tone="danger"
              icon={ThumbsDown}
              label={top.verdictLabels.reject}
              onClick={() => decideTop('reject')}
            />

            <div className="relative h-full max-h-[34rem] min-h-[19rem] w-full max-w-[42rem]">
              {stack.map((item, i) => (
                <TriageCard
                  key={item.id}
                  item={item}
                  index={i}
                  draggable={!item.input}
                  reduced={reduced}
                  cardRef={i === 0 ? cardRef : undefined}
                  onCommit={commit}
                  answerSlot={
                    i === 0 && item.input ? (
                      <QuestionPanel
                        item={item}
                        answer={answer}
                        onAnswer={setAnswer}
                        onSubmit={submitAnswer}
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
              disabled={!canAccept}
              onClick={() => decideTop('accept')}
            />
          </>
        )}
      </div>

      {top ? (
        <DeckActionBar item={top} canAccept={canAccept} onVerdict={decideTop} onBranch={fireBranch} />
      ) : null}
    </motion.section>
  );
}

export default TriageDeckVariant;
