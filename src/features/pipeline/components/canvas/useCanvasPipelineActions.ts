import { useCallback, useEffect } from 'react';
import { errMsg } from '@/stores/storeTypes';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { usePipelineStore } from "@/stores/pipelineStore";
import { createLogger } from "@/lib/log";

const logger = createLogger("canvas-pipeline");
import { executeTeam, getPipelineAnalytics, suggestTopology, suggestTopologyLlm } from "@/api/pipeline/teams";
import type { PipelineNodeStatus, DryRunState } from '@/features/pipeline/sub_canvas';
import type { useCanvasReducer } from '@/features/pipeline/sub_canvas';
import type { TopologySuggestion } from '@/lib/bindings/TopologySuggestion';
import type { TopologyBlueprint } from '@/lib/bindings/TopologyBlueprint';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';

type CanvasReducerReturn = ReturnType<typeof useCanvasReducer>;

interface UseCanvasPipelineActionsArgs {
  cs: CanvasReducerReturn['state'];
  dispatch: CanvasReducerReturn['dispatch'];
}

export function useCanvasPipelineActions({ cs, dispatch }: UseCanvasPipelineActionsArgs) {
  const selectedTeamId = usePipelineStore((s) => s.selectedTeamId);
  const teamMembers = usePipelineStore((s) => s.teamMembers) as PersonaTeamMember[];
  const addTeamMember = usePipelineStore((s) => s.addTeamMember);
  const createTeamConnection = usePipelineStore((s) => s.createTeamConnection);
  const fetchTeamMemories = usePipelineStore((s) => s.fetchTeamMemories);

  // -- Analytics ------------------------------------------------------
  const fetchAnalytics = useCallback(async () => {
    if (!selectedTeamId) return;
    dispatch({ type: 'SET_ANALYTICS_LOADING', loading: true });
    try {
      const data = await getPipelineAnalytics(selectedTeamId);
      dispatch({ type: 'SET_ANALYTICS', analytics: data });
    } catch (err) { logger.error('Failed to fetch pipeline analytics', { error: errMsg(err, 'Unknown analytics error') }); }
    finally { dispatch({ type: 'SET_ANALYTICS_LOADING', loading: false }); }
  }, [selectedTeamId, dispatch]);

  useEffect(() => {
    if (selectedTeamId) { fetchAnalytics(); dispatch({ type: 'RESET_DISMISSED_SUGGESTIONS' }); }
  }, [selectedTeamId, fetchAnalytics, dispatch]);

  useEffect(() => { dispatch({ type: 'RESET_ON_TEAM_SWITCH' }); }, [selectedTeamId, dispatch]);

  // -- Pipeline status listener ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<{ pipeline_id: string; team_id: string; status: string; node_statuses: PipelineNodeStatus[]; memories_created?: number }>(
      EventName.PIPELINE_STATUS, (event) => {
        if (cancelled) return;
        if (event.payload.team_id === selectedTeamId) {
          dispatch({ type: 'SET_PIPELINE_NODE_STATUSES', statuses: event.payload.node_statuses });
          const isRunning = event.payload.status === 'running';
          dispatch({ type: 'SET_PIPELINE_RUNNING', running: isRunning });
          if ((event.payload.memories_created ?? 0) > 0 && isRunning) dispatch({ type: 'SET_MEMORIES_PULSING', pulsing: true });
          if (!isRunning) {
            setTimeout(() => {
              fetchAnalytics();
              if (selectedTeamId) {
                const { memoryFilterCategory: cat, memoryFilterSearch: srch } = usePipelineStore.getState();
                fetchTeamMemories(selectedTeamId, cat, srch);
              }
              dispatch({ type: 'SET_MEMORIES_PULSING', pulsing: false });
            }, 500);
          }
        }
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlistenFn = fn; } });
    return () => { cancelled = true; unlistenFn?.(); };
  }, [selectedTeamId, fetchAnalytics, fetchTeamMemories, dispatch]);

  // -- Pipeline cycle warning listener ---------------------------------
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<{ team_id: string; pipeline_id: string; cycle_member_ids: string[] }>(
      EventName.PIPELINE_CYCLE_WARNING, (event) => {
        if (cancelled) return;
        if (event.payload.team_id === selectedTeamId) {
          dispatch({ type: 'SET_PIPELINE_CYCLE_NODE_IDS', ids: new Set(event.payload.cycle_member_ids) });
        }
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlistenFn = fn; } });
    return () => { cancelled = true; unlistenFn?.(); };
  }, [selectedTeamId, dispatch]);

  // -- Pipeline execution ---------------------------------------------
  const handleExecuteTeam = useCallback(async () => {
    if (!selectedTeamId || cs.pipelineRunning) return;
    try { dispatch({ type: 'SET_PIPELINE_RUNNING', running: true }); await executeTeam(selectedTeamId); }
    catch (err) { logger.error('Failed to execute team', { error: errMsg(err, 'Unknown execution error') }); dispatch({ type: 'SET_PIPELINE_RUNNING', running: false }); }
  }, [selectedTeamId, cs.pipelineRunning, dispatch]);

  // -- Optimizer suggestions ------------------------------------------
  const handleAcceptSuggestion = useCallback(async (suggestion: TopologySuggestion) => {
    if (!selectedTeamId) return;
    if (suggestion.suggested_source && suggestion.suggested_target) {
      await createTeamConnection(suggestion.suggested_source, suggestion.suggested_target, suggestion.suggested_connection_type ?? undefined);
      dispatch({ type: 'DISMISS_SUGGESTION', suggestionId: suggestion.id });
      fetchAnalytics();
    } else { dispatch({ type: 'DISMISS_SUGGESTION', suggestionId: suggestion.id }); }
  }, [selectedTeamId, createTeamConnection, fetchAnalytics, dispatch]);

  const handleDismissSuggestion = useCallback((suggestionId: string) => {
    dispatch({ type: 'DISMISS_SUGGESTION', suggestionId });
  }, [dispatch]);

  // -- Canvas assistant -----------------------------------------------
  const handleAssistantSuggest = useCallback(async (query: string) => {
    try { return await suggestTopologyLlm(query, selectedTeamId ?? undefined); }
    catch (err) { logger.warn('LLM topology failed, falling back to keyword-based', { error: errMsg(err, 'LLM topology suggestion failed') }); return suggestTopology(query, selectedTeamId ?? undefined); }
  }, [selectedTeamId]);

  const handleAssistantApply = useCallback(async (blueprint: TopologyBlueprint) => {
    if (!selectedTeamId) return;
    dispatch({ type: 'SET_ASSISTANT_APPLYING', applying: true });
    try {
      const newMemberIds: string[] = [];
      for (const m of blueprint.members) { const member = await addTeamMember(m.persona_id, m.role, m.position_x, m.position_y); if (member) newMemberIds.push(member.id); }
      for (const c of blueprint.connections) { const sourceId = newMemberIds[c.source_index]; const targetId = newMemberIds[c.target_index]; if (sourceId && targetId) await createTeamConnection(sourceId, targetId, c.connection_type); }
      fetchAnalytics();
    } catch (err) { logger.error('Failed to apply blueprint', { error: errMsg(err, 'Blueprint application failed') }); }
    finally { dispatch({ type: 'SET_ASSISTANT_APPLYING', applying: false }); }
  }, [selectedTeamId, addTeamMember, createTeamConnection, fetchAnalytics, dispatch]);

  // -- Dry-run --------------------------------------------------------
  const handleStartDryRun = useCallback(() => {
    if (cs.pipelineRunning || teamMembers.length === 0) return;
    dispatch({ type: 'SET_DRY_RUN_ACTIVE', active: true });
  }, [cs.pipelineRunning, teamMembers.length, dispatch]);

  const handleDryRunStateChange = useCallback((state: DryRunState) => {
    dispatch({ type: 'SET_DRY_RUN_STATE', state });
  }, [dispatch]);

  const handleCloseDryRun = useCallback(() => {
    dispatch({ type: 'SET_DRY_RUN_ACTIVE', active: false });
    dispatch({ type: 'SET_DRY_RUN_STATE', state: null });
  }, [dispatch]);

  return {
    fetchAnalytics,
    handleExecuteTeam,
    handleAcceptSuggestion, handleDismissSuggestion,
    handleAssistantSuggest, handleAssistantApply,
    handleStartDryRun, handleDryRunStateChange, handleCloseDryRun,
  };
}
