import { useTranslation } from '@/i18n/useTranslation';
import { Users } from 'lucide-react';
import { usePipelineStore } from "@/stores/pipelineStore";
import {
  NodeContextMenu,
  EdgeDeleteTooltip,
  PipelineControls,
  OptimizerPanel,
  CanvasAssistant,
  DryRunDebugger,
} from '@/features/pipeline/sub_canvas';
import type { CanvasState, CanvasAction, MemberWithPersonaInfo } from '@/features/pipeline/sub_canvas';
import { TeamMemoryPanel, TeamMemoryBadge } from '@/features/pipeline/sub_teamMemory';
import TeamConfigPanel from '../TeamConfigPanel';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import type { TopologySuggestion } from '@/lib/bindings/TopologySuggestion';
import type { TopologyBlueprint } from '@/lib/bindings/TopologyBlueprint';
import type { DryRunState } from '@/features/pipeline/sub_canvas';

interface CanvasOverlaysProps {
  cs: CanvasState;
  dispatch: React.Dispatch<CanvasAction>;
  selectedTeamId: string;
  teamMembers: PersonaTeamMember[];
  teamConnections: PersonaTeamConnection[];
  agentNames: Record<string, string>;
  agentRoles: Record<string, string>;
  fetchAnalytics: () => Promise<void>;
  handleAcceptSuggestion: (s: TopologySuggestion) => Promise<void>;
  handleDismissSuggestion: (id: string) => void;
  handleAssistantSuggest: (query: string) => Promise<TopologyBlueprint>;
  handleAssistantApply: (blueprint: TopologyBlueprint) => Promise<void>;
  handleExecuteTeam: () => Promise<void>;
  handleStartDryRun: () => void;
  handleDryRunStateChange: (state: DryRunState) => void;
  handleCloseDryRun: () => void;
  handleRoleChange: (memberId: string, newRole: string) => Promise<void>;
  handleRemoveMember: (memberId: string) => void;
  handleDeleteEdge: () => Promise<void>;
  handleChangeConnectionType: (newType: string) => Promise<void>;
  setSelectedMember: (member: MemberWithPersonaInfo | null) => void;
  setContextMenu: (menu: CanvasState['contextMenu']) => void;
  setEdgeTooltip: (tooltip: CanvasState['edgeTooltip']) => void;
}

export default function CanvasOverlays({
  cs, dispatch, selectedTeamId, teamMembers, teamConnections,
  agentNames, agentRoles, fetchAnalytics,
  handleAcceptSuggestion, handleDismissSuggestion,
  handleAssistantSuggest, handleAssistantApply,
  handleExecuteTeam, handleStartDryRun,
  handleDryRunStateChange, handleCloseDryRun,
  handleRoleChange, handleRemoveMember,
  handleDeleteEdge, handleChangeConnectionType,
  setSelectedMember, setContextMenu, setEdgeTooltip,
}: CanvasOverlaysProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const teamMemories = usePipelineStore((s) => s.teamMemories);
  const teamMemoriesTotal = usePipelineStore((s) => s.teamMemoriesTotal);
  const teamMemoryStats = usePipelineStore((s) => s.teamMemoryStats);
  const memoryFilterCategory = usePipelineStore((s) => s.memoryFilterCategory);
  const memoryFilterSearch = usePipelineStore((s) => s.memoryFilterSearch);
  const fetchTeamMemories = usePipelineStore((s) => s.fetchTeamMemories);
  const loadMoreTeamMemories = usePipelineStore((s) => s.loadMoreTeamMemories);
  const createTeamMemory = usePipelineStore((s) => s.createTeamMemory);
  const deleteTeamMemory = usePipelineStore((s) => s.deleteTeamMemory);
  const updateTeamMemoryImportance = usePipelineStore((s) => s.updateTeamMemoryImportance);
  const updateTeamMemory = usePipelineStore((s) => s.updateTeamMemory);
  const filterByRunId = usePipelineStore((s) => s.filterByRunId);

  return (
    <>
      <TeamMemoryBadge
        count={teamMemoriesTotal}
        isOpen={cs.memoryPanelOpen}
        isPulsing={cs.memoriesPulsing}
        onClick={() => dispatch({ type: 'SET_MEMORY_PANEL_OPEN', open: true })}
      />

      {cs.memoryPanelOpen && (
          <TeamMemoryPanel
            teamId={selectedTeamId}
            memories={teamMemories}
            total={teamMemoriesTotal}
            stats={teamMemoryStats}
            onClose={() => dispatch({ type: 'SET_MEMORY_PANEL_OPEN', open: false })}
            onDelete={deleteTeamMemory}
            onImportanceChange={updateTeamMemoryImportance}
            onCreate={createTeamMemory}
            onFilter={(category, search) => fetchTeamMemories(selectedTeamId, category, search)}
            onLoadMore={() => loadMoreTeamMemories(selectedTeamId, memoryFilterCategory, memoryFilterSearch)}
            onFilterByRun={(runId) => filterByRunId(selectedTeamId, runId)}
            onEdit={(id, title, content, category, importance) => updateTeamMemory(id, title, content, category, importance)}
          />
        )}

      <CanvasAssistant
        onSuggest={handleAssistantSuggest}
        onApply={handleAssistantApply}
        isApplying={cs.assistantApplying}
        memberCount={teamMembers.length}
      />

      {teamMembers.length > 0 && (
        <OptimizerPanel
          analytics={cs.analytics}
          loading={cs.analyticsLoading}
          onAcceptSuggestion={handleAcceptSuggestion}
          onDismissSuggestion={handleDismissSuggestion}
          onRefresh={fetchAnalytics}
          dismissedIds={cs.dismissedSuggestionIds}
        />
      )}

      {!cs.dryRunActive && (
        <PipelineControls
          teamId={selectedTeamId}
          isRunning={cs.pipelineRunning}
          isDryRunActive={cs.dryRunActive}
          nodeStatuses={cs.pipelineNodeStatuses}
          onExecute={handleExecuteTeam}
          onDryRun={handleStartDryRun}
          agentNames={agentNames}
        />
      )}

      {cs.dryRunActive && (
        <DryRunDebugger
          members={teamMembers}
          connections={teamConnections}
          agentNames={agentNames}
          agentRoles={agentRoles}
          onStateChange={handleDryRunStateChange}
          onClose={handleCloseDryRun}
        />
      )}

      {cs.selectedMember && (
        <TeamConfigPanel
          member={cs.selectedMember}
          onClose={() => setSelectedMember(null)}
          onRoleChange={handleRoleChange}
          onRemove={handleRemoveMember}
        />
      )}

      {cs.contextMenu && (
        <NodeContextMenu
          x={cs.contextMenu.x}
          y={cs.contextMenu.y}
          memberName={cs.contextMenu.member.persona_name || 'Agent'}
          currentRole={cs.contextMenu.member.role || 'worker'}
          onChangeRole={(role) => handleRoleChange(cs.contextMenu!.member.id, role)}
          onRemove={() => { handleRemoveMember(cs.contextMenu!.member.id); setContextMenu(null); }}
          onConfigure={() => { setSelectedMember(cs.contextMenu!.member); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {cs.edgeTooltip && (
          <EdgeDeleteTooltip
            x={cs.edgeTooltip.x}
            y={cs.edgeTooltip.y}
            connectionType={(cs.edgeTooltip.edge.data as Record<string, unknown>)?.connection_type as string || 'sequential'}
            label={(cs.edgeTooltip.edge.data as Record<string, unknown>)?.label as string || ''}
            onDelete={handleDeleteEdge}
            onChangeType={handleChangeConnectionType}
            onClose={() => setEdgeTooltip(null)}
          />
        )}

      {teamMembers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Users className="w-8 h-8 text-indigo-400/50" />
            </div>
            <p className="text-sm font-medium text-foreground/80 mb-1">{pt.no_agents_in_team}</p>
            <p className="text-sm text-muted-foreground/80">{pt.drag_agents_hint}</p>
          </div>
        </div>
      )}
    </>
  );
}
