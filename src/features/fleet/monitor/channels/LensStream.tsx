import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { useGroupedVirtualizer, GroupHeaderRow, GROUP_HEADER_SIZE } from '@/features/shared/components/display/GroupedVirtualList';
import { buildGroupRows, timeGroupKey, timeGroupLabels } from '@/features/shared/components/display/grouping';
import { StreamRow, ROW_HEIGHT } from './StreamRow';
import type { TaggedItem } from './types';

/**
 * LENS STREAM — the virtualized, day-grouped log.
 *
 * Supersedes `VirtualStream`. Same TanStack machinery, but rows render through
 * the shared `StreamRow` and the list is day-grouped. Fixed 30px itemSize — the
 * log commits to one density, so the virtualizer never has to measure.
 * Entrance animation is gated to genuinely-new rows (<8s old, unseen); scrolling
 * an old row back into view must never re-fire it (plan §5.4).
 */
export function LensStream({
  rows: data, onOpen, emptyLabel, hasMore, onEndReached,
}: {
  rows: TaggedItem[];
  onOpen: (row: TaggedItem) => void;
  emptyLabel: string;
  hasMore?: boolean;
  /** Fired once when the tail scrolls into view — pages the merge deeper. */
  onEndReached?: () => void;
}) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  // One in-flight page at a time; released when new rows land.
  const fetching = useRef(false);
  useEffect(() => { fetching.current = false; }, [data.length]);

  const labels = useMemo(() => timeGroupLabels(t), [t]);
  const { rows, headerIndexes } = useMemo(
    () => buildGroupRows(data, (tagged) => { const key = timeGroupKey(tagged.item.at); return { key, label: labels[key] }; }),
    [data, labels],
  );

  const { virtualizer } = useGroupedVirtualizer({
    count: rows.length,
    headerIndexes,
    getScrollElement: () => scrollRef.current,
    itemSize: ROW_HEIGHT,
  });

  if (data.length === 0) {
    return <div className="flex-1 flex items-center justify-center typo-body text-foreground/60">{emptyLabel}</div>;
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setScrolled(el.scrollTop > 240);
          // Within a screen of the tail → page the merge deeper. Guarded by a
          // ref so a burst of scroll events fires exactly one fetch.
          if (hasMore && onEndReached && !fetching.current) {
            const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (remaining < el.clientHeight) {
              fetching.current = true;
              onEndReached();
            }
          }
        }}
        className="absolute inset-0 overflow-y-auto"
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
                  pinned={false}
                  start={v.start}
                  height={GROUP_HEADER_SIZE}
                />
              );
            }
            const id = row.item.item.id;
            const at = Date.parse(row.item.item.at);
            const recent = Number.isFinite(at) && Date.now() - at < 8000;
            const fresh = recent && !seenRef.current.has(id);
            if (recent) {
              if (seenRef.current.size > 600) seenRef.current.clear();
              seenRef.current.add(id);
            }
            const persona = row.item.item.personaId ? personaIndex.get(row.item.item.personaId) : undefined;
            return (
              <div
                key={`${row.item.team.teamId}:${id}`}
                className={fresh ? 'animate-channel-row-in' : undefined}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_HEIGHT, transform: `translateY(${v.start}px)` }}
              >
                <StreamRow row={row.item} persona={persona} onOpen={onOpen} />
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
