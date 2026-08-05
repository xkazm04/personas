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
//  • Clicking a row PINS that item to the front (`queue.focusItem`) rather than
//    opening it in place. The deck still deals exactly one card, the keyboard
//    still decides exactly the top card, and the order behind the pin is
//    untouched — see `triageQueue#focused`.
//  • It hides below `lg`. On a narrow window the card is the whole point.
import { useEffect, useRef } from 'react';

import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useTranslation } from '@/i18n/useTranslation';

import type { TriageItem } from '../triageTypes';
import { KIND_META, kindCopy, TONE_TEXT } from './DeckChips';

/** Above this many rows the list virtualizes; below it, plain DOM reads better
 *  (a virtualizer with a handful of rows costs a measure pass and buys nothing). */
const VIRTUALIZE_ABOVE = 40;
/** Row height fed to the virtualizer. Matches the padding + line-height below. */
const ROW_HEIGHT = 48;

function QueueRow({
  item,
  position,
  current,
  onJump,
}: {
  item: TriageItem;
  position: number;
  current: boolean;
  onJump: () => void;
}) {
  const { t, tx } = useTranslation();
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
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
      onClick={onJump}
      aria-current={current ? 'true' : undefined}
      title={tx(t.monitor.triage_queue_jump, { title: item.title })}
      className={`focus-ring flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left transition-colors ${
        current
          ? 'border-primary bg-primary/10'
          : 'border-transparent hover:border-primary/30 hover:bg-secondary/40'
      }`}
    >
      <span className="typo-data w-5 shrink-0 tabular-nums text-muted-foreground">{position}</span>
      <Icon className={`h-4 w-4 shrink-0 ${TONE_TEXT[meta.tone]}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate ${current ? 'typo-title text-foreground' : 'typo-caption text-foreground'}`}
        >
          {item.title}
        </span>
        <span className="typo-label block truncate text-muted-foreground">
          {kindCopy(t, item.kind).one}
        </span>
      </span>
    </button>
  );
}

export function DeckQueueRail({
  items,
  onJump,
}: {
  /** The dealt order. `items[0]` is the card being decided. */
  items: TriageItem[];
  onJump: (id: string) => void;
}) {
  const { t } = useTranslation();
  const virtualize = items.length > VIRTUALIZE_ABOVE;
  const { parentRef, virtualizer } = useVirtualList(items, ROW_HEIGHT);

  if (items.length === 0) return null;

  return (
    <aside
      aria-label={t.monitor.triage_queue_rail_aria}
      className="hidden h-full w-60 shrink-0 flex-col border-r border-primary/10 bg-secondary/15 lg:flex xl:w-64"
    >
      <div className="flex shrink-0 items-baseline justify-between border-b border-primary/10 px-3 py-3">
        <h2 className="typo-label uppercase tracking-wide text-muted-foreground">
          {t.monitor.triage_queue_rail_title}
        </h2>
        <span className="typo-data tabular-nums text-foreground">{items.length}</span>
      </div>

      {/* The scroll element is handed to the virtualizer ONLY when the list is
          long enough to virtualize. A virtualizer that owns a scroller it isn't
          driving still measures and scrolls it. */}
      <div ref={virtualize ? parentRef : undefined} className="min-h-0 flex-1 overflow-y-auto">
        {virtualize ? (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = items[row.index]!;
              return (
                <div
                  key={item.id}
                  className="absolute inset-x-0 top-0"
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                >
                  <QueueRow
                    item={item}
                    position={row.index + 1}
                    current={row.index === 0}
                    onJump={() => onJump(item.id)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          items.map((item, i) => (
            <QueueRow
              key={item.id}
              item={item}
              position={i + 1}
              current={i === 0}
              onJump={() => onJump(item.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
