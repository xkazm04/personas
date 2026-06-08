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

  const labels = useMemo(() => timeGroupLabels(t), [t]);
  const { rows, headerIndexes } = useMemo(
    () => buildGroupRows(data, (tagged) => { const key = timeGroupKey(tagged.item.at); return { key, label: labels[key] }; }),
    [data, labels],
  );

  const { virtualizer, activeStickyRef } = useGroupedVirtualizer({
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
                  pinned={activeStickyRef.current === v.index}
                  start={v.start}
                  height={GROUP_HEADER_SIZE}
                />
              );
            }
            return (
              <div
                key={`${row.item.team.teamId}:${row.item.item.id}`}
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
