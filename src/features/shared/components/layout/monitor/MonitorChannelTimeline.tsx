import { useState } from 'react';
import { Radio, Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { MergedChannels, MergedRow, type FeedTeam } from './collabMergedFeed';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * TIMELINE — one combined cross-team stream.
 *
 * Every selected team's traffic merges into ONE chronological feed, newest
 * first. Each row carries a team-colour left rail + a compact team badge so
 * the source is unmistakable while everything reads as a single mission log.
 * The header glances the merged totals (teams · transmissions · working). This
 * is the "is interleaved legible?" hypothesis — maximum density, one column.
 */
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

            {/* Unified stream */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
              {merged.length === 0 ? (
                <div className="h-full flex items-center justify-center typo-body text-foreground/45">{t.monitor.channels_combined_quiet}</div>
              ) : (
                <div className="space-y-0.5">
                  {merged.map((tagged) => (
                    <MergedRow
                      key={`${tagged.team.teamId}:${tagged.item.id}`}
                      tagged={tagged}
                      showTeam
                      personaIndex={personaIndex}
                      onOpen={() => setDetail(tagged.item)}
                    />
                  ))}
                </div>
              )}
            </div>

            <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
          </div>
        );
      }}
    </MergedChannels>
  );
}

export default MonitorChannelTimeline;
