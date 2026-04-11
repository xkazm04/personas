import { useState } from 'react';
import { useToggleSet } from '@/hooks/lab/useToggleSet';
import { Check } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { EvalHistory } from './EvalHistory';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { ModelToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useTranslation } from '@/i18n/useTranslation';

export function EvalPanel() {
  const { t } = useTranslation();
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const evalRuns = useAgentStore((s) => s.evalRuns);
  const evalResultsMap = useAgentStore((s) => s.evalResultsMap);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const fetchVersions = useAgentStore((s) => s.fetchVersions);
  const startEval = useAgentStore((s) => s.startEval);
  const cancelEval = useAgentStore((s) => s.cancelEval);
  const fetchEvalRuns = useAgentStore((s) => s.fetchEvalRuns);
  const fetchEvalResults = useAgentStore((s) => s.fetchEvalResults);
  const deleteEvalRun = useAgentStore((s) => s.deleteEvalRun);

  const {
    selectedPersona, selectedModels, toggleModel,
    expandedRunId, setExpandedRunId,
    setActiveRunId,
    selectedUseCaseId, setSelectedUseCaseId,
    handleCancel,
  } = usePanelRunState({
    fetchRuns: (pid) => { fetchVersions(pid); fetchEvalRuns(pid); },
    fetchResults: fetchEvalResults,
    cancelRun: cancelEval,
  });

  const selectedVersionIds = useToggleSet<string>();
  const [testInput, setTestInput] = useState('');

  const toggleVersion = (id: string) => selectedVersionIds.toggle(id);

  const handleStart = async () => {
    if (!selectedPersona || selectedVersionIds.values.size < 2 || selectedModels.size === 0) return;
    const models = selectedModelsToConfigs(selectedModels);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startEval(selectedPersona.id, [...selectedVersionIds.values], models, useCaseFilter, testInput.trim() || undefined);
    if (runId) setActiveRunId(runId);
  };

  return (
    <div className="space-y-6" data-testid="eval-panel">
      <LabPanelShell
        isRunning={isLabRunning}
        onStart={() => void handleStart()}
        onCancel={() => void handleCancel()}
        disabled={selectedVersionIds.values.size < 2 || selectedModels.size === 0}
        disabledReason={selectedVersionIds.values.size < 2 ? t.agents.lab.select_2_versions : selectedModels.size === 0 ? t.agents.lab.select_model : ''}
        runLabel={t.agents.lab.run_eval_matrix}
        cancelLabel={t.agents.lab.cancel_eval}
        cancelTestId="eval-cancel-btn"
        runTestId="eval-start-btn"
      >
        <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground/80">{t.agents.lab.prompt_versions_label}</label>
          <div className="flex flex-wrap gap-2" data-testid="eval-version-selector">
            {promptVersions.map((v) => {
              const isSelected = selectedVersionIds.values.has(v.id);
              return (
                <button key={v.id} onClick={() => toggleVersion(v.id)} data-testid={`eval-version-toggle-${v.version_number}`}

                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-medium border transition-all ${isSelected ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'}`}>
                  {isSelected && <Check className="w-3 h-3" />}
                  <span className="font-mono">v{v.version_number}</span>
                  <span className="text-sm opacity-60">{v.tag}</span>
                </button>
              );
            })}
          </div>
          {promptVersions.length < 2 && <p className="text-sm text-amber-400/80 mt-1">{t.agents.lab.min_2_versions_warning}</p>}
        </div>

        <ModelToggleGrid selectedModels={selectedModels} toggleModel={toggleModel} testIdPrefix="eval" />
        <UseCaseFilterPicker selectedUseCaseId={selectedUseCaseId} setSelectedUseCaseId={setSelectedUseCaseId} testIdPrefix="eval" />

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground/70">{t.agents.lab.test_input_label}</label>
          <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder='{"task": "Summarize the latest sales report"}' data-testid="eval-test-input"
            className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/20 rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring resize-none font-mono disabled:opacity-50" />
        </div>

        {selectedVersionIds.values.size >= 2 && selectedModels.size > 0 && (
          <div className="text-sm text-muted-foreground/70 bg-secondary/30 rounded-xl px-3 py-2">
            {selectedVersionIds.values.size} versions x {selectedModels.size} models = {selectedVersionIds.values.size * selectedModels.size} evaluation cells
          </div>
        )}
      </LabPanelShell>

      <EvalHistory runs={evalRuns} resultsMap={evalResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void deleteEvalRun(id)} />
    </div>
  );
}
