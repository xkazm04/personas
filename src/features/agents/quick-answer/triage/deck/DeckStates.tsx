// DeckStates — the three moments where there is no card to throw.
//
// All three are designed as arrivals rather than absences. The loading state
// deals three ghost cards into the same depth positions the real stack will
// occupy, so the surface has shape before it has data and nothing jumps when it
// lands. The cleared state is the payoff for the whole variant: someone who just
// cleared forty items in five minutes should be told so, in the largest type on
// the screen, not shown a grey "nothing here" box.
//
// The third is the one that was missing, and its absence was the deck's biggest
// lie. Every source ends in a caught rejection, so a total outage settled
// `loading:false` with an empty queue and rendered the CLEARED state — "nothing
// is waiting on you" — over a backend that had not answered. `DeckFailed` is the
// ending that says so instead, and it is deliberately NOT congratulatory: it
// carries the error tone, names the queues it could not read, and its primary
// action is to try again.
//
// The cleared state, in turn, stopped being one ending pretending to be three.
// Filtered, batched and finished are separate FACTS, they can hold at once, and
// each now states itself and offers its own action rather than the loudest one
// silencing the rest.
//
// None of them loop. The entry choreography is one-shot and gated on reduced
// motion; there is no ambient pulse anywhere in this file.
import { motion } from 'framer-motion';
import { Filter, Layers, PartyPopper, RotateCcw, Unplug } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

import type { TriageSessionSummary } from '../triageJournal';
import type { TriageSourceFailure } from '../useUnifiedTriage';
import { sourceLabel } from './DeckChips';
import { DeckSummary } from './DeckSummary';

const GHOSTS = [0, 1, 2];

/**
 * "You passed on these twice, and they are still pending."
 *
 * `deferredCount` was computed by the queue, exposed by the hook, and read by
 * NOBODY — so a card skipped to exhaustion left the deck and the headline still
 * asserted the queue was empty. It rides under every ending rather than being an
 * ending of its own: deferrals coexist with all three, and a fourth exclusive
 * branch would just be a fourth thing suppressing the others.
 */
function DeferredNote({ count }: { count: number }) {
  const { t, tx } = useTranslation();
  if (count <= 0) return null;
  return (
    <p className="typo-body text-foreground" data-testid="deck-deferred-note">
      {tx(count === 1 ? t.monitor.triage_deferred_one : t.monitor.triage_deferred_other, {
        count,
      })}
    </p>
  );
}

export function DeckLoading({ reduced }: { reduced: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="relative h-full max-h-[34rem] min-h-[19rem] w-full max-w-[42rem]">
      <LoadingSpinner label={t.monitor.triage_loading} />
      {GHOSTS.map((i) => (
        <motion.div
          key={i}
          className="absolute inset-0"
          style={{ zIndex: 10 - i }}
          initial={reduced ? false : { scale: 1 - i * 0.05, y: i * 10 + 26, opacity: 0 }}
          animate={{ scale: 1 - i * 0.05, y: i * 10, opacity: 1 - i * 0.25 }}
          transition={{ type: 'spring', stiffness: 240, damping: 26, delay: reduced ? 0 : i * 0.08 }}
        >
          <div className="h-full w-full space-y-4 rounded-card border-2 border-primary/12 bg-background p-6 shadow-elevation-3">
            <div className="flex gap-2">
              <span className="h-5 w-20 rounded-pill bg-primary/10" />
              <span className="h-5 w-16 rounded-pill bg-primary/10" />
            </div>
            <span className="block h-7 w-3/4 rounded-input bg-primary/12" />
            <span className="block h-3 w-1/3 rounded-pill bg-primary/8" />
            <div className="space-y-2 pt-2">
              <span className="block h-3 w-full rounded-pill bg-primary/8" />
              <span className="block h-3 w-11/12 rounded-pill bg-primary/8" />
              <span className="block h-3 w-4/5 rounded-pill bg-primary/8" />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/**
 * The ending for a deck that does not KNOW whether anything is waiting.
 *
 * Distinct from every other ending on purpose, and never reachable at the same
 * time as the cleared one: an unread queue is not an empty queue, and the only
 * honest headline over a failed load is that the load failed. There is no
 * summary-and-confetti here — the session readout still renders, because what
 * the reviewer DID do is still true, but nothing on this screen implies they
 * are finished.
 */
export function DeckFailed({
  failures,
  summary,
  deferred,
  reduced,
  onRetry,
}: {
  /** Which queues did not answer, and what they said. Never empty when rendered. */
  failures: readonly TriageSourceFailure[];
  summary: TriageSessionSummary;
  deferred: number;
  reduced: boolean;
  onRetry: () => void;
}) {
  const { t, tx } = useTranslation();
  const names = failures.map((f) => sourceLabel(t, f.source)).join(', ');

  return (
    <motion.div
      className="flex max-w-[52ch] flex-col items-center gap-4 text-center"
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      data-testid="deck-failed"
    >
      <motion.div
        className="flex h-20 w-20 items-center justify-center rounded-full border border-status-error/30 bg-status-error/10"
        initial={reduced ? false : { scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18, delay: reduced ? 0 : 0.06 }}
      >
        <Unplug className="h-9 w-9 text-status-error" aria-hidden />
      </motion.div>

      <h2 className="typo-hero text-foreground">{t.monitor.triage_failed_title}</h2>

      <p className="typo-body-lg text-foreground">
        {tx(
          failures.length === 1
            ? t.monitor.triage_failed_body_one
            : t.monitor.triage_failed_body_other,
          { count: failures.length },
        )}
      </p>

      {/* The queues by name. A reviewer who knows it is the practices library
          that is down knows what this deck is NOT showing them. */}
      <p className="typo-body text-foreground">
        {tx(t.monitor.triage_failed_sources, { sources: names })}
      </p>

      <DeferredNote count={deferred} />

      <DeckSummary summary={summary} />

      <Button
        variant="primary"
        onClick={onRetry}
        aria-label={t.monitor.triage_failed_retry}
        title={t.monitor.triage_failed_retry}
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
        {t.monitor.triage_failed_retry}
      </Button>
    </motion.div>
  );
}

export function DeckCleared({
  decided,
  summary,
  filtered,
  remaining,
  more,
  deferred,
  reduced,
  onReload,
  onLoadMore,
  onShowAllKinds,
}: {
  decided: number;
  /** What the session did, from the decision journal. Rendered under the
   *  headline: the moment the deck runs dry is the only moment a reviewer is
   *  reading rather than deciding. */
  summary: TriageSessionSummary;
  /** True when the queue still holds LIVE items, just none of the active kinds. */
  filtered: boolean;
  /**
   * Ideas still pending in SQLite behind the capped working set. Above zero, the
   * deck did NOT reach the end of the queue — it reached the end of a batch, and
   * saying "you're all caught up" there is the most misleading thing this
   * surface can do.
   */
  remaining: number;
  /**
   * Something is behind the working set but nothing can size it — a source read
   * at a fixed limit that came back full. `remaining` is 0 in that case and the
   * deck still must not claim the queue is finished, so the batch ending has a
   * countless variant rather than falling through to "cleared".
   */
  more: boolean;
  /** Cards skipped to exhaustion this session: pending, and no longer offered. */
  deferred: number;
  reduced: boolean;
  onReload: () => void;
  onLoadMore: () => void;
  onShowAllKinds: () => void;
}) {
  const { t, tx } = useTranslation();
  // Both facts can hold at once. `batched` used to be `!filtered && remaining > 0`,
  // which meant a filtered deck with a capped backlog rendered the filtered
  // ending — whose branch offered NO button at all — and the batch was
  // unreachable. Each fact now keeps its own action; only the headline has to
  // pick, and it picks the one the reviewer can act on first.
  const batched = remaining > 0 || more;
  const Icon = filtered ? Filter : batched ? Layers : PartyPopper;
  const neutral = filtered || batched;
  const body = filtered
    ? t.monitor.triage_filtered_body
    : batched
      ? remaining > 0
        ? tx(
            remaining === 1 ? t.monitor.triage_batch_body_one : t.monitor.triage_batch_body_other,
            { count: remaining },
          )
        : t.monitor.triage_batch_body_unknown
      : decided > 0
        ? tx(
            decided === 1 ? t.monitor.triage_cleared_body_one : t.monitor.triage_cleared_body_other,
            { count: decided },
          )
        : t.monitor.triage_cleared_body_none;

  return (
    <motion.div
      className="flex max-w-[52ch] flex-col items-center gap-4 text-center"
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      data-testid="deck-cleared"
    >
      {/* The party popper is EARNED. A batch boundary is a neutral waypoint, so
          it gets the queue's own accent rather than the success colour — the
          reviewer has not finished, and the surface must not congratulate them
          for it. */}
      <motion.div
        className={`flex h-20 w-20 items-center justify-center rounded-full border ${
          neutral
            ? 'border-primary/25 bg-primary/10'
            : 'border-status-success/30 bg-status-success/10'
        }`}
        initial={reduced ? false : { scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18, delay: reduced ? 0 : 0.06 }}
      >
        <Icon className={`h-9 w-9 ${neutral ? 'text-primary' : 'text-status-success'}`} aria-hidden />
      </motion.div>

      <h2 className="typo-hero text-foreground">
        {filtered
          ? t.monitor.triage_filtered_title
          : batched
            ? t.monitor.triage_batch_title
            : t.monitor.triage_cleared_title}
      </h2>

      <p className="typo-body-lg text-foreground">{body}</p>

      {/* The fact the headline did not get to be. A filtered deck with a capped
          backlog says BOTH things rather than picking one and implying the
          other is false. */}
      {filtered && batched ? (
        <p className="typo-body text-foreground">
          {remaining > 0
            ? tx(
                remaining === 1
                  ? t.monitor.triage_batch_body_one
                  : t.monitor.triage_batch_body_other,
                { count: remaining },
              )
            : t.monitor.triage_batch_body_unknown}
        </p>
      ) : null}

      <DeferredNote count={deferred} />

      <DeckSummary summary={summary} />

      <div className="flex flex-wrap items-center justify-center gap-2">
        {filtered ? (
          <Button
            variant="primary"
            onClick={onShowAllKinds}
            aria-label={t.monitor.triage_filtered_show_all}
            title={t.monitor.triage_filtered_show_all}
          >
            {t.monitor.triage_filtered_show_all}
          </Button>
        ) : null}
        {/* Gated on `remaining`, not on `batched`: "deal the next batch" pages
            the IDEA keyset, and a deck that is batched only because a
            fixed-limit ledger came back full has no next page to deal. A button
            that does nothing when pressed is a worse lie than no button — for
            that case the copy points at "Check for more", which re-reads every
            source. */}
        {remaining > 0 ? (
          <Button
            variant={filtered ? 'secondary' : 'primary'}
            onClick={onLoadMore}
            aria-label={t.monitor.triage_batch_next}
            title={t.monitor.triage_batch_next}
          >
            {t.monitor.triage_batch_next}
          </Button>
        ) : null}
        {/* Always offered. It is the only way back to a deferral, and the
            filtered branch used to render no action whatsoever. */}
        <Button
          variant="secondary"
          onClick={onReload}
          aria-label={t.monitor.triage_check_more}
          title={t.monitor.triage_check_more}
        >
          {t.monitor.triage_check_more}
        </Button>
      </div>
    </motion.div>
  );
}
