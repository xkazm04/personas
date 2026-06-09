import { useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { useGroupedVirtualizer, GroupHeaderRow, GROUP_HEADER_SIZE } from '@/features/shared/components/display/GroupedVirtualList';
import { buildGroupRows, timeGroupKey, timeGroupLabels } from '@/features/shared/components/display/grouping';
import { MergedRow } from './MergedRow';
import { MERGED_ROW_HEIGHT, type TaggedItem } from './types';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * The virtualized, day-grouped merged stream (sticky Today / Yesterday / …
 * headers + jump-to-newest). Its own component so `useGroupedVirtualizer` isn't
 * called inside a render-prop. Shared by the combined Timeline and the
 * flagship Channel Timeline workspace.
 */
export function VirtualStream({
  rows: data,
  personaIndex,
  onOpen,
  emptyLabel,
}: {
  rows: TaggedItem[];
  personaIndex: ReturnType<typeof usePersonaIndex>;
  onOpen: (item: TeamChannelItem) => void;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // Animate ONLY genuinely-new rows in (a row arrived in the last few seconds
  // and hasn't been shown before). The seen-set means scrolling an old row into
  // view never re-fires the entrance — critical for the virtualized list.
  const seenRef = useRef<Set<string>>(new Set());

  const labels = useMemo(() => timeGroupLabels(t), [t]);
  const { rows, headerIndexes } = useMemo(
    () => buildGroupRows(data, (tagged) => { const key = timeGroupKey(tagged.item.at); return { key, label: labels[key] }; }),
    [data, labels],
  );

  const { virtualizer } = useGroupedVirtualizer({
    count: rows.length,
    headerIndexes,
    getScrollElement: () => scrollRef.current,
    itemSize: MERGED_ROW_HEIGHT,
  });

  if (data.length === 0) {
    return <div className="flex-1 flex items-center justify-center typo-body text-foreground/45">{emptyLabel}</div>;
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 240)}
        className="absolute inset-0 overflow-y-auto px-2 py-2"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index];
            if (!row) return null;
            if (row.kind === 'header') {
              return (
                <GroupHeaderRow
                  key={`h:${v.index}:${row.key}`}
                  label={row.label}
                  count={row.count}
                  // Non-sticky: the day header scrolls with its rows instead of
                  // pinning to the top (the pinned "Today" lingered unhelpfully).
                  pinned={false}
                  start={v.start}
                  height={GROUP_HEADER_SIZE}
                />
              );
            }
            const id = row.item.item.id;
            const at = Date.parse(row.item.item.at);
            // The recency window is what actually decides whether a row animates;
            // the seen-set only stops a *fresh* row re-firing when it scrolls out
            // and back. So it never needs to hold more than the recently-arrived
            // ids — bound it (clear past a cap) so a long session can't grow it
            // without limit. Old rows are already excluded by the time gate, so a
            // clear can't make a stale row animate.
            const recent = Number.isFinite(at) && Date.now() - at < 8000;
            const fresh = recent && !seenRef.current.has(id);
            if (recent) {
              if (seenRef.current.size > 600) seenRef.current.clear();
              seenRef.current.add(id);
            }
            return (
              <div
                key={`${row.item.team.teamId}:${id}`}
                className={fresh ? 'animate-channel-row-in rounded-card' : undefined}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: MERGED_ROW_HEIGHT, transform: `translateY(${v.start}px)` }}
              >
                <MergedRow tagged={row.item} showTeam personaIndex={personaIndex} onOpen={onOpen} />
              </div>
            );
          })}
        </div>
      </div>
      {scrolled && (
        <button
          type="button"
          onClick={() => { virtualizer.scrollToIndex(0); setScrolled(false); }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/25 bg-background/90 shadow-elevation-2 typo-caption text-foreground hover:bg-secondary/40 transition-colors"
        >
          <ArrowUp className="w-3.5 h-3.5" /> {t.monitor.channels_jump_newest}
        </button>
      )}
    </div>
  );
}

export default VirtualStream;
