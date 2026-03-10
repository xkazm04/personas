import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaTests } from '@/hooks/tests/usePersonaTests';
import { TestSuiteManager } from './TestSuiteManager';
import { parseDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import { ALL_MODELS } from './TestRunnerConfig';
import { TestRunnerConfig } from './TestRunnerConfig';
import { TestProgress } from './TestProgress';
import { TestHistory } from './TestHistory';
import type { ModelTestConfig } from '@/api/agents/tests';

export function PersonaTestsTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const isTestRunning = usePersonaStore((s) => s.isTestRunning);
  const testRunProgress = usePersonaStore((s) => s.testRunProgress);
  const fetchTestRuns = usePersonaStore((s) => s.fetchTestRuns);
  const startTest = usePersonaStore((s) => s.startTest);
  const cancelTest = usePersonaStore((s) => s.cancelTest);
  const fetchTestResults = usePersonaStore((s) => s.fetchTestResults);
  const deleteTest = usePersonaStore((s) => s.deleteTest);

  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['haiku', 'sonnet']));
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);
  const [lastGeneratedScenarios, setLastGeneratedScenarios] = useState<unknown[] | null>(null);

  usePersonaTests();

  // Parse use cases for model_override
  const useCases = useMemo(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    return ctx.useCases ?? [];
  }, [selectedPersona?.design_context]);

  const selectedUseCase = useMemo(
    () => useCases.find((uc) => uc.id === selectedUseCaseId) ?? null,
    [useCases, selectedUseCaseId],
  );

  // When a use case with model_override is selected, pre-select that model
  useEffect(() => {
    if (selectedUseCase?.model_override) {
      const override = selectedUseCase.model_override;
      const match = ALL_MODELS.find((m) =>
        m.provider === override.provider && m.model === override.model
      );
      if (match) {
        setSelectedModels(new Set([match.id]));
      }
    }
  }, [selectedUseCase]);

  useEffect(() => {
    if (selectedPersona?.id) {
      fetchTestRuns(selectedPersona.id);
    }
  }, [selectedPersona?.id, fetchTestRuns]);

  // Capture generated scenarios from progress events
  useEffect(() => {
    if (testRunProgress?.phase === 'generated' && testRunProgress.scenarios && testRunProgress.scenarios.length > 0) {
      setLastGeneratedScenarios(testRunProgress.scenarios);
    }
  }, [testRunProgress?.phase, testRunProgress?.scenarios]);

  // Fetch results when expanding a run
  useEffect(() => {
    if (expandedRunId) {
      fetchTestResults(expandedRunId);
    }
  }, [expandedRunId, fetchTestResults]);

  const toggleModel = useCallback((id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleStartTest = async () => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => {
        const opt = ALL_MODELS.find((m) => m.id === id);
        if (!opt) return null;
        return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
      })
      .filter(Boolean) as ModelTestConfig[];

    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startTest(selectedPersona.id, models, useCaseFilter);
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelTest(activeRunId);
      setActiveRunId(null);
    }
  };

  const handleDelete = async (runId: string) => {
    await deleteTest(runId);
    if (expandedRunId === runId) setExpandedRunId(null);
  };

  const toggleExpand = (runId: string) => {
    setExpandedRunId((prev) => (prev === runId ? null : runId));
  };

  const handleRunSuite = async (suiteId: string) => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => {
        const opt = ALL_MODELS.find((m) => m.id === id);
        if (!opt) return null;
        return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
      })
      .filter(Boolean) as ModelTestConfig[];

    const runId = await startTest(selectedPersona.id, models, undefined, suiteId);
    if (runId) setActiveRunId(runId);
  };

  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-6">
      <TestRunnerConfig
        selectedModels={selectedModels}
        onToggleModel={toggleModel}
        onStartTest={handleStartTest}
        onCancelTest={handleCancel}
        isTestRunning={isTestRunning}
        hasPrompt={hasPrompt}
        selectedUseCaseId={selectedUseCaseId}
        onSelectedUseCaseIdChange={setSelectedUseCaseId}
      />

      <TestProgress selectedModels={selectedModels} />

      {/* Saved Test Suites */}
      {selectedPersona && (
        <TestSuiteManager
          personaId={selectedPersona.id}
          onRunSuite={handleRunSuite}
          lastGeneratedScenarios={lastGeneratedScenarios}
          lastRunId={activeRunId}
          disabled={isTestRunning}
        />
      )}

      <TestHistory
        expandedRunId={expandedRunId}
        onToggleExpand={toggleExpand}
        onDelete={handleDelete}
      />
    </div>
  );
}
