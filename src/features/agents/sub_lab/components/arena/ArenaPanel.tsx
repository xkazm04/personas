import { useEffect, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { LabProgress } from '../shared/LabProgress';
import { ArenaHistory } from './ArenaHistory';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { ALL_MODELS, selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { useHealthCheck, HealthCheckPanel } from '@/features/agents/health';
import { ModelToggleGrid, UseCaseFilterPicker, LabActionButtons } from '../../shared';

export function ArenaPanel() {
  const arenaRuns = useAgentStore((s) => s.arenaRuns);
  const arenaResultsMap = useAgentStore((s) => s.arenaResultsMap);
  const isLabRunning = useAgentStore((s) => s.isArenaRunning);
  const startArena = useAgentStore((s) => s.startArena);
  const cancelArena = useAgentStore((s) => s.cancelArena);
  const fetchArenaRuns = useAgentStore((s) => s.fetchArenaRuns);
  const fetchArenaResults = useAgentStore((s) => s.fetchArenaResults);
  const deleteArenaRun = useAgentStore((s) => s.deleteArenaRun);

  const {
    selectedPersona, selectedModels, setSelectedModels, toggleModel,
    expandedRunId, setExpandedRunId,
    setActiveRunId,
    selectedUseCaseId, setSelectedUseCaseId,
    handleCancel,
  } = usePanelRunState({
    fetchRuns: fetchArenaRuns,
    fetchResults: fetchArenaResults,
    cancelRun: cancelArena,
    defaultModels: new Set(['haiku', 'sonnet']),
  });

  const useCases = useSelectedUseCases();
  const selectedUseCase = useMemo(() => useCases.find((uc) => uc.id === selectedUseCaseId) ?? null, [useCases, selectedUseCaseId]);

  useEffect(() => {
    if (selectedUseCase?.model_override) {
      const override = selectedUseCase.model_override;
      const match = ALL_MODELS.find((m) => m.provider === override.provider && m.model === override.model);
      if (match) setSelectedModels(new Set([match.id]));
    }
  }, [selectedUseCase, setSelectedModels]);

  const handleStart = async () => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models = selectedModelsToConfigs(selectedModels);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startArena(selectedPersona.id, models, useCaseFilter);
    if (runId) setActiveRunId(runId);
  };

  const handleDelete = async (runId: string) => { await deleteArenaRun(runId); if (expandedRunId === runId) setExpandedRunId(null); };

  const healthCheck = useHealthCheck();

  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left: Arena setup */}
      <div className="border border-primary/20 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-3">
          {(!hasPrompt || !hasTools) && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-400/90">
                {!hasPrompt && <p>This persona has no prompt configured. Add a prompt first.</p>}
                {!hasTools && <p>This persona has no tools assigned. Add tools for richer testing.</p>}
              </div>
            </div>
          )}

          <UseCaseFilterPicker selectedUseCaseId={selectedUseCaseId} setSelectedUseCaseId={setSelectedUseCaseId} label="Focus on Use Case" />
          <ModelToggleGrid selectedModels={selectedModels} toggleModel={toggleModel} testIdPrefix="arena" />

          <LabActionButtons
            isRunning={isLabRunning}
            onStart={() => void handleStart()}
            onCancel={() => void handleCancel()}
            disabled={selectedModels.size === 0 || !hasPrompt}
            disabledReason={!hasPrompt ? 'Add a prompt to this persona first' : selectedModels.size === 0 ? 'Select at least one model' : ''}
            runLabel={<>Run Arena ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}{selectedUseCase ? ` -- ${selectedUseCase.title}` : ''})</>}
            cancelLabel="Cancel Test"
            cancelTestId="arena-cancel-btn"
            runTestId="arena-run-btn"
          />

          <LabProgress />
        </div>
      </div>

      {/* Right: Health Check */}
      <div className="border border-primary/20 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40 p-4">
        <HealthCheckPanel healthCheck={healthCheck} />
      </div>
      </div>

      <ArenaHistory runs={arenaRuns} resultsMap={arenaResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void handleDelete(id)} />
    </div>
  );
}
