import TeamMemoryPanel from './components/panel/TeamMemoryPanel';
import { useTeamMemories } from './useTeamMemories';

/**
 * Team-studio pane host for the shared-memory ledger — composes the
 * `useTeamMemories` data layer with the panel UI in `pane` layout (fills the
 * studio's right pane instead of floating over a canvas).
 */
export function TeamMemoryPane({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const data = useTeamMemories(teamId);
  return (
    <TeamMemoryPanel
      teamId={teamId}
      layout="pane"
      memories={data.memories}
      total={data.total}
      stats={data.stats}
      onClose={onClose}
      onDelete={data.onDelete}
      onImportanceChange={data.onImportanceChange}
      onCreate={data.onCreate}
      onFilter={data.onFilter}
      onLoadMore={data.onLoadMore}
      onFilterByRun={data.onFilterByRun}
      onEdit={data.onEdit}
    />
  );
}

export default TeamMemoryPane;
