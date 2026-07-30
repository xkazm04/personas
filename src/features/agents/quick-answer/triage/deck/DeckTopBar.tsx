// DeckTopBar — the only chrome the deck allows itself.
//
// A momentum surface earns its speed by showing almost nothing: the variant
// switcher, what is in play, how far you have got, and the exit. No queue list,
// no detail rail, no secondary navigation — anything else is a place for the
// eye to go that isn't the card.
//
// The filter chips read `allCounts` (the tally BEFORE filtering), so a kind you
// have switched off still shows how much of it is waiting. A kind with nothing
// in it is rendered inert rather than hidden, because a chip that disappears
// makes the reviewer wonder what else vanished.
import { Activity, Layers, X } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

import { TRIAGE_KINDS, type TriageKind } from '../triageTypes';
import type { UnifiedTriageQueue } from '../useUnifiedTriage';
import { KIND_META, kindCopy, TONE_CHIP, TONE_HOVER } from './DeckChips';

function KindFilterChip({
  kind,
  count,
  active,
  onToggle,
}: {
  kind: TriageKind;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const meta = KIND_META[kind];
  const copy = kindCopy(t, kind);
  const Icon = meta.icon;
  const inert = count === 0;
  const label = `${copy.label} (${count})`;

  return (
    <button
      type="button"
      disabled={inert}
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      title={inert ? copy.empty : label}
      className={`focus-ring inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 typo-caption transition-colors disabled:is-disabled ${
        active && !inert
          ? TONE_CHIP[meta.tone]
          : 'border-primary/12 bg-transparent text-foreground hover:bg-secondary/40'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{copy.label}</span>
      <span className="typo-data tabular-nums">{count}</span>
    </button>
  );
}

/**
 * "You are looking at a batch, not the queue."
 *
 * The deck deals one keyset page of ideas, and it used to show that page's size
 * as though it were the whole backlog — 60 pending looked identical to 60 total.
 * This is the readout that makes a capped working set legible, and clicking it
 * extends the set rather than reloading (which would forget the session).
 * Rendered only when there IS more, so a queue that fits shows nothing extra.
 */
function BacklogChip({
  loaded,
  pending,
  onLoadMore,
}: {
  loaded: number;
  pending: number;
  onLoadMore: () => void;
}) {
  const { t, tx } = useTranslation();
  const label = tx(t.monitor.triage_backlog_capped, { loaded, pending });

  return (
    <button
      type="button"
      onClick={onLoadMore}
      aria-label={label}
      title={label}
      className={`focus-ring hidden shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1 typo-caption transition-colors sm:inline-flex ${TONE_CHIP.warning} ${TONE_HOVER.warning}`}
    >
      <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="typo-data tabular-nums">{`${loaded} / ${pending}`}</span>
    </button>
  );
}

export function DeckTopBar({
  queue,
  title,
  onOpenMonitor,
  onClose,
}: {
  queue: UnifiedTriageQueue;
  title: string;
  /** Preserved from the popover this surface replaced — the deck is the fast
   *  lane, the Monitor is where you go when a decision needs the whole story. */
  onOpenMonitor?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // `sessionTotal` is decided + still-pending, so it can never be outrun by the
  // numerator. Clamping anyway: a progress readout that can print "5 / 2" is a
  // readout nobody trusts again, and this is one `min` away from impossible.
  const total = queue.sessionTotal;
  const decided = Math.min(queue.decidedCount, total);
  const pct = total > 0 ? Math.min(100, (decided / total) * 100) : 0;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-primary/10 bg-secondary/15 px-4">
      <span className="typo-heading shrink-0 text-foreground">{title}</span>
      <div className="h-6 w-px shrink-0 bg-primary/12" aria-hidden />

      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {TRIAGE_KINDS.map((kind) => (
          <KindFilterChip
            key={kind}
            kind={kind}
            count={queue.allCounts[kind]}
            active={queue.activeKinds.has(kind)}
            onToggle={() => queue.toggleKind(kind)}
          />
        ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {queue.backlog.hasMore ? (
          <BacklogChip
            loaded={queue.backlog.loaded}
            pending={queue.backlog.pending}
            onLoadMore={queue.loadMore}
          />
        ) : null}

        <div className="hidden items-center gap-2 sm:flex">
          <span className="typo-data tabular-nums text-foreground">
            {`${decided} / ${total}`}
          </span>
          <span
            className="block h-1.5 w-28 overflow-hidden rounded-pill bg-primary/12"
            role="progressbar"
            aria-label={t.monitor.triage_progress_aria}
            aria-valuenow={decided}
            aria-valuemin={0}
            aria-valuemax={total}
          >
            <span
              className="block h-full rounded-pill bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </span>
        </div>

        {onOpenMonitor ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenMonitor}
            aria-label={t.monitor.triage_open_monitor}
            title={t.monitor.triage_open_monitor}
            icon={<Activity className="h-4 w-4" />}
          />
        ) : null}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t.monitor.triage_close}
          title={t.monitor.triage_close_hint}
          icon={<X className="h-4 w-4" />}
        />
      </div>
    </header>
  );
}
