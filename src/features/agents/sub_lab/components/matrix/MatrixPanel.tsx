import { useState, useMemo } from 'react';
import { Wand2 } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { MatrixHistory } from './MatrixHistory';
import { selectedModelsAndEffortsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { ModelToggleGrid, EffortToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useLabTranslation } from '../../i18n/useLabTranslation';
import type { GuideItem } from '../../shared';

export function MatrixPanel() {
  const matrixRuns = useAgentStore((s) => s.matrixRuns);
  const matrixResultsMap = useAgentStore((s) => s.matrixResultsMap);
  const isLabRunning = useAgentStore((s) => s.isMatrixRunning);
  const startMatrix = useAgentStore((s) => s.startMatrix);
  const cancelMatrix = useAgentStore((s) => s.cancelMatrix);
  const fetchMatrixRuns = useAgentStore((s) => s.fetchMatrixRuns);
  const fetchMatrixResults = useAgentStore((s) => s.fetchMatrixResults);
  const deleteMatrixRun = useAgentStore((s) => s.deleteMatrixRun);

  const {
    selectedPersona, selectedModels, toggleModel,
    selectedEfforts, toggleEffort,
    expandedRunId, setExpandedRunId,
    setActiveRunId,
    selectedUseCaseId, setSelectedUseCaseId,
    handleCancel,
  } = usePanelRunState({
    fetchRuns: fetchMatrixRuns,
    fetchResults: fetchMatrixResults,
    cancelRun: cancelMatrix,
    defaultModels: new Set(['haiku', 'sonnet']),
  });

  const [instruction, setInstruction] = useState('');

  const handleStart = async () => {
    if (!selectedPersona || !instruction.trim() || selectedModels.size === 0) return;
    const models = selectedModelsAndEffortsToConfigs(selectedModels, selectedEfforts);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startMatrix(selectedPersona.id, instruction.trim(), models, useCaseFilter);
    if (runId) { setActiveRunId(runId); setInstruction(''); }
  };

  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;
  const { t } = useLabTranslation();
  const setLabMode = useAgentStore((s) => s.setLabMode);

  const guideItems = useMemo(() => {
    const items: GuideItem[] = [];
    if (!hasPrompt) items.push({ message: t.guide.noPrompt.message, actionLabel: t.guide.noPrompt.action, onAction: () => setLabMode('versions') });
    if (!instruction.trim()) items.push({ message: t.guide.describeChanges.message });
    if (selectedModels.size === 0) items.push({ message: t.guide.selectModels.message });
    return items;
  }, [hasPrompt, instruction, selectedModels.size, t, setLabMode]);

  return (
    <div className="space-y-6">
      <LabPanelShell
        isRunning={isLabRunning}
        onStart={() => void handleStart()}
        onCancel={() => void handleCancel()}
        disabled={!instruction.trim() || selectedModels.size === 0 || !hasPrompt}
        disabledReason={!hasPrompt ? t.guide.noPrompt.message : !instruction.trim() ? t.guide.describeChanges.message : selectedModels.size === 0 ? t.guide.selectModels.message : ''}
        guideItems={guideItems}
        runLabel="Generate & Test Draft"
        cancelLabel="Cancel Matrix Test"
        runIcon={<Wand2 className="w-4 h-4" />}
        runClassName="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-500/90 hover:to-purple-500/90 text-foreground shadow-elevation-3 shadow-violet-500/20 hover:shadow-violet-500/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
        cancelTestId="matrix-cancel-btn"
        runTestId="matrix-run-btn"
      >
        <p className="typo-body text-foreground">
          {t.purpose.improve}
        </p>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/80">Describe your desired changes</label>
          <textarea data-testid="matrix-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. Make the greeting more formal and add multi-language support for German and French"

            className="w-full h-28 px-3 py-2 text-sm bg-background/50 border border-primary/20 rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring resize-none disabled:opacity-50" />
          <p className="text-sm text-muted-foreground/50">
            Claude will generate a draft persona based on your instructions, then test both current and draft versions side by side.
          </p>
        </div>

        <ModelToggleGrid selectedModels={selectedModels} toggleModel={toggleModel} />
        <EffortToggleGrid selectedEfforts={selectedEfforts} toggleEffort={toggleEffort} />
        <UseCaseFilterPicker selectedUseCaseId={selectedUseCaseId} setSelectedUseCaseId={setSelectedUseCaseId} />
      </LabPanelShell>

      <MatrixHistory runs={matrixRuns} resultsMap={matrixResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void deleteMatrixRun(id)} />
    </div>
  );
}
