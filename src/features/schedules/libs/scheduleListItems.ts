/**
 * Flattening layer for the windowed schedules list.
 *
 * The grouped timeline renders time-window buckets ("Overdue", "Next hour", …)
 * each holding N rich `ScheduleRow`s. Unwindowed that is one DOM subtree per
 * agent (~5,100 nodes at ~70 cron agents, measured in the 2026-05-30 perf
 * walk), and it grows linearly with the agent count.
 *
 * Windowing a *grouped* list requires collapsing the two-level structure
 * (groups → entries) into ONE ordered sequence of rows, because a virtualizer
 * only knows how to window a flat index range. That collapse is this module —
 * a pure function, so the index math is testable without a DOM.
 */
import type { ScheduleEntry, TimeGroup, TimeGroupId } from './scheduleHelpers';

/** A single windowed row: either a group header or one schedule entry. */
export type ScheduleListItem =
  | {
      kind: 'header';
      /** Stable React key. */
      key: string;
      /** Group id as produced by `groupByTimeWindow`; the display label is
       *  resolved from i18n (`schedules.group_<id>`) at render time. */
      id: TimeGroupId;
      /** Number of entries in this group (rendered next to the label). */
      count: number;
      /** True for the first header in the sequence — it gets no top spacing. */
      first: boolean;
    }
  | {
      kind: 'row';
      key: string;
      entry: ScheduleEntry;
      /** Id of the group this row belongs to (for a11y / debugging). */
      groupId: TimeGroupId;
      /** True for the last row of its group — it gets no bottom gap. */
      lastInGroup: boolean;
    };

export interface FlattenedScheduleList {
  items: ScheduleListItem[];
  /** Flat indexes of the header items, ascending. */
  headerIndexes: number[];
  /** Number of entry rows (excluding headers). */
  rowCount: number;
}

/**
 * Collapse time-window groups into a single ordered sequence of windowed items.
 *
 * Order is preserved exactly as the grouped view renders it: header, then the
 * group's entries, then the next header. Empty groups are dropped (a header
 * with no rows is noise) — `groupByTimeWindow` already filters those, this is
 * defence in depth so the flattened indexes can never point at an empty bucket.
 */
export function flattenScheduleGroups(groups: TimeGroup[]): FlattenedScheduleList {
  const items: ScheduleListItem[] = [];
  const headerIndexes: number[] = [];
  let rowCount = 0;

  for (const group of groups) {
    if (group.entries.length === 0) continue;
    headerIndexes.push(items.length);
    items.push({
      kind: 'header',
      key: `header:${group.id}`,
      id: group.id,
      count: group.entries.length,
      first: headerIndexes.length === 1,
    });
    group.entries.forEach((entry, i) => {
      items.push({
        kind: 'row',
        key: `row:${entry.agent.trigger_id}`,
        entry,
        groupId: group.id,
        lastInGroup: i === group.entries.length - 1,
      });
      rowCount += 1;
    });
  }

  return { items, headerIndexes, rowCount };
}

/**
 * Row count at which the grouped view switches from plain rendering to
 * windowing. Below it the whole list is a handful of nodes and the plain
 * (already-shipped) markup is used verbatim; above it the DOM cost is what the
 * perf walk flagged. Deliberately low enough that any realistic multi-team
 * install lands in the windowed path.
 */
export const SCHEDULE_WINDOWING_THRESHOLD = 24;

/** Estimated collapsed height of one `ScheduleRow`, in px (before measurement). */
export const ESTIMATED_SCHEDULE_ROW_HEIGHT = 64;

/** Height of a flattened group header, in px (label + divider + its margin). */
export const SCHEDULE_GROUP_HEADER_HEIGHT = 30;
