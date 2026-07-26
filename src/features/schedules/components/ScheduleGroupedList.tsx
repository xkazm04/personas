/**
 * ScheduleGroupedList — the grouped ("Overdue / Next hour / … / Later") body of
 * the schedules timeline, windowed.
 *
 * WHY: the rich `ScheduleRow` is ~70 DOM nodes; the list renders one per cron
 * agent under time-window headers. The 2026-05-30 perf walk measured ~5,141
 * nodes / 142ms render at ~70 agents on L1/schedules, scaling linearly. The
 * per-row heavy subtrees (history sparkline, frequency editor, backfill,
 * advanced menu) were already lazy behind expansion flags, so what remains is
 * the base row × N — only windowing removes that.
 *
 * A flat render cap was rejected: the list is time-grouped, so capping hides
 * whole buckets ("Later") rather than deferring off-screen work.
 *
 * HOW:
 *  - `flattenScheduleGroups` collapses groups+entries into ONE index space
 *    (headers included) so a virtualizer can window it. See scheduleListItems.
 *  - Heights are VARIABLE (a row grows when the user expands history / the
 *    frequency editor), so sizes are measured, not assumed: each rendered item
 *    registers with `virtualizer.measureElement`, whose ResizeObserver picks up
 *    expansion automatically and re-lays-out the list.
 *  - The virtualizer scrolls the nearest scrollable ANCESTOR (`ContentBody`)
 *    rather than introducing a nested scrollbar, using `scrollMargin` for the
 *    list's offset inside that scroller. The page keeps one scrollbar and the
 *    content above the list (recent runs, filter banner) is unaffected.
 *  - Below `SCHEDULE_WINDOWING_THRESHOLD` rows, or if no scrollable ancestor is
 *    found, it renders the plain flow layout — same markup, no absolute
 *    positioning — so small installs and unexpected layouts behave exactly as
 *    before.
 *
 * `ScheduleRow` itself is untouched: this component only changes containment
 * and iteration.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ScheduleEntry, TimeGroup } from '../libs/scheduleHelpers';
import {
  ESTIMATED_SCHEDULE_ROW_HEIGHT,
  SCHEDULE_GROUP_HEADER_HEIGHT,
  SCHEDULE_WINDOWING_THRESHOLD,
  flattenScheduleGroups,
  type ScheduleListItem,
} from '../libs/scheduleListItems';

const GROUP_COLORS: Record<string, string> = {
  'Overdue': 'text-red-400 border-red-500/20',
  'Next 15 minutes': 'text-emerald-400 border-emerald-500/20',
  'Next hour': 'text-blue-400 border-blue-500/20',
  'Next 6 hours': 'text-violet-400 border-violet-500/20',
  'Next 24 hours': 'text-amber-400 border-amber-500/20',
  'Later': 'text-foreground border-primary/10',
  'Paused / Unscheduled': 'text-foreground border-primary/10',
};

/** Vertical gap between rows inside a group, in px (was `space-y-1.5`). */
const ROW_GAP = 6;
/** Vertical gap above a group header other than the first (was `space-y-5`). */
const GROUP_GAP = 20;

// -- Group header --------------------------------------------------------------

function GroupHeader({ label, count, first }: { label: string; count: number; first: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 mb-2 pb-1.5 border-b ${GROUP_COLORS[label] || 'text-foreground border-primary/10'}`}
      style={first ? undefined : { marginTop: GROUP_GAP }}
    >
      <span className="typo-caption uppercase tracking-wider">{label}</span>
      <span className="text-[10px] font-mono opacity-60">({count})</span>
    </div>
  );
}

// -- Scrollable-ancestor lookup ------------------------------------------------

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// -- Item body -----------------------------------------------------------------

/**
 * `content-visibility: auto` on the row (ScheduleRow's own earlier mitigation)
 * makes an off-screen row report its `contain-intrinsic-size` placeholder
 * height instead of its real one, which would feed the virtualizer garbage for
 * overscanned rows. Windowing supersedes that mitigation, so the windowed path
 * forces the row's rendering back on. Scoped to this wrapper's direct children
 * so `ScheduleRow` stays untouched.
 */
const MEASURABLE_ROW = '[&>div]:[content-visibility:visible]';

function ItemBody({
  item,
  renderEntry,
}: {
  item: ScheduleListItem;
  renderEntry: (entry: ScheduleEntry) => ReactNode;
}) {
  if (item.kind === 'header') {
    return <GroupHeader label={item.label} count={item.count} first={item.first} />;
  }
  return (
    <div className={MEASURABLE_ROW} style={item.lastInGroup ? undefined : { paddingBottom: ROW_GAP }}>
      {renderEntry(item.entry)}
    </div>
  );
}

// -- ScheduleGroupedList -------------------------------------------------------

export default function ScheduleGroupedList({
  groups,
  renderEntry,
}: {
  groups: TimeGroup[];
  renderEntry: (entry: ScheduleEntry) => ReactNode;
}) {
  const { items, rowCount } = useMemo(() => flattenScheduleGroups(groups), [groups]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const wantsWindowing = rowCount >= SCHEDULE_WINDOWING_THRESHOLD;

  // Resolve the scroll ancestor + this list's offset inside it. Runs after every
  // render (layout above the list can shift: filter banner, recent-runs panel)
  // but only commits state when a value actually changed, so it converges.
  const measureOffset = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const parent = findScrollParent(el);
    setScroller((prev) => (prev === parent ? prev : parent));
    if (!parent) return;
    const offset = Math.max(
      0,
      Math.round(el.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop),
    );
    setScrollMargin((prev) => (prev === offset ? prev : offset));
  }, []);

  useLayoutEffect(() => {
    if (!wantsWindowing) return;
    measureOffset();
  });

  useEffect(() => {
    if (!wantsWindowing || !scroller || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureOffset());
    ro.observe(scroller);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [wantsWindowing, scroller, measureOffset]);

  const windowed = wantsWindowing && scroller !== null;

  const virtualizer = useVirtualizer({
    count: windowed ? items.length : 0,
    getScrollElement: () => scroller,
    estimateSize: (index) =>
      items[index]?.kind === 'header'
        ? SCHEDULE_GROUP_HEADER_HEIGHT
        : ESTIMATED_SCHEDULE_ROW_HEIGHT + ROW_GAP,
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 6,
    scrollMargin,
  });

  if (!windowed) {
    // Plain flow rendering — identical markup, no virtualization. Used below the
    // windowing threshold and as the fallback when no scroll ancestor exists.
    return (
      <div ref={containerRef}>
        {items.map((item) => (
          <ItemBody key={item.key} item={item} renderEntry={renderEntry} />
        ))}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
      {virtualItems.map((vItem) => {
        const item = items[vItem.index];
        if (!item) return null;
        return (
          <div
            key={item.key}
            data-index={vItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vItem.start - scrollMargin}px)`,
            }}
          >
            <ItemBody item={item} renderEntry={renderEntry} />
          </div>
        );
      })}
    </div>
  );
}
