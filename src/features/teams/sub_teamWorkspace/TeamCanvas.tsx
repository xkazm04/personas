import { usePipelineStore } from '@/stores/pipelineStore';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import TeamList from './TeamList';
import { TeamStudioSplitVariant } from './teamStudio/TeamStudioSplitVariant';
import { PresetStudio } from './presetStudio';

/**
 * Selected-team view. The /prototype round (2026-05-23) replaced the
 * React Flow DAG canvas with the Split Studio — roster + per-member
 * capability toggles + a no-wiring orchestration console. The old
 * edge-wiring canvas (sub_canvas/, canvas/, AutoTeam) is no longer
 * rendered; those files are now orphaned and slated for removal in a
 * follow-up cleanup.
 *
 * - No team selected → the Teams management table (`TeamList`).
 * - Team selected   → `TeamStudioSplitVariant`.
 *
 * (Filename kept as TeamCanvas.tsx to avoid churning the single
 * PersonasPage import; it's no longer a canvas.)
 */
export default function TeamCanvas() {
  const selectedTeamId = usePipelineStore((s) => s.selectedTeamId);
  const teams = usePipelineStore((s) => s.teams);
  const selectTeam = usePipelineStore((s) => s.selectTeam);
  const presetFlowOpen = usePipelineStore((s) => s.presetFlowOpen);

  // In-app preset-adoption flow takes over the content area when open
  // (entered from the "Preset Team" affordances in TeamList).
  if (presetFlowOpen) {
    return <PresetStudio />;
  }

  if (!selectedTeamId) {
    return <TeamList />;
  }

  const teamName = teams.find((t) => t.id === selectedTeamId)?.name ?? 'Team';

  return (
    <ContentBox minWidth={0} data-testid="team-canvas">
      <TeamStudioSplitVariant
        teamId={selectedTeamId}
        teamName={teamName}
        onBack={() => selectTeam(null)}
      />
    </ContentBox>
  );
}
