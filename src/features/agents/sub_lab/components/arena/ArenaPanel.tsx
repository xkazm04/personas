import { useEffect, useMemo } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { ArenaHistory } from './ArenaHistory';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { ALL_MODELS, selectedModelsAndEffortsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { useHealthCheck, HealthCheckPanel } from '@/features/agents/health';
import { ModelToggleGrid, EffortToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useLabTranslation } from '../../i18n/useLabTranslation';
import type { GuideItem } from '../../shared';

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
    selectedEfforts, toggleEffort,
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
    const models = selectedModelsAndEffortsToConfigs(selectedModels, selectedEfforts);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startArena(selectedPersona.id, models, useCaseFilter);
    if (runId) setActiveRunId(runId);
  };

  const handleDelete = async (runId: string) => { await deleteArenaRun(runId); if (expandedRunId === runId) setExpandedRunId(null); };

  const healthCheck = useHealthCheck();
  const { t } = useLabTranslation();
  const setLabMode = useAgentStore((s) => s.setLabMode);

  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  const guideItems = useMemo(() => {
    const items: GuideItem[] = [];
    if (!hasPrompt) items.push({ message: t.guide.noPrompt.message, actionLabel: t.guide.noPrompt.action, onAction: () => setLabMode('versions') });
    if (!hasTools) items.push({ message: t.guide.noTools.message });
    if (selectedModels.size === 0) items.push({ message: t.guide.selectModels.message });
    return items;
  }, [hasPrompt, hasTools, selectedModels.size, t, setLabMode]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left: Arena setup */}
      <LabPanelShell
        isRunning={isLabRunning}
        onStart={() => void handleStart()}
        onCancel={() => void handleCancel()}
        disabled={selectedModels.size === 0 || !hasPrompt}
        disabledReason={!hasPrompt ? t.guide.noPrompt.message : selectedModels.size === 0 ? t.guide.selectModels.message : ''}
        guideItems={guideItems}
        runLabel={<>Run Arena ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}{selectedUseCase ? ` -- ${selectedUseCase.title}` : ''})</>}
        cancelLabel="Cancel Test"
        cancelTestId="arena-cancel-btn"
        runTestId="arena-run-btn"
      >
        <p className="typo-body text-foreground">
          {t.purpose.arena}
        </p>

        <UseCaseFilterPicker selectedUseCaseId={selectedUseCaseId} setSelectedUseCaseId={setSelectedUseCaseId} label="Focus on Use Case" />
        <ModelToggleGrid selectedModels={selectedModels} toggleModel={toggleModel} testIdPrefix="arena" />
        <EffortToggleGrid selectedEfforts={selectedEfforts} toggleEffort={toggleEffort} testIdPrefix="arena" />
      </LabPanelShell>

      {/* Right: Health Check */}
      <div className="border border-primary/20 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40 p-4">
        <HealthCheckPanel healthCheck={healthCheck} />
      </div>
      </div>

      <ArenaHistory runs={arenaRuns} resultsMap={arenaResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void handleDelete(id)} />
    </div>
  );
}
