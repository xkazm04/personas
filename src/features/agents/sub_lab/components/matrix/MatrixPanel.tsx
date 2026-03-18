import { useState, useMemo } from 'react';
import { Square, ChevronDown, Filter, Wand2, AlertCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useAgentStore } from "@/stores/agentStore";
import { LabProgress } from '../shared/LabProgress';
import { MatrixHistory } from './MatrixHistory';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { ANTHROPIC_MODELS, selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';

export function MatrixPanel() {
  const matrixRuns = useAgentStore((s) => s.matrixRuns);
  const matrixResultsMap = useAgentStore((s) => s.matrixResultsMap);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
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

  const useCases = useSelectedUseCases();
  const useCaseOptions = useMemo(() => [{ value: '__all__', label: 'All Use Cases' }, ...useCases.map((uc) => ({ value: uc.id, label: uc.title }))], [useCases]);

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
      <div className="border border-primary/20 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-3">
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
              disabled={isLabRunning}
              className="w-full h-28 px-3 py-2 text-sm bg-background/50 border border-primary/20 rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring resize-none disabled:opacity-50" />
            <p className="text-sm text-muted-foreground/50">
              Claude will generate a draft persona based on your instructions, then test both current and draft versions side by side.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2">
              {ANTHROPIC_MODELS.map((m) => (
                <button key={m.id} onClick={() => toggleModel(m.id)} disabled={isLabRunning}
                  title={isLabRunning ? 'Cannot change while test is running' : undefined}
                  className={`px-2.5 py-1 rounded-xl text-sm font-medium border transition-all ${selectedModels.has(m.id) ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'} ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {useCases.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" />Focus</label>
              <Listbox itemCount={useCaseOptions.length} onSelectFocused={(idx) => { const opt = useCaseOptions[idx]; if (opt) setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); }} ariaLabel="Filter by use case"
                renderTrigger={({ isOpen, toggle }) => (
                  <button onClick={toggle} disabled={isLabRunning}
                    title={isLabRunning ? 'Cannot change while test is running' : undefined}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${isOpen ? 'bg-primary/10 border-primary/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'} ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? 'All Use Cases'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}>
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/20 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {useCaseOptions.map((opt, i) => (
                      <button key={opt.value} onClick={() => { setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); close(); }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${focusIndex === i ? 'bg-primary/15 text-foreground' : ''} ${(selectedUseCaseId ?? '__all__') === opt.value ? 'text-primary font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          )}

          {isLabRunning ? (
            <button data-testid="matrix-cancel-btn" onClick={() => void handleCancel()} className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20">
              <Square className="w-4 h-4" />Cancel Matrix Test
            </button>
          ) : (
            <Tooltip
              content={
                !hasPrompt ? 'Add a prompt to this persona first'
                  : !instruction.trim() ? 'Describe your desired changes above'
                  : selectedModels.size === 0 ? 'Select at least one model'
                  : ''
              }
              placement="top"
              delay={200}
            >
              <button data-testid="matrix-run-btn" onClick={() => void handleStart()} disabled={!instruction.trim() || selectedModels.size === 0 || !hasPrompt}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-500/90 hover:to-purple-500/90 text-foreground shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                <Wand2 className="w-4 h-4" />Generate & Test Draft
              </button>
            </Tooltip>
          )}

          <LabProgress />
        </div>
      </div>

      <MatrixHistory runs={matrixRuns} resultsMap={matrixResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void deleteMatrixRun(id)} />
    </div>
  );
}
