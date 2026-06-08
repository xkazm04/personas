import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { MergedChannels, MergedRow, type FeedTeam, type TaggedItem } from './collabMergedFeed';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * SWIMLANES — one column, grouped by team.
 *
 * Instead of interleaving, each selected team is a collapsible SECTION stacked
 * vertically: a sticky team header (colour · name · count · presence) over the
 * team's recent rows. The team is named once (the header), so rows stay clean
 * and you scan team-by-team without losing the single-column compactness. This
 * is the "grouped-but-combined" hypothesis — legibility over raw interleaving.
 */
const PER_TEAM_PREVIEW = 8;

export function MonitorChannelSwimlanes({ teams }: { teams: FeedTeam[] }) {
  const { t, tx } = useTranslation();
  const personaIndex = usePersonaIndex();
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const showAll = (id: string) =>
    setExpandedTeams((prev) => new Set(prev).add(id));

  return (
    <MergedChannels teams={teams}>
      {(_merged, presenceByTeam, byTeam) => (
        <div className="h-full flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
            {teams.map((tm) => {
              const rows: TaggedItem[] = byTeam.get(tm.teamId) ?? [];
              const isCollapsed = collapsed.has(tm.teamId);
              const pres = presenceByTeam.get(tm.teamId);
              let working = 0;
              if (pres) for (const st of pres.values()) if (st === 'working') working++;
              const limit = expandedTeams.has(tm.teamId) ? rows.length : PER_TEAM_PREVIEW;
              const visible = rows.slice(0, limit);
              return (
                <div key={tm.teamId} className="rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
                  {/* Team header (sticky within the section) */}
                  <button
                    type="button"
                    onClick={() => toggle(tm.teamId)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-foreground/[0.02] border-b border-border hover:bg-foreground/[0.04] transition-colors"
                    style={{ boxShadow: `inset 3px 0 0 ${tm.teamColor}` }}
                  >
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-foreground/40" /> : <ChevronDown className="w-3.5 h-3.5 text-foreground/40" />}
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tm.teamColor }} />
                    <span className="typo-body font-semibold text-foreground truncate">{tm.teamName}</span>
                    {working > 0 && <span className="typo-caption text-status-info flex-shrink-0">{working} working</span>}
                    <span className="ml-auto typo-caption text-foreground/40 tabular-nums flex-shrink-0">{rows.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="px-1.5 py-1.5 space-y-0.5">
                      {rows.length === 0 ? (
                        <p className="px-2 py-2 typo-caption text-foreground/40">{t.monitor.channels_combined_quiet}</p>
                      ) : (
                        <>
                          {visible.map((tagged) => (
                            <MergedRow
                              key={`${tm.teamId}:${tagged.item.id}`}
                              tagged={tagged}
                              showTeam={false}
                              personaIndex={personaIndex}
                              onOpen={() => setDetail(tagged.item)}
                            />
                          ))}
                          {rows.length > limit && (
                            <button
                              type="button"
                              onClick={() => showAll(tm.teamId)}
                              className="w-full text-center py-1 typo-caption text-foreground/45 hover:text-foreground/75 transition-colors"
                            >
                              {tx(t.monitor.channels_show_more, { count: rows.length - limit })}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
        </div>
      )}
    </MergedChannels>
  );
}

export default MonitorChannelSwimlanes;
