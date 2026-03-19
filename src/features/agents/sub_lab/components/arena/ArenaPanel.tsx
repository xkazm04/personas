import { useEffect, useMemo } from 'react';
import { Play, Square, ChevronDown, Filter, AlertCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useAgentStore } from "@/stores/agentStore";
import { LabProgress } from '../shared/LabProgress';
import { ArenaHistory } from './ArenaHistory';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { ANTHROPIC_MODELS, ALL_MODELS, selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';

export function ArenaPanel() {
  const arenaRuns = useAgentStore((s) => s.arenaRuns);
  const arenaResultsMap = useAgentStore((s) => s.arenaResultsMap);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const startArena = useAgentStore((s) => s.startArena);
  const cancelArena = useAgentStore((s) => s.cancelArena);
  const fetchArenaRuns = useAgentStore((s) => s.fetchArenaRuns);
  const fetchArenaResults = useAgentStore((s) => s.fetchArenaResults);
  const deleteArenaRun = useAgentStore((s) => s.deleteArenaRun);

  const {
    selectedPersona, selectedModels, setSelectedModels, toggleModel,
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
  const useCaseOptions = useMemo(() => [{ value: '__all__', label: 'All Use Cases' }, ...useCases.map((uc) => ({ value: uc.id, label: uc.title }))], [useCases]);

  useEffect(() => {
    if (selectedUseCase?.model_override) {
      const override = selectedUseCase.model_override;
      const match = ALL_MODELS.find((m) => m.provider === override.provider && m.model === override.model);
      if (match) setSelectedModels(new Set([match.id]));
    }
  }, [selectedUseCase, setSelectedModels]);

  const handleStart = async () => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models = selectedModelsToConfigs(selectedModels);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startArena(selectedPersona.id, models, useCaseFilter);
    if (runId) setActiveRunId(runId);
  };

  const handleDelete = async (runId: string) => { await deleteArenaRun(runId); if (expandedRunId === runId) setExpandedRunId(null); };

  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-6">
      <div className="border border-primary/20 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-3">
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
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" />Focus on Use Case</label>
              <Listbox itemCount={useCaseOptions.length} onSelectFocused={(idx) => { const opt = useCaseOptions[idx]; if (opt) setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); }} ariaLabel="Filter by use case"
                renderTrigger={({ isOpen, toggle }) => (
                  <button onClick={toggle} className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${isOpen ? 'bg-primary/10 border-primary/30 text-foreground/90' : 'bg-background/30 border-primary/10 text-muted-foreground/90 hover:border-primary/20'} cursor-pointer`}>
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

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2">
              {ANTHROPIC_MODELS.map((m) => (
                <button key={m.id} data-testid={`arena-model-${m.id}`} onClick={() => toggleModel(m.id)}
                  className={`px-2.5 py-1 rounded-xl text-sm font-medium border transition-all cursor-pointer ${selectedModels.has(m.id) ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {isLabRunning ? (
            <button data-testid="arena-cancel-btn" onClick={() => void handleCancel()} className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20">
              <Square className="w-4 h-4" />Cancel Test
            </button>
          ) : (
            <Tooltip
              content={
                !hasPrompt ? 'Add a prompt to this persona first'
                  : selectedModels.size === 0 ? 'Select at least one model'
                  : ''
              }
              placement="top"
              delay={200}
            >
              <button data-testid="arena-run-btn" onClick={() => void handleStart()} disabled={selectedModels.size === 0 || !hasPrompt}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                <Play className="w-4 h-4" />Run Arena ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}{selectedUseCase ? ` -- ${selectedUseCase.title}` : ''})
              </button>
            </Tooltip>
          )}

          <LabProgress />
        </div>
      </div>

      <ArenaHistory runs={arenaRuns} resultsMap={arenaResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void handleDelete(id)} />
    </div>
  );
}
