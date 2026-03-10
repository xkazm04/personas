import { useState, useMemo } from 'react';
import { Play, Square, ChevronDown, Filter, Check } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { LabProgress } from './LabProgress';
import { EvalHistory } from './EvalHistory';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import { Listbox } from '@/features/shared/components/Listbox';
import { ANTHROPIC_MODELS, selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../libs/usePanelRunState';

export function EvalPanel() {
  const promptVersions = usePersonaStore((s) => s.promptVersions);
  const evalRuns = usePersonaStore((s) => s.evalRuns);
  const evalResultsMap = usePersonaStore((s) => s.evalResultsMap);
  const isLabRunning = usePersonaStore((s) => s.isLabRunning);
  const fetchVersions = usePersonaStore((s) => s.fetchVersions);
  const startEval = usePersonaStore((s) => s.startEval);
  const cancelEval = usePersonaStore((s) => s.cancelEval);
  const fetchEvalRuns = usePersonaStore((s) => s.fetchEvalRuns);
  const fetchEvalResults = usePersonaStore((s) => s.fetchEvalResults);
  const deleteEvalRun = usePersonaStore((s) => s.deleteEvalRun);

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

  const [selectedVersionIds, setSelectedVersionIds] = useState<Set<string>>(new Set());
  const [testInput, setTestInput] = useState('');

  const useCases = useMemo(() => parseDesignContext(selectedPersona?.design_context).useCases ?? [], [selectedPersona?.design_context]);
  const useCaseOptions = useMemo(() => [{ value: '__all__', label: 'All Use Cases' }, ...useCases.map((uc) => ({ value: uc.id, label: uc.title }))], [useCases]);

  const toggleVersion = (id: string) => { setSelectedVersionIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };

  const handleStart = async () => {
    if (!selectedPersona || selectedVersionIds.size < 2 || selectedModels.size === 0) return;
    const models = selectedModelsToConfigs(selectedModels);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startEval(selectedPersona.id, [...selectedVersionIds], models, useCaseFilter, testInput.trim() || undefined);
    if (runId) setActiveRunId(runId);
  };

  return (
    <div className="space-y-6" data-testid="eval-panel">
      <div className="border border-primary/15 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Prompt Versions (select 2+)</label>
            <div className="flex flex-wrap gap-2" data-testid="eval-version-selector">
              {promptVersions.map((v) => {
                const isSelected = selectedVersionIds.has(v.id);
                return (
                  <button key={v.id} onClick={() => toggleVersion(v.id)} disabled={isLabRunning} data-testid={`eval-version-toggle-${v.version_number}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${isSelected ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'} ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    {isSelected && <Check className="w-3 h-3" />}
                    <span className="font-mono">v{v.version_number}</span>
                    <span className="text-sm opacity-60">{v.tag}</span>
                  </button>
                );
              })}
            </div>
            {promptVersions.length < 2 && <p className="text-sm text-amber-400/80 mt-1">At least 2 prompt versions are needed. Create more versions in the Versions tab.</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2" data-testid="eval-model-selector">
              {ANTHROPIC_MODELS.map((m) => (
                <button key={m.id} onClick={() => toggleModel(m.id)} disabled={isLabRunning} data-testid={`eval-model-toggle-${m.id}`}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${selectedModels.has(m.id) ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'} ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
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
                  <button onClick={toggle} disabled={isLabRunning} data-testid="eval-usecase-trigger"
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${isOpen ? 'bg-primary/10 border-primary/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'} ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
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
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm text-muted-foreground/70">Test Input (optional JSON)</label>
            <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder='{"task": "Summarize the latest sales report"}' disabled={isLabRunning} data-testid="eval-test-input"
              className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono disabled:opacity-50" />
          </div>

          {selectedVersionIds.size >= 2 && selectedModels.size > 0 && (
            <div className="text-sm text-muted-foreground/70 bg-secondary/30 rounded-xl px-3 py-2">
              {selectedVersionIds.size} versions x {selectedModels.size} models = {selectedVersionIds.size * selectedModels.size} evaluation cells
            </div>
          )}

          {isLabRunning ? (
            <button onClick={() => void handleCancel()} data-testid="eval-cancel-btn" className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20">
              <Square className="w-4 h-4" />Cancel Eval
            </button>
          ) : (
            <button onClick={() => void handleStart()} disabled={selectedVersionIds.size < 2 || selectedModels.size === 0} data-testid="eval-start-btn"
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
              <Play className="w-4 h-4" />Run Evaluation Matrix
            </button>
          )}

          <LabProgress />
        </div>
      </div>

      <EvalHistory runs={evalRuns} resultsMap={evalResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void deleteEvalRun(id)} />
    </div>
  );
}
