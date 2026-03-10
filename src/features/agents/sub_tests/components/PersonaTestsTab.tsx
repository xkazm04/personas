import { useState, useEffect, useCallback, useMemo } from 'react';
import { FlaskConical, Play, Square, ChevronDown, AlertCircle, Filter } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaTests } from '@/hooks/tests/usePersonaTests';
import { TestSuiteManager } from './TestSuiteManager';
import { TestModelSelector } from './TestModelSelector';
import { TestProgressPanel } from './TestProgressPanel';
import { TestHistoryList } from './TestHistoryList';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { ALL_MODELS } from '@/lib/models/modelCatalog';
import type { ModelTestConfig } from '@/api/agents/tests';

export function PersonaTestsTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const testRuns = usePersonaStore((s) => s.testRuns);
  const isTestRunning = usePersonaStore((s) => s.isTestRunning);
  const testRunProgress = usePersonaStore((s) => s.testRunProgress);
  const activeTestResults = usePersonaStore((s) => s.activeTestResults);
  const activeTestResultsRunId = usePersonaStore((s) => s.activeTestResultsRunId);
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
      const match = ALL_MODELS.find((m) => m.provider === override.provider && m.model === override.model);
      if (match) setSelectedModels(new Set([match.id]));
    }
  }, [selectedUseCase]);

  useEffect(() => { if (selectedPersona?.id) fetchTestRuns(selectedPersona.id); }, [selectedPersona?.id, fetchTestRuns]);
  useEffect(() => {
    if (testRunProgress?.phase === 'generated' && testRunProgress.scenarios && testRunProgress.scenarios.length > 0) {
      setLastGeneratedScenarios(testRunProgress.scenarios);
    }
  }, [testRunProgress?.phase, testRunProgress?.scenarios]);
  useEffect(() => { if (expandedRunId) fetchTestResults(expandedRunId); }, [expandedRunId, fetchTestResults]);

  const toggleModel = useCallback((id: string) => {
    setSelectedModels((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const handleStartTest = async () => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => { const opt = ALL_MODELS.find((m) => m.id === id); if (!opt) return null; return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url }; })
      .filter(Boolean) as ModelTestConfig[];
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startTest(selectedPersona.id, models, useCaseFilter);
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => { if (activeRunId) { await cancelTest(activeRunId); setActiveRunId(null); } };
  const handleDelete = async (runId: string) => { await deleteTest(runId); if (expandedRunId === runId) setExpandedRunId(null); };
  const toggleExpand = (runId: string) => { setExpandedRunId((prev) => (prev === runId ? null : runId)); };

  const handleRunSuite = async (suiteId: string) => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => { const opt = ALL_MODELS.find((m) => m.id === id); if (!opt) return null; return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url }; })
      .filter(Boolean) as ModelTestConfig[];
    const runId = await startTest(selectedPersona.id, models, undefined, suiteId);
    if (runId) setActiveRunId(runId);
  };

  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;
  const orderedSelectedModels = useMemo(() => ALL_MODELS.filter((m) => selectedModels.has(m.id)), [selectedModels]);

  const perModelProgress = useMemo(() => {
    const total = testRunProgress?.total ?? 0;
    const current = testRunProgress?.current ?? 0;
    const modelCount = Math.max(orderedSelectedModels.length, 1);
    const perModelTotal = total > 0 ? Math.max(1, Math.ceil(total / modelCount)) : 1;
    return orderedSelectedModels.map((m, idx) => {
      const start = idx * perModelTotal;
      const completed = Math.max(0, Math.min(perModelTotal, current - start));
      const isActive = testRunProgress?.modelId === m.id;
      return { modelId: m.id, label: m.label, completed, total: perModelTotal, isActive };
    });
  }, [orderedSelectedModels, testRunProgress?.current, testRunProgress?.modelId, testRunProgress?.total]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          <FlaskConical className="w-3.5 h-3.5" />
          Sandbox Test Runner
        </h4>
        <p className="text-sm text-muted-foreground/80 -mt-1 ml-[38px]">
          Test your persona across multiple LLM models with auto-generated scenarios
        </p>
      </div>
      <div className="border border-primary/15 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-4">
          {(!hasPrompt || !hasTools) && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-400/90">
                {!hasPrompt && <p>This persona has no prompt configured. Add a prompt first.</p>}
                {!hasTools && <p>This persona has no tools assigned. Add tools for richer testing.</p>}
              </div>
            </div>
          )}
          {useCases.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />Focus on Use Case
              </label>
              <Listbox itemCount={useCaseOptions.length}
                onSelectFocused={(idx) => { const opt = useCaseOptions[idx]; if (opt) setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); }}
                ariaLabel="Filter by use case"
                renderTrigger={({ isOpen, toggle }) => (
                  <button onClick={toggle} disabled={isTestRunning}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${isOpen ? 'bg-primary/10 border-primary/30 text-foreground/90' : 'bg-background/30 border-primary/10 text-muted-foreground/90 hover:border-primary/20'} ${isTestRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? 'All Use Cases'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}>
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/15 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {useCaseOptions.map((opt, i) => (
                      <button key={opt.value} onClick={() => { setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); close(); }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${focusIndex === i ? 'bg-primary/15 text-foreground' : ''} ${(selectedUseCaseId ?? '__all__') === opt.value ? 'text-primary font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
              {selectedUseCase && <p className="text-sm text-muted-foreground/50 ml-1">Scenarios will target: {selectedUseCase.description}</p>}
            </div>
          )}
          <TestModelSelector selectedModels={selectedModels} toggleModel={toggleModel} disabled={isTestRunning} />
          {isTestRunning ? (
            <button onClick={handleCancel} className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20">
              <Square className="w-4 h-4" />Cancel Test Run
            </button>
          ) : (
            <button onClick={handleStartTest} disabled={selectedModels.size === 0 || !hasPrompt}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
              <Play className="w-4 h-4" />Run Test ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}{selectedUseCase ? ` \u2014 ${selectedUseCase.title}` : ''})
            </button>
          )}
          <TestProgressPanel isRunning={isTestRunning} progress={testRunProgress} perModelProgress={perModelProgress} />
        </div>
      </div>
      {selectedPersona && (
        <TestSuiteManager personaId={selectedPersona.id} onRunSuite={handleRunSuite} lastGeneratedScenarios={lastGeneratedScenarios} lastRunId={activeRunId} disabled={isTestRunning} />
      )}
      <TestHistoryList testRuns={testRuns} expandedRunId={expandedRunId} toggleExpand={toggleExpand} onDelete={handleDelete}
        activeTestResults={activeTestResults} activeTestResultsRunId={activeTestResultsRunId} />
    </div>
  );
}
