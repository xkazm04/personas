/**
 * The changes grouped by day under sticky day heads, virtualised (a step
 * detail carries up to 200 changes): the shared grouped virtualizer
 * (`useGroupedVirtualizer` + `buildGroupRows`, the mechanics of
 * `GroupedVirtualList`) with rows MEASURED, because a change's note is shown
 * in full and rows differ in height. The day head is drawn here, in the
 * module's type roles, because the shared head is a page-level title and this
 * list sits inside a level-2 section. Heads are measured too: the cache is by
 * index, and after a filter an index that held a row may hold a head.
 */
import { useCallback, useMemo, useRef } from 'react';

import { useGroupedVirtualizer } from '@/features/shared/components/display/GroupedVirtualList';
import { buildGroupRows, type GroupSpec } from '@/features/shared/components/display/grouping';
import { useTranslation } from '@/i18n/useTranslation';

import type { EvidenceRow } from '../../blocks/evidenceRows';
import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { dayAsUtcDate, localDay } from './adherence';
import { dayOfRow } from './timeline';
import { TIMELINE_TEST_ID, TimelineRow } from './TimelineRow';

const DAY_HEAD_PX = 34;
/** A row without a note; rows are measured once drawn. */
const ROW_ESTIMATE_PX = 64;

function DayHead({ label, count, pinned, start, index, measure }: { label: string; count: number; pinned: boolean; start: number; index: number; measure: (el: Element | null) => void }) {
  const place = pinned
    ? { position: 'sticky' as const, top: 0 }
    : { position: 'absolute' as const, top: 0, transform: `translateY(${start}px)` };
  return (
    <div
      ref={measure}
      data-index={index}
      className="z-10 flex w-full items-center gap-3 border-b border-primary/10 bg-background px-3"
      style={{ ...place, left: 0, height: DAY_HEAD_PX }}
      data-testid={`${TIMELINE_TEST_ID}-day`}
    >
      <span className={LT.eyebrow}>{label}</span>
      <span className={LT.metaNum}>{count}</span>
    </div>
  );
}

export function TimelineList({ rows, onOpen }: { rows: EvidenceRow[]; onOpen: (row: EvidenceRow) => void }) {
  const { t, dl } = useLifecycleViewModel();
  const { language } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const words = useMemo(() => {
    const dayFmt = new Intl.DateTimeFormat(language, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const timeFmt = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' });
    const today = localDay(Date.now());
    const dayLabel = (day: number) =>
      day === today ? t.shared.group_today : day === today - 1 ? t.shared.group_yesterday : dayFmt.format(dayAsUtcDate(day));
    const time = (iso: string) => { const ms = Date.parse(iso); return Number.isNaN(ms) ? '' : timeFmt.format(ms); };
    return { dayLabel, time };
  }, [language, t]);

  const groupOf = useCallback((r: EvidenceRow): GroupSpec => {
    const day = dayOfRow(r);
    return { key: String(day), label: words.dayLabel(day) };
  }, [words]);
  const { rows: flat, headerIndexes } = useMemo(() => buildGroupRows(rows, groupOf), [rows, groupOf]);
  const { virtualizer, activeStickyRef } = useGroupedVirtualizer({
    count: flat.length,
    headerIndexes,
    getScrollElement: () => scrollRef.current,
    itemSize: ROW_ESTIMATE_PX,
    headerSize: DAY_HEAD_PX,
  });

  return (
    <div
      ref={scrollRef}
      className="max-h-[34rem] overflow-y-auto rounded-card border border-primary/10"
      role="region"
      aria-label={dl.lcx8_timeline_label}
      data-testid={TIMELINE_TEST_ID}
      data-rows={rows.length}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = flat[v.index];
          if (!row) return null;
          if (row.kind === 'header') {
            return <DayHead key={`day:${row.key}`} label={row.label} count={row.count} pinned={activeStickyRef.current === v.index} start={v.start} index={v.index} measure={virtualizer.measureElement} />;
          }
          return (
            <div
              key={row.item.key}
              ref={virtualizer.measureElement}
              data-index={v.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${v.start}px)` }}
            >
              <TimelineRow row={row.item} time={words.time(row.item.item.occurredAt)} onOpen={onOpen} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
