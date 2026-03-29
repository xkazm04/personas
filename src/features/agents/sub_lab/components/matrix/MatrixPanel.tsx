import { useState } from 'react';
import { Wand2, AlertCircle } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { MatrixHistory } from './MatrixHistory';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { ModelToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';

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
    const models = selectedModelsToConfigs(selectedModels);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startMatrix(selectedPersona.id, instruction.trim(), models, useCaseFilter);
    if (runId) { setActiveRunId(runId); setInstruction(''); }
  };

  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-6">
      <LabPanelShell
        isRunning={isLabRunning}
        onStart={() => void handleStart()}
        onCancel={() => void handleCancel()}
        disabled={!instruction.trim() || selectedModels.size === 0 || !hasPrompt}
        disabledReason={!hasPrompt ? 'Add a prompt to this persona first' : !instruction.trim() ? 'Describe your desired changes above' : selectedModels.size === 0 ? 'Select at least one model' : ''}
        runLabel="Generate & Test Draft"
        cancelLabel="Cancel Matrix Test"
        runIcon={<Wand2 className="w-4 h-4" />}
        runClassName="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-500/90 hover:to-purple-500/90 text-foreground shadow-elevation-3 shadow-violet-500/20 hover:shadow-violet-500/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
        cancelTestId="matrix-cancel-btn"
        runTestId="matrix-run-btn"
      >
        {!hasPrompt && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-400/90">This persona has no prompt configured. Add a prompt first.</p>
          </div>
        )}

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
        <UseCaseFilterPicker selectedUseCaseId={selectedUseCaseId} setSelectedUseCaseId={setSelectedUseCaseId} />
      </LabPanelShell>

      <MatrixHistory runs={matrixRuns} resultsMap={matrixResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void deleteMatrixRun(id)} />
    </div>
  );
}
