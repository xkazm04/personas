// DeckQueueRail — the queue, made previewable without becoming a to-do list.
//
// The deck's founding bet was that showing everything you have left is how a
// triage surface never gets finished, so it showed nothing but the card. That
// held while the deck filled the screen; at desk width it left half the surface
// empty, and the reviewer still had no way to answer the two questions a queue
// raises: what is coming, and can I get to THAT one first.
//
// The compromise this rail makes:
//  • It is a LEDGER, not a worklist — order, kind and title, nothing decidable.
//    No verdict is reachable from here, so it cannot become a second way to
//    triage that drifts from the card's.
//  • Clicking a row MOVES THE READ HEAD to it (`queue.focusItem`). Nothing is
//    reordered: the row keeps its number, the deck deals it where it stands,
//    and the next card is the one below it — so a jump to 18 continues at 19
//    rather than dumping the reviewer back at the front. It used to lift the
//    row out and unshift it to position 1, which renumbered the very list the
//    reviewer was reading, around their own click. See `triageQueue#cursorId`.
//  • It hides below `lg`. On a narrow window the card is the whole point.
import { memo, useEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';

import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useTranslation } from '@/i18n/useTranslation';

import type { SkipLedger } from '../triageQueue';
import type { TriageItem } from '../triageTypes';
import { KIND_META, kindCopy, TONE_TEXT } from './DeckChips';

/** Above this many rows the list virtualizes; below it, plain DOM reads better
 *  (a virtualizer with a handful of rows costs a measure pass and buys nothing). */
const VIRTUALIZE_ABOVE = 40;
/**
 * Row height fed to the virtualizer. Matches the padding + line-height below:
 * `py-2` (8 + 8) plus one `typo-body` line.
 *
 * Exported so a test can assert the constant and the rendered row agree. They
 * are two independent numbers handed to `estimateSize`, virtualization engages
 * above `VIRTUALIZE_ABOVE` rows, and drift between them misplaces every row past
 * that point — silently.
 */
export const ROW_HEIGHT = 40;

/**
 * The rail's width, and the width its mirror must match.
 *
 * Doubles (240 → 480) only where the screen can pay for it. The card is
 * `max-w-[46rem]` (736px) and its flanks + gaps + padding cost 224px, so the
 * centre column needs 960px to hold the card at full width. `TriageDeckVariant`
 * mirrors this rail with an empty column only at breakpoints where
 * `viewport − 2 × rail` still clears 960 — which is why the ladder pauses at
 * `w-72` through `2xl` instead of growing on every step. The result: the card's
 * width is unchanged at every breakpoint, and from `2xl` up its centre stops
 * moving when the rail resizes.
 *
 * Exported because the mirror MUST read this same string. Two hand-copied class
 * lists that drift is precisely how the card slides off-centre again.
 */
export const RAIL_WIDTH = 'w-60 xl:w-72 2xl:w-72 min-[1728px]:w-96 min-[1920px]:w-[30rem]';

/**
 * Memoised, one level below the rail's own memo — because the two protect
 * against different invalidations. The rail's memo holds across a KEYSTROKE
 * (its props are untouched); it cannot hold across an ADVANCE, where the
 * projection hands down a fresh `items` array every time the cursor moves. The
 * item OBJECTS inside that array are stable (`projectQueue` maps the same
 * references out of the memoised `all`), so with the row memoised an advance
 * re-renders exactly the two rows whose `current` flag flipped instead of one
 * subtree per queued item — on a 60-card deck, 2 rows instead of 60 per throw.
 *
 * `onJump` takes the id and is passed straight through (`queue.focusItem` is
 * stable); an inline `() => onJump(item.id)` closure at the call site was the
 * one prop that defeated this memo.
 */
const QueueRow = memo(function QueueRow({
  item,
  position,
  current,
  deferred,
  onJump,
}: {
  item: TriageItem;
  position: number;
  current: boolean;
  /** Skipped at least once this session — it is being re-offered, not new. */
  deferred: boolean;
  onJump: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const kindLabel = kindCopy(t, item.kind).one;
  const ref = useRef<HTMLButtonElement>(null);

  // Keep the card being decided in view as the deck walks the queue, so the
  // rail reads as a position indicator rather than a static list.
  useEffect(() => {
    // Optional-called: jsdom has no layout, so `scrollIntoView` is not always
    // there, and a rail that throws would take the whole deck down with it.
    if (current) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onJump(item.id)}
      aria-current={current ? 'true' : undefined}
      // The kind rides in the tooltip too: with the second line gone, the icon
      // is the only thing carrying it on screen, and an icon is not a label.
      title={`${kindLabel} — ${tx(t.monitor.triage_queue_jump, { title: item.title })}`}
      className={`focus-ring flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left transition-colors ${
        current
          ? 'border-primary bg-primary/10'
          : 'border-transparent hover:border-primary/30 hover:bg-secondary/40'
      }`}
    >
      <span className="typo-data w-5 shrink-0 tabular-nums text-muted-foreground">{position}</span>
      <Icon className={`h-4 w-4 shrink-0 ${TONE_TEXT[meta.tone]}`} aria-hidden />
      {/* The icon is `aria-hidden`, so this is the ONLY thing standing between
          the single-line row and a queue whose item types are invisible to a
          screen reader. */}
      <span className="sr-only">{kindLabel}</span>
      {/* Normal weight, every row. The card being decided is marked by the left
          border and the background tint it already has — carrying that in the
          font weight as well made the rail read as a list of headlines. */}
      <span data-rail-name className="typo-body min-w-0 flex-1 truncate text-foreground">
        {item.title}
      </span>
      {/* A skipped card sorts to the BACK of the queue rather than leaving it,
          so without this the rail's tail reads as "not looked at yet" when it is
          really "you already passed on these".

          The glyph is `aria-hidden`, exactly like the kind icon above it — and
          exactly like the kind icon, that means the state needs its own
          `sr-only` companion or it does not exist for a screen reader at all.
          The kind got one when the second line was deleted; this did not. */}
      {deferred ? (
        <>
          <RotateCcw className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">{t.monitor.triage_queue_deferred}</span>
        </>
      ) : null}
    </button>
  );
});

/**
 * Memoised, and the row list is why.
 *
 * Every prop here is stable across a keystroke — `items` and `skips` come from
 * the queue's memoised projection, `onJump` is `queue.focusItem` — but the
 * component sits under `useDeckControls`'s draft state, so it re-rendered on
 * every character typed into an answer box, and with it one `QueueRow` per
 * queued item. On a 60-card deck that is 60 subtrees rebuilt per keystroke.
 */
export const DeckQueueRail = memo(function DeckQueueRail({
  items,
  cursor,
  skips,
  onJump,
}: {
  /** The dealt order, unaffected by where the reviewer is standing in it. */
  items: TriageItem[];
  /** Index of the card being decided — anywhere in `items`, not necessarily 0. */
  cursor: number;
  /** Times each item has been skipped this session — marks the re-offered tail. */
  skips: SkipLedger;
  onJump: (id: string) => void;
}) {
  const { t } = useTranslation();
  const virtualize = items.length > VIRTUALIZE_ABOVE;
  const { parentRef, virtualizer } = useVirtualList(items, ROW_HEIGHT);

  // A virtualized rail only mounts the rows near the viewport, so `QueueRow`'s
  // own `scrollIntoView` cannot reach a current row that is not rendered — and
  // the cursor is exactly the thing that now jumps (to the row clicked, and to
  // the front again when it wraps off the end). Drive the scroller by INDEX
  // instead; the row-level effect still handles the short, non-virtual list.
  useEffect(() => {
    if (!virtualize) return;
    virtualizer.scrollToIndex(cursor, { align: 'auto' });
    // `virtualizer` re-identifies on every measure pass; scrolling on that would
    // fight the reviewer's own scrolling. The cursor moving is the only reason
    // to move the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, virtualize]);

  if (items.length === 0) return null;

  return (
    <aside
      aria-label={t.monitor.triage_queue_rail_aria}
      className={`hidden h-full ${RAIL_WIDTH} shrink-0 flex-col border-r border-primary/10 bg-secondary/15 lg:flex`}
    >
      <div className="flex shrink-0 items-baseline justify-between border-b border-primary/10 px-3 py-3">
        <h2 className="typo-label text-muted-foreground">
          {t.monitor.triage_queue_rail_title}
        </h2>
        <span className="typo-data tabular-nums text-foreground">{items.length}</span>
      </div>

      {/* The scroll element is handed to the virtualizer ONLY when the list is
          long enough to virtualize. A virtualizer that owns a scroller it isn't
          driving still measures and scrolls it. */}
      <div ref={virtualize ? parentRef : undefined} className="min-h-0 flex-1 overflow-y-auto">
        {virtualize ? (
          <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = items[row.index]!;
              return (
                <li
                  key={item.id}
                  className="absolute inset-x-0 top-0"
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                >
                  <QueueRow
                    item={item}
                    position={row.index + 1}
                    current={row.index === cursor}
                    deferred={(skips.get(item.id) ?? 0) > 0}
                    onJump={onJump}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <ul>
            {items.map((item, i) => (
              <li key={item.id}>
                <QueueRow
                  item={item}
                  position={i + 1}
                  current={i === cursor}
                  deferred={(skips.get(item.id) ?? 0) > 0}
                  onJump={onJump}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
});
