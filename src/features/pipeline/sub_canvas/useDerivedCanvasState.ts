import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import type { PipelineAnalytics } from '@/lib/bindings/PipelineAnalytics';
import type { DryRunState } from '@/features/pipeline/sub_canvas/DryRunDebugger';

export interface PipelineNodeStatus {
  member_id: string;
  persona_id: string;
  status: string;
  execution_id?: string;
  output?: string;
  error?: string;
}

interface PersonaInfo {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
}

/**
 * Single-pass derivation of React Flow nodes and edges from source data.
 *
 * Replaces 5 individual useEffect hooks that each called setNodes/setEdges
 * (base derivation, pipeline status enrichment, optimizer highlights,
 * edge active state, dry-run decorations) with one useMemo that computes
 * the final enriched arrays in a single pass.
 */
export function useDerivedCanvasState({
  selectedTeamId,
  teamMembers,
  teamConnections,
  personas,
  pipelineNodeStatuses,
  analytics,
  dismissedSuggestionIds,
  dryRunState,
  snapToGrid,
}: {
  selectedTeamId: string | null;
  teamMembers: PersonaTeamMember[];
  teamConnections: PersonaTeamConnection[];
  personas: PersonaInfo[];
  pipelineNodeStatuses: PipelineNodeStatus[];
  analytics: PipelineAnalytics | null;
  dismissedSuggestionIds: Set<string>;
  dryRunState: DryRunState | null;
  snapToGrid: (v: number) => number;
}) {
  return useMemo(() => {
    if (!selectedTeamId) return { nodes: [] as Node[], edges: [] as Edge[] };

    const edgeCount = teamConnections.length;

    // Build lookup maps once for O(1) access instead of repeated .find()
    const personaMap = new Map(personas.map((p) => [p.id, p]));
    const statusMap = new Map(
      pipelineNodeStatuses.map((s) => [s.member_id, s]),
    );
    const activeSuggestions = (analytics?.suggestions ?? []).filter(
      (s) => !dismissedSuggestionIds.has(s.id),
    );

    // ---- NODES: single-pass derivation ----
    const nodes: Node[] = teamMembers.map((m, i) => {
      const persona = personaMap.get(m.persona_id);
      const data: Record<string, unknown> = {
        name: persona?.name || 'Agent',
        icon: persona?.icon || '',
        color: persona?.color || '#6366f1',
        role: m.role || 'worker',
        memberId: m.id,
        personaId: m.persona_id,
        edgeCount,
      };

      // Pipeline status enrichment
      const ns = statusMap.get(m.id);
      if (ns) {
        data.pipelineStatus = ns.status;
      }

      // Optimizer: highlight nodes that have active suggestions
      const memberSuggestions = activeSuggestions.filter((s) =>
        s.affected_member_ids.includes(m.id),
      );
      data.hasOptimizerSuggestion = memberSuggestions.length > 0;
      if (memberSuggestions.length > 0) {
        data.optimizerType = memberSuggestions[0]?.suggestion_type;
      }

      // Dry-run decorations
      if (dryRunState) {
        const nodeState = dryRunState.nodeData.get(m.id);
        data.dryRunStatus = nodeState?.status ?? undefined;
        data.hasBreakpoint = dryRunState.breakpoints.has(m.id);
      }

      return {
        id: m.id,
        type: 'persona' as const,
        position: {
          x: m.position_x ?? snapToGrid(100 + (i % 4) * 220),
          y: m.position_y ?? snapToGrid(80 + Math.floor(i / 4) * 140),
        },
        data,
      };
    });

    // ---- EDGES: single-pass derivation ----

    // Real edges from team connections
    const realEdges: Edge[] = teamConnections.map((c) => {
      const data: Record<string, unknown> = {
        connection_type: c.connection_type,
        label: c.label || '',
      };

      // Pipeline active state (edge lights up when data flows through it)
      if (pipelineNodeStatuses.length > 0) {
        const sourceStatus = statusMap.get(c.source_member_id)?.status;
        const targetStatus = statusMap.get(c.target_member_id)?.status;
        data.isActive =
          sourceStatus === 'completed' && targetStatus === 'running';
      }

      // Dry-run edge decorations
      if (dryRunState) {
        const edgeKey = `${c.source_member_id}->${c.target_member_id}`;
        data.dryRunCompleted = dryRunState.completedEdges.has(edgeKey);
        data.dryRunActive = dryRunState.activeEdge === edgeKey;
      }

      return {
        id: c.id,
        source: c.source_member_id,
        target: c.target_member_id,
        type: 'connection',
        data,
      };
    });

    // Ghost edges from optimizer suggestions
    const ghostEdges: Edge[] = activeSuggestions
      .filter((s) => s.suggested_source && s.suggested_target)
      .filter(
        (s) =>
          !teamConnections.some(
            (c) =>
              c.source_member_id === s.suggested_source &&
              c.target_member_id === s.suggested_target,
          ),
      )
      .map((s) => ({
        id: `ghost-${s.id}`,
        source: s.suggested_source!,
        target: s.suggested_target!,
        type: 'ghost',
        selectable: false,
        data: {
          connection_type: s.suggested_connection_type || 'parallel',
          suggestion_id: s.id,
        },
      }));

    return { nodes, edges: [...realEdges, ...ghostEdges] };
  }, [
    selectedTeamId,
    teamMembers,
    teamConnections,
    personas,
    pipelineNodeStatuses,
    analytics,
    dismissedSuggestionIds,
    dryRunState,
    snapToGrid,
  ]);
}
