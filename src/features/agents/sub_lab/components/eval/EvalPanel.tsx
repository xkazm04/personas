import { useState, useMemo } from 'react';
import { useToggleSet } from '@/hooks/lab/useToggleSet';
import { Check } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { EvalHistory } from './EvalHistory';
import { selectedModelsAndEffortsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { ModelToggleGrid, EffortToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useLabTranslation } from '../../i18n/useLabTranslation';
import type { GuideItem } from '../../shared';

export function EvalPanel() {
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
    selectedEfforts, toggleEffort,
    expandedRunId, setExpandedRunId,
    setActiveRunId,
    selectedUseCaseId, setSelectedUseCaseId,
    handleCancel,
  } = usePanelRunState({
    fetchRuns: (pid) => { fetchVersions(pid); fetchEvalRuns(pid); },
    fetchResults: fetchEvalResults,
    cancelRun: cancelEval,
  });

  const { t } = useLabTranslation();
  const setLabMode = useAgentStore((s) => s.setLabMode);

  const selectedVersionIds = useToggleSet<string>();
  const [testInput, setTestInput] = useState('');

  const toggleVersion = (id: string) => selectedVersionIds.toggle(id);

  const handleStart = async () => {
    if (!selectedPersona || selectedVersionIds.values.size < 2 || selectedModels.size === 0) return;
    const models = selectedModelsAndEffortsToConfigs(selectedModels, selectedEfforts);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startEval(selectedPersona.id, [...selectedVersionIds.values], models, useCaseFilter, testInput.trim() || undefined);
    if (runId) setActiveRunId(runId);
  };

  const evalGuideItems = useMemo(() => {
    const items: GuideItem[] = [];
    if (promptVersions.length < 2) items.push({ message: t.guide.needMoreVersions.message, actionLabel: t.guide.needMoreVersions.action, onAction: () => setLabMode('versions') });
    else if (selectedVersionIds.values.size < 2) items.push({ message: t.guide.selectVersions.message });
    if (selectedModels.size === 0) items.push({ message: t.guide.selectModels.message });
    return items;
  }, [promptVersions.length, selectedVersionIds.values.size, selectedModels.size, t, setLabMode]);

  return (
    <div className="space-y-6" data-testid="eval-panel">
      <LabPanelShell
        isRunning={isLabRunning}
        onStart={() => void handleStart()}
        onCancel={() => void handleCancel()}
        disabled={selectedVersionIds.values.size < 2 || selectedModels.size === 0}
        disabledReason={selectedVersionIds.values.size < 2 ? t.guide.selectVersions.message : selectedModels.size === 0 ? t.guide.selectModels.message : ''}
        guideItems={evalGuideItems}
        runLabel="Run Evaluation Matrix"
        cancelLabel="Cancel Eval"
        cancelTestId="eval-cancel-btn"
        runTestId="eval-start-btn"
      >
        <p className="typo-body text-foreground">
          {t.purpose.eval}
        </p>

        <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground/80">Prompt Versions (select 2+)</label>
          <div className="flex flex-wrap gap-2" data-testid="eval-version-selector">
            {promptVersions.map((v) => {
              const isSelected = selectedVersionIds.values.has(v.id);
              return (
                <button key={v.id} onClick={() => toggleVersion(v.id)} data-testid={`eval-version-toggle-${v.version_number}`}

                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-medium border transition-all focus-ring ${isSelected ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'}`}>
                  {isSelected && <Check className="w-3 h-3" />}
                  <span className="font-mono">v{v.version_number}</span>
                  <span className="text-sm opacity-60">{v.tag}</span>
                </button>
              );
            })}
          </div>
          {promptVersions.length < 2 && (
            <p className="typo-body text-foreground mt-1">
              {t.guide.needMoreVersions.message}{' '}
              <button onClick={() => setLabMode('versions')} className="text-primary font-medium hover:underline underline-offset-2">{t.guide.needMoreVersions.action}</button>
            </p>
          )}
        </div>

        <ModelToggleGrid selectedModels={selectedModels} toggleModel={toggleModel} testIdPrefix="eval" />
        <EffortToggleGrid selectedEfforts={selectedEfforts} toggleEffort={toggleEffort} testIdPrefix="eval" />
        <UseCaseFilterPicker selectedUseCaseId={selectedUseCaseId} setSelectedUseCaseId={setSelectedUseCaseId} testIdPrefix="eval" />

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground/70">Test Input (optional JSON)</label>
          <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder='{"task": "Summarize the latest sales report"}' data-testid="eval-test-input"
            className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/20 rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring resize-none font-mono disabled:opacity-50" />
        </div>

        {selectedVersionIds.values.size >= 2 && selectedModels.size > 0 && (
          <div className="text-sm text-muted-foreground/70 bg-secondary/30 rounded-xl px-3 py-2">
            {selectedVersionIds.values.size} versions x {selectedModels.size} models{selectedEfforts.size > 1 ? ` x ${selectedEfforts.size} efforts` : ''} = {selectedVersionIds.values.size * selectedModels.size * Math.max(selectedEfforts.size, 1)} evaluation cells
          </div>
        )}
      </LabPanelShell>

      <EvalHistory runs={evalRuns} resultsMap={evalResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void deleteEvalRun(id)} />
    </div>
  );
}
