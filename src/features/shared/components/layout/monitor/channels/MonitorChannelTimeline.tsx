import { useMemo, useRef, useState } from 'react';
import { Radio, Activity, ArrowUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { useGroupedVirtualizer, GroupHeaderRow, GROUP_HEADER_SIZE } from '@/features/shared/components/display/GroupedVirtualList';
import { buildGroupRows, timeGroupKey, timeGroupLabels } from '@/features/shared/components/display/grouping';
import { MergedChannels } from './mergedFeed';
import { MergedRow } from './MergedRow';
import { matchesFilter } from './feedFilter';
import { MERGED_ROW_HEIGHT, type FeedTeam, type TaggedItem, type FeedFilter } from './types';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * TIMELINE — one combined cross-team stream.
 *
 * Every selected team's traffic merges into ONE chronological feed, newest
 * first, under sticky day headers (Today / Yesterday / …). Each row carries a
 * team-colour rail + badge so the source is unmistakable. A noise filter
 * (All / Signal / Alerts) cuts routine step churn; the list is VIRTUALIZED so
 * hundreds of rows stay smooth, and a jump-to-newest button returns to the top.
 */

const FILTERS: FeedFilter[] = ['all', 'signal', 'alerts'];

/** Virtualized, day-grouped stream — its own component so the virtualizer
 *  hooks aren't called inside the MergedChannels render-prop. */
function VirtualStream({
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

export function MonitorChannelTimeline({ teams }: { teams: FeedTeam[] }) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);
  const [filter, setFilter] = useState<FeedFilter>('all');

  const filterLabel: Record<FeedFilter, string> = {
    all: t.monitor.channels_filter_all,
    signal: t.monitor.channels_filter_signal,
    alerts: t.monitor.channels_filter_alerts,
  };

  return (
    <MergedChannels teams={teams}>
      {(merged, presenceByTeam) => {
        let working = 0;
        for (const pres of presenceByTeam.values()) {
          for (const st of pres.values()) if (st === 'working') working++;
        }
        const visible = filter === 'all' ? merged : merged.filter((r) => matchesFilter(r.item, filter));
        return (
          <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
            {/* Header band */}
            <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015] px-4 py-2.5 flex items-center gap-3">
              <div className="relative w-7 h-7 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
                <Radio className="w-3.5 h-3.5 text-status-error" />
              </div>
              <div className="min-w-0">
                <div className="typo-body font-semibold text-foreground leading-tight">{t.monitor.channels_combined_title}</div>
                <div className="typo-caption text-foreground/50 leading-tight">{t.monitor.channels_combined_subtitle}</div>
              </div>
              {/* Noise filter */}
              <div className="flex items-center gap-0.5 rounded-full bg-secondary/20 p-0.5 ml-2">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={`px-2.5 py-0.5 rounded-full typo-caption transition-colors ${
                      filter === f ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/50 hover:text-foreground/80'
                    }`}
                  >
                    {filterLabel[f]}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              {/* Team legend */}
              <div className="flex items-center gap-2 flex-wrap justify-end max-w-[42%]">
                {teams.map((tm) => (
                  <span key={tm.teamId} className="inline-flex items-center gap-1 typo-caption text-foreground/60" title={tm.teamName}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tm.teamColor }} />
                    <span className="max-w-[90px] truncate">{tm.teamName.replace(/^SDLC[ —-]*/i, '') || tm.teamName}</span>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3 typo-data text-foreground tabular-nums pl-3 border-l border-border">
                <span className="flex items-center gap-1.5" title="Transmissions"><Activity className="w-4 h-4 text-foreground/45" /> {visible.length}</span>
                {working > 0 && <span className="text-status-info">{working} working</span>}
              </div>
            </div>

            {/* Unified, day-grouped, virtualized stream */}
            <VirtualStream rows={visible} personaIndex={personaIndex} onOpen={setDetail} emptyLabel={t.monitor.channels_combined_quiet} />

            <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
          </div>
        );
      }}
    </MergedChannels>
  );
}

export default MonitorChannelTimeline;
