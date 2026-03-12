import { useState, useEffect, useMemo } from 'react';
import {
  Play, Square, ChevronDown,
  Filter, Check,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { Button } from '@/features/shared/components/buttons';
import { LabProgress } from '../../shared/LabProgress';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { ModelTestConfig } from '@/api/agents/tests';
import { ANTHROPIC_MODELS, ALL_MODELS } from './evalModels';
import { EvalHistory } from './EvalHistory';

export function EvalPanel() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const promptVersions = usePersonaStore((s) => s.promptVersions);
  const evalRuns = usePersonaStore((s) => s.evalRuns);
  const evalResultsMap = usePersonaStore((s) => s.evalResultsMap);
  const isLabRunning = usePersonaStore((s) => s.isLabRunning);
  const fetchVersions = usePersonaStore((s) => s.fetchVersions);
  const fetchEvalRuns = usePersonaStore((s) => s.fetchEvalRuns);
  const startEval = usePersonaStore((s) => s.startEval);
  const cancelEval = usePersonaStore((s) => s.cancelEval);
  const fetchEvalResults = usePersonaStore((s) => s.fetchEvalResults);
  const deleteEvalRun = usePersonaStore((s) => s.deleteEvalRun);

  const [selectedVersionIds, setSelectedVersionIds] = useState<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['haiku']));
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPersona?.id) {
      fetchVersions(selectedPersona.id);
      fetchEvalRuns(selectedPersona.id);
    }
  }, [selectedPersona?.id, fetchVersions, fetchEvalRuns]);

  useEffect(() => {
    if (expandedRunId) fetchEvalResults(expandedRunId);
  }, [expandedRunId, fetchEvalResults]);

  const useCases: UseCaseItem[] = useMemo(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    return ctx.useCases ?? [];
  }, [selectedPersona?.design_context]);

  const useCaseOptions = useMemo(() => [
    { value: '__all__', label: 'All Use Cases' },
    ...useCases.map((uc) => ({ value: uc.id, label: uc.title })),
  ], [useCases]);

  const toggleVersion = (id: string) => {
    setSelectedVersionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleStart = async () => {
    if (!selectedPersona || selectedVersionIds.size < 2 || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => {
        const opt = ALL_MODELS.find((m) => m.id === id);
        if (!opt) return null;
        return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
      })
      .filter(Boolean) as ModelTestConfig[];

    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startEval(selectedPersona.id, [...selectedVersionIds], models, useCaseFilter, testInput.trim() || undefined);
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => {
    if (activeRunId) { await cancelEval(activeRunId); setActiveRunId(null); }
  };

  return (
    <div className="space-y-6" data-testid="eval-panel">
      <div className="border border-primary/20 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-4">
          {/* Version multi-select */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Prompt Versions (select 2+)</label>
            <div className="flex flex-wrap gap-2" data-testid="eval-version-selector">
              {promptVersions.map((v) => {
                const isSelected = selectedVersionIds.has(v.id);
                return (
                  <Button key={v.id} onClick={() => toggleVersion(v.id)} disabled={isLabRunning} data-testid={`eval-version-toggle-${v.version_number}`}
                    variant="ghost"
                    size="sm"
                    icon={isSelected ? <Check className="w-3 h-3" /> : undefined}
                    className={`px-3 py-1.5 rounded-xl border ${isSelected ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'}`}
                  >
                    <span className="font-mono">v{v.version_number}</span>
                    <span className="text-sm opacity-60">{v.tag}</span>
                  </Button>
                );
              })}
            </div>
            {promptVersions.length < 2 && (
              <p className="text-sm text-amber-400/80 mt-1">At least 2 prompt versions are needed. Create more versions in the Versions tab.</p>
            )}
          </div>

          {/* Model selector */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2" data-testid="eval-model-selector">
              {ANTHROPIC_MODELS.map((m) => (
                <Button key={m.id} onClick={() => { setSelectedModels((prev) => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; }); }}
                  disabled={isLabRunning} data-testid={`eval-model-toggle-${m.id}`}
                  variant="ghost"
                  size="sm"
                  className={`px-3 py-1.5 rounded-xl border ${selectedModels.has(m.id) ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'}`}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Use case filter */}
          {useCases.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />Focus
              </label>
              <Listbox
                itemCount={useCaseOptions.length}
                onSelectFocused={(idx) => { const opt = useCaseOptions[idx]; if (opt) setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); }}
                ariaLabel="Filter by use case"
                renderTrigger={({ isOpen, toggle }) => (
                  <Button onClick={toggle} disabled={isLabRunning} data-testid="eval-usecase-trigger"
                    variant="ghost"
                    size="md"
                    block
                    iconRight={<ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl border ${isOpen ? 'bg-primary/10 border-primary/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'}`}
                  >
                    <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? 'All Use Cases'}</span>
                  </Button>
                )}
              >
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/20 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {useCaseOptions.map((opt, i) => (
                      <Button key={opt.value} onClick={() => { setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); close(); }}
                        variant="ghost"
                        size="sm"
                        block
                        className={`w-full text-left px-3 py-1.5 rounded-none ${focusIndex === i ? 'bg-primary/15 text-foreground' : ''} ${(selectedUseCaseId ?? '__all__') === opt.value ? 'text-primary font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          )}

          {/* Test input */}
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground/70">Test Input (optional JSON)</label>
            <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder='{"task": "Summarize the latest sales report"}' disabled={isLabRunning} data-testid="eval-test-input"
              className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/20 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono disabled:opacity-50"
            />
          </div>

          {/* Combination preview */}
          {selectedVersionIds.size >= 2 && selectedModels.size > 0 && (
            <div className="text-sm text-muted-foreground/70 bg-secondary/30 rounded-xl px-3 py-2">
              {selectedVersionIds.size} versions x {selectedModels.size} models = {selectedVersionIds.size * selectedModels.size} evaluation cells
            </div>
          )}

          {/* Run / Cancel */}
          {isLabRunning ? (
            <Button onClick={() => void handleCancel()} data-testid="eval-cancel-btn"
              variant="danger"
              size="lg"
              block
              icon={<Square className="w-4 h-4" />}
              className="shadow-lg shadow-red-500/20"
            >
              Cancel Eval
            </Button>
          ) : (
            <Button onClick={() => void handleStart()} disabled={selectedVersionIds.size < 2 || selectedModels.size === 0} data-testid="eval-start-btn"
              variant="primary"
              size="lg"
              block
              icon={<Play className="w-4 h-4" />}
              className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]"
            >
              Run Evaluation Matrix
            </Button>
          )}

          <LabProgress />
        </div>
      </div>

      <EvalHistory
        evalRuns={evalRuns}
        evalResultsMap={evalResultsMap}
        expandedRunId={expandedRunId}
        onToggleExpand={(id) => setExpandedRunId(expandedRunId === id ? null : id)}
        onDeleteRun={deleteEvalRun}
      />
    </div>
  );
}
