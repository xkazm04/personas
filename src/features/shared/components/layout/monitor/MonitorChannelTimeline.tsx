import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Radio, Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { MergedChannels, MergedRow, MERGED_ROW_HEIGHT, type FeedTeam, type TaggedItem } from './collabMergedFeed';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * TIMELINE — one combined cross-team stream.
 *
 * Every selected team's traffic merges into ONE chronological feed, newest
 * first. Each row carries a team-colour left rail + a compact team badge so the
 * source is unmistakable while everything reads as a single mission log. The
 * list is VIRTUALIZED — only the visible rows mount — so hundreds of merged
 * rows stay smooth and cheap (the merge window itself is capped upstream).
 */

/** Virtualized row list — its own component so `useVirtualizer` isn't called
 *  inside the MergedChannels render-prop. */
function VirtualStream({
  rows,
  personaIndex,
  onOpen,
}: {
  rows: TaggedItem[];
  personaIndex: ReturnType<typeof usePersonaIndex>;
  onOpen: (item: TeamChannelItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => MERGED_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => {
      const r = rows[i];
      return r ? `${r.team.teamId}:${r.item.id}` : String(i);
    },
  });

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const tagged = rows[v.index];
          if (!tagged) return null;
          return (
            <div
              key={v.key}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: MERGED_ROW_HEIGHT, transform: `translateY(${v.start}px)` }}
            >
              <MergedRow tagged={tagged} showTeam personaIndex={personaIndex} onOpen={onOpen} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MonitorChannelTimeline({ teams }: { teams: FeedTeam[] }) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);

  return (
    <MergedChannels teams={teams}>
      {(merged, presenceByTeam) => {
        let working = 0;
        for (const pres of presenceByTeam.values()) {
          for (const st of pres.values()) if (st === 'working') working++;
        }
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
              <div className="flex-1" />
              {/* Team legend */}
              <div className="flex items-center gap-2 flex-wrap justify-end max-w-[50%]">
                {teams.map((tm) => (
                  <span key={tm.teamId} className="inline-flex items-center gap-1 typo-caption text-foreground/60" title={tm.teamName}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tm.teamColor }} />
                    <span className="max-w-[90px] truncate">{tm.teamName.replace(/^SDLC[ —-]*/i, '') || tm.teamName}</span>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3 typo-data text-foreground tabular-nums pl-3 border-l border-border">
                <span className="flex items-center gap-1.5" title="Transmissions"><Activity className="w-4 h-4 text-foreground/45" /> {merged.length}</span>
                {working > 0 && <span className="text-status-info">{working} working</span>}
              </div>
            </div>

            {/* Unified, virtualized stream */}
            {merged.length === 0 ? (
              <div className="flex-1 flex items-center justify-center typo-body text-foreground/45">{t.monitor.channels_combined_quiet}</div>
            ) : (
              <VirtualStream rows={merged} personaIndex={personaIndex} onOpen={setDetail} />
            )}

            <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
          </div>
        );
      }}
    </MergedChannels>
  );
}

export default MonitorChannelTimeline;
