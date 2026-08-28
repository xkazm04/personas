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
//
// SECOND TAB (2026-08-27, migrated from the Run Desk). The rail now carries two
// halves of one job: `To decide`, the ledger described above, and `Accepted`,
// the work the reviewer has said yes to that nobody has sent to a runner yet.
// The deck used to end at the verdict — an accepted idea became a `dev_ideas`
// row and sat there until somebody opened a different section and pressed
// "Batch from accepted". The `Accepted` tab is that button's whole surface,
// with the ability to see and choose what you are sending. See
// `useAcceptedDispatch` for the three dispatch techniques and
// `DeckDispatchBar` / `DeckAcceptedList` for the two pieces it renders.
//
// The tab is rail-local state on purpose: nothing outside needs to know which
// half is showing, and lifting it would put a re-render of the whole deck
// behind a switch that repaints one column.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import {
  SegmentedTabs,
  segmentedTabPanelProps,
  type SegmentedTab,
} from '@/features/shared/components/layout/SegmentedTabs';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';

import { DeckAcceptedList } from './DeckAcceptedList';
import { DeckDispatchBar } from './DeckDispatchBar';
import { useAcceptedDispatch } from './useAcceptedDispatch';

import type { SkipLedger } from '../triageQueue';
import type { TriageItem } from '../triageTypes';
import { KIND_META, kindCopy, TONE_TEXT } from './DeckChips';

/** Above this many rows the list virtualizes; below it, plain DOM reads better
 *  (a virtualizer with a handful of rows costs a measure pass and buys nothing). */
const VIRTUALIZE_ABOVE = 40;
/**
 * Row height, fed to the virtualizer AND applied to the row itself.
 *
 * It used to be a lone `estimateSize` argument that a reader had to keep in
 * their head against `py-2 + one typo-body line` — two independent numbers,
 * and drift between them misplaces every row past the 40th, silently. The row
 * now takes its height FROM this constant, so they cannot drift: the only cost
 * is that a row whose title genuinely needs a third line clips instead of
 * growing, which `line-clamp-2` was already deciding anyway.
 *
 * 60 = `py-1.5` (6 + 6) plus two `typo-body` lines (14px × 1.65 × 2 ≈ 46.2).
 * Two, because the title now wraps rather than truncating at the first ellipsis
 * — see the row below.
 */
export const ROW_HEIGHT = 60;

/**
 * The rail's width: EVERYTHING THE CARD DOES NOT NEED, floored at 18rem and
 * capped at 36rem. Roughly 240px → 519px on a 1359px window, and it keeps
 * moving with the window instead of waiting for the next breakpoint.
 *
 * Two things used to stand between this rail and the screen, and both are gone:
 *
 *  • The MIRROR. An empty column, exactly one rail wide, at `2xl` and up, so
 *    the card centred on the WINDOW rather than on the space the rail left
 *    over. It worked — and it charged every pixel the rail wanted TWICE, which
 *    is the whole reason the rail could never grow past `w-72`. The card is now
 *    centred in the column beside the rail.
 *  • The FLANKS' layout width. Two 4rem buttons with a `gap-6 xl:gap-12` on
 *    either side cost the card column 14rem of flow. Pinned to that column's
 *    borders they cost 10rem of padding (`lg:px-20`), and padding is not width
 *    the card competes for.
 *
 * THE INVARIANT: the card's width never regresses. It wants `46rem` plus the
 * flanks' `10rem` of padding = **56rem**, which is the subtrahend below — so
 * for every window ≥ 74rem the card is at full measure and the rail takes 100%
 * of the surplus. Below that the floor holds at 18rem and the card gives way
 * exactly as it always did (at `lg` it now gets 36rem, where the old geometry
 * left it 35rem).
 *
 * A CLAMP AND NOT A BREAKPOINT LADDER, for a measured reason. Tailwind's named
 * breakpoints are rem-based and this app's root font-size is user-configurable
 * (15px on the machine this was measured on, so `xl` fires at 1200px, not
 * 1280). Arbitrary `min-[…px]:` variants sort BEFORE the named ones in the
 * generated sheet, so a mixed ladder silently loses: a probe carrying
 * `min-[1344px]:w-[28rem] xl:w-96` at a 1359px viewport resolves to `w-96`,
 * with `xl` winning despite matching a narrower query. The rung this file
 * shipped before — `min-[1728px]:w-96` after `2xl:w-72` — was dead for the
 * same reason. `clamp()` has no variants to order and no breakpoint to
 * mis-align, and it is expressed in the same rem the card and padding are.
 *
 * Still exported, and the test still asserts the `<aside>` carries it: this is
 * load-bearing arithmetic, not decoration.
 */
export const RAIL_WIDTH = 'w-[clamp(18rem,calc(100vw_-_56rem),36rem)]';

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
      // The FULL title rides here as well — two clamped lines is a lot of room,
      // but it is still a bound, and the tooltip is where the rest lives.
      title={`${kindLabel} — ${tx(t.monitor.triage_queue_jump, { title: item.title })}`}
      // Block, not flex, and a height taken from ROW_HEIGHT rather than implied
      // by the padding: the title is no longer a flex sibling competing with the
      // counter and the icon for the row's width — it owns the whole row and
      // wraps under them. See the marker span below.
      style={{ height: ROW_HEIGHT }}
      className={`focus-ring relative block w-full overflow-hidden border-l-2 px-3 py-1.5 text-left transition-colors ${
        current
          ? 'border-primary bg-primary/10'
          : 'border-transparent hover:border-primary/30 hover:bg-secondary/40'
      }`}
    >
      {/* Position + kind, pinned to the row's top-left corner and stepped down
          TWO sizes (caption number, 12px glyph). They used to sit IN the text
          flow, which cost the title ~70px of a 240px rail on every row and
          truncated most topics mid-word. Out of flow they cost the FIRST LINE
          only — the 32px spacer below, down from 48 — and nothing at all from
          the second. Zero is not on offer: a badge that costs no title width
          is a badge painted over the title's first word. */}
      <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-0.5">
        <span className="typo-caption w-4 text-right tabular-nums leading-none text-muted-foreground">
          {position}
        </span>
        <Icon className={`h-3 w-3 shrink-0 ${TONE_TEXT[meta.tone]}`} aria-hidden />
      </span>
      {/* The icon is `aria-hidden`, so this is the ONLY thing standing between
          the row and a queue whose item types are invisible to a screen reader. */}
      <span className="sr-only">{kindLabel}</span>
      {/* Normal weight, every row. The card being decided is marked by the left
          border and the background tint it already has — carrying that in the
          font weight as well made the rail read as a list of headlines.

          `line-clamp-2` rather than `truncate`: the corner badge buys the title
          the full rail width, and the second line is what turns "readable at a
          glance" into "actually the whole topic" for the long ones. */}
      <span
        data-rail-name
        className={`typo-body line-clamp-2 text-foreground ${deferred ? 'pr-5' : ''}`}
      >
        {/* An empty inline-block, NOT `text-indent` / `float`: this box is a
            `-webkit-box` (that is what `line-clamp` is), and a zero-width
            spacer at the head of the flow is the one way to indent its first
            line that does not depend on how Blink treats indentation inside
            one. It is what keeps the title clear of the corner badge. */}
        <span aria-hidden className="inline-block w-8" />
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
          <RotateCcw
            className="absolute right-2 top-2.5 h-3 w-3 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">{t.monitor.triage_queue_deferred}</span>
        </>
      ) : null}
    </button>
  );
});

/**
 * The `To decide` body — the ledger, unchanged. Split out of the rail when the
 * second tab arrived, so the two bodies are siblings rather than one component
 * with a mode flag threaded through its virtualizer.
 */
const DecideList = memo(function DecideList({
  items,
  cursor,
  skips,
  onJump,
}: {
  items: TriageItem[];
  cursor: number;
  skips: SkipLedger;
  onJump: (id: string) => void;
}) {
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

  return (
    // The scroll element is handed to the virtualizer ONLY when the list is
    // long enough to virtualize. A virtualizer that owns a scroller it isn't
    // driving still measures and scrolls it.
    <div
      data-decide-list
      ref={virtualize ? parentRef : undefined}
      className="min-h-0 flex-1 overflow-y-auto"
    >
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
  );
});

/** Which half of the rail is showing. See the file header. */
type RailTab = 'decide' | 'accepted';

/**
 * Ties each tab to the region it selects.
 *
 * `SegmentedTabs` emits `aria-controls` UNCONDITIONALLY, off a prefix that
 * defaults to `useId()` — so without passing one explicitly, the id it points
 * at is not merely unwritten, it is unobtainable, and the strip advertises a
 * relationship that exists only in the visual layout. Passing a fixed prefix
 * and spreading `segmentedTabPanelProps` onto the body is what makes the
 * promise true (census: `tabstrip-with-no-declared-panel`).
 */
const RAIL_TAB_PREFIX = 'triage-rail';

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
  const [tab, setTab] = useState<RailTab>('decide');

  // Unconditional, as hooks must be — including on the frames where this rail
  // renders nothing. That costs one `dev_tools_undispatched_ideas` read on a
  // cold deal, which is a POST-PAINT effect and so lands after the first commit
  // the rail is deliberately held out of. What it buys is that the tab's count
  // is truthful the moment the rail appears, rather than after the reviewer has
  // clicked a tab labelled zero to find out it is not.
  const accepted = useAcceptedDispatch({
    resolveErrorMessage: (err) =>
      resolveErrorTranslated(t, err instanceof Error ? err.message : String(err)).message,
  });

  const tabs: SegmentedTab<RailTab>[] = useMemo(
    () => [
      {
        id: 'decide',
        label: (
          <span className="inline-flex items-center gap-1.5">
            {t.monitor.triage_rail_tab_decide}
            <span className="tabular-nums opacity-60">{items.length}</span>
          </span>
        ),
        ariaLabel: t.monitor.triage_rail_tab_decide,
      },
      {
        id: 'accepted',
        label: (
          <span className="inline-flex items-center gap-1.5">
            {t.monitor.triage_rail_tab_accepted}
            <span className="tabular-nums opacity-60">{accepted.rows.length}</span>
          </span>
        ),
        ariaLabel: t.monitor.triage_rail_tab_accepted,
      },
    ],
    [t, items.length, accepted.rows.length],
  );

  // Nothing to decide AND nothing accepted waiting = no rail. The gate used to
  // be `items.length === 0` alone; keeping it that way would hide the Accepted
  // tab at exactly the moment it is most useful — a reviewer who has just
  // cleared the deck is the one person with a pile of accepted work and no
  // queue left to read.
  if (items.length === 0 && accepted.rows.length === 0) return null;

  return (
    <aside
      aria-label={t.monitor.triage_queue_rail_aria}
      className={`hidden h-full ${RAIL_WIDTH} shrink-0 flex-col border-r border-primary/10 bg-secondary/15 lg:flex`}
    >
      <div className="shrink-0 border-b border-primary/10 px-3 py-2">
        <SegmentedTabs
          tabs={tabs}
          activeTab={tab}
          onTabChange={setTab}
          variant="segment"
          size="sm"
          idPrefix={RAIL_TAB_PREFIX}
          ariaLabel={t.monitor.triage_rail_tabs_aria}
        />
      </div>

      {/* One panel element per tab, keyed by the tab so the two bodies never
          share a DOM node (and never share a scroll position).

          `segmentedTabPanelProps` supplies the id and `aria-labelledby` off the
          primitive's OWN arithmetic, so the two halves of `aria-controls`
          cannot drift. `role` is then written out literally as well — the same
          value the helper sets, and redundant at runtime. It is here because
          the census rule that gates this condition greps for the string
          `role="tabpanel"` in the file, and a role that only exists inside a
          spread is invisible to it: the file would go on reading as a strip
          with no panel. Stating it is cheaper than a rule that cannot see its
          own prescribed fix. */}
      <div
        key={tab}
        {...segmentedTabPanelProps(RAIL_TAB_PREFIX, tab)}
        role="tabpanel"
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === 'decide' ? (
          <DecideList items={items} cursor={cursor} skips={skips} onJump={onJump} />
        ) : (
          <>
            <DeckDispatchBar ctl={accepted} />
            <DeckAcceptedList ctl={accepted} />
          </>
        )}
      </div>
    </aside>
  );
});
