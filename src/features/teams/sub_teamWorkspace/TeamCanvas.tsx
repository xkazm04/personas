import { useEffect } from 'react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { TeamStudioSplitVariant } from './teamStudio/TeamStudioSplitVariant';
import { PresetStudio } from './presetStudio';

/**
 * Selected-team detail — the ONLY thing `teamsTab: 'workspace'` renders.
 *
 * The Teams management table (`TeamList`) that used to fill this route when no
 * team was selected was retired (2026-08-26): a project now owns exactly one
 * team, so the section's landing page is Manage (`teamsTab: 'projects'`) and a
 * team is entered from a project row. Landing here with nothing selected is
 * therefore a stale-navigation case (a deep link, a persisted tab from an older
 * build, a caller that still says "open the team list") — redirect to Manage
 * rather than render a list that no longer exists.
 *
 * - Preset flow open → `PresetStudio` (unchanged).
 * - No team selected → redirect to Manage.
 * - Team selected    → `TeamStudioSplitVariant`.
 *
 * (Filename kept as TeamCanvas.tsx to avoid churning the single
 * PersonasPage/sectionRouter import; it's no longer a canvas.)
 */
export default function TeamCanvas() {
  const selectedTeamId = usePipelineStore((s) => s.selectedTeamId);
  const teams = usePipelineStore((s) => s.teams);
  const selectTeam = usePipelineStore((s) => s.selectTeam);
  const presetFlowOpen = usePipelineStore((s) => s.presetFlowOpen);
  const setTeamsTab = useSystemStore((s) => s.setTeamsTab);

  // Redirect, not a render-time set: mutating another store during render is
  // the classic cross-store tearing bug. The effect is a no-op on every normal
  // visit (a team is always selected before this route is entered).
  useEffect(() => {
    if (!presetFlowOpen && !selectedTeamId) setTeamsTab('projects');
  }, [presetFlowOpen, selectedTeamId, setTeamsTab]);

  // In-app preset-adoption flow takes over the content area when open.
  if (presetFlowOpen) {
    return <PresetStudio />;
  }

  if (!selectedTeamId) {
    // One frame of calm chrome while the effect above swaps the tab.
    return <RouteChunkSkeleton />;
  }

  const teamName = teams.find((t) => t.id === selectedTeamId)?.name ?? 'Team';

  return (
    <ContentBox minWidth={0} data-testid="team-canvas">
      <TeamStudioSplitVariant
        teamId={selectedTeamId}
        teamName={teamName}
        onBack={() => { selectTeam(null); setTeamsTab('projects'); }}
      />
    </ContentBox>
  );
}
