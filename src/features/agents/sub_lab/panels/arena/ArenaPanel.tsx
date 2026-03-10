import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import { ALL_MODELS, buildModelConfigs } from './arenaModels';
import { ArenaConfigPanel } from './ArenaConfigPanel';
import { ArenaHistory } from './ArenaHistory';

export function ArenaPanel() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const arenaRuns = usePersonaStore((s) => s.arenaRuns);
  const arenaResultsMap = usePersonaStore((s) => s.arenaResultsMap);
  const isLabRunning = usePersonaStore((s) => s.isLabRunning);
  const fetchArenaRuns = usePersonaStore((s) => s.fetchArenaRuns);
  const startArena = usePersonaStore((s) => s.startArena);
  const cancelArena = usePersonaStore((s) => s.cancelArena);
  const fetchArenaResults = usePersonaStore((s) => s.fetchArenaResults);
  const deleteArenaRun = usePersonaStore((s) => s.deleteArenaRun);

  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['haiku', 'sonnet']));
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);

  const useCases: UseCaseItem[] = useMemo(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    return ctx.useCases ?? [];
  }, [selectedPersona?.design_context]);

  const selectedUseCase = useMemo(
    () => useCases.find((uc) => uc.id === selectedUseCaseId) ?? null,
    [useCases, selectedUseCaseId],
  );

  const useCaseOptions = useMemo(() => [
    { value: '__all__', label: 'All Use Cases' },
    ...useCases.map((uc) => ({ value: uc.id, label: uc.title })),
  ], [useCases]);

  useEffect(() => {
    if (selectedUseCase?.model_override) {
      const override = selectedUseCase.model_override;
      const match = ALL_MODELS.find((m) =>
        m.provider === override.provider && m.model === override.model
      );
      if (match) setSelectedModels(new Set([match.id]));
    }
  }, [selectedUseCase]);

  useEffect(() => {
    if (selectedPersona?.id) fetchArenaRuns(selectedPersona.id);
  }, [selectedPersona?.id, fetchArenaRuns]);

  useEffect(() => {
    if (expandedRunId) fetchArenaResults(expandedRunId);
  }, [expandedRunId, fetchArenaResults]);

  const toggleModel = useCallback((id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleStart = async () => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models = buildModelConfigs(selectedModels);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startArena(selectedPersona.id, models, useCaseFilter);
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelArena(activeRunId);
      setActiveRunId(null);
    }
  };

  const handleDelete = async (runId: string) => {
    await deleteArenaRun(runId);
    if (expandedRunId === runId) setExpandedRunId(null);
  };

  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-6">
      <ArenaConfigPanel
        hasPrompt={hasPrompt}
        hasTools={hasTools}
        isLabRunning={isLabRunning}
        selectedModels={selectedModels}
        toggleModel={toggleModel}
        useCases={useCases}
        useCaseOptions={useCaseOptions}
        selectedUseCaseId={selectedUseCaseId}
        setSelectedUseCaseId={setSelectedUseCaseId}
        selectedUseCase={selectedUseCase}
        onStart={() => void handleStart()}
        onCancel={() => void handleCancel()}
      />

      <ArenaHistory
        arenaRuns={arenaRuns}
        expandedRunId={expandedRunId}
        setExpandedRunId={setExpandedRunId}
        arenaResultsMap={arenaResultsMap}
        onDelete={handleDelete}
      />
    </div>
  );
}
