import { useEffect, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { ArenaHistory } from './ArenaHistory';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { ALL_MODELS, selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { useHealthCheck, HealthCheckPanel } from '@/features/agents/health';
import { ModelToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useTranslation } from '@/i18n/useTranslation';

export function ArenaPanel() {
  const { t } = useTranslation();
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
      <LabPanelShell
        isRunning={isLabRunning}
        onStart={() => void handleStart()}
        onCancel={() => void handleCancel()}
        disabled={selectedModels.size === 0 || !hasPrompt}
        disabledReason={!hasPrompt ? t.agents.lab.add_prompt_first : selectedModels.size === 0 ? t.agents.lab.select_model : ''}
        runLabel={<>Run Arena ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}{selectedUseCase ? ` -- ${selectedUseCase.title}` : ''})</>}
        cancelLabel={t.agents.lab.cancel_test}
        cancelTestId="arena-cancel-btn"
        runTestId="arena-run-btn"
      >
        {(!hasPrompt || !hasTools) && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-modal bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="typo-body text-amber-400/90">
              {!hasPrompt && <p>{t.agents.lab.no_prompt_warning}</p>}
              {!hasTools && <p>{t.agents.lab.no_tools_warning}</p>}
            </div>
          </div>
        )}

        <UseCaseFilterPicker selectedUseCaseId={selectedUseCaseId} setSelectedUseCaseId={setSelectedUseCaseId} label={t.agents.lab.focus_use_case} />
        <ModelToggleGrid selectedModels={selectedModels} toggleModel={toggleModel} testIdPrefix="arena" />
      </LabPanelShell>

      {/* Right: Health Check */}
      <div className="border border-primary/20 rounded-modal overflow-hidden backdrop-blur-sm bg-secondary/40 p-4">
        <HealthCheckPanel healthCheck={healthCheck} />
      </div>
      </div>

      <ArenaHistory runs={arenaRuns} resultsMap={arenaResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void handleDelete(id)} />
    </div>
  );
}
