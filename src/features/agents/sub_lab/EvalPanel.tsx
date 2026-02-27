import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Square, ChevronDown, ChevronRight,
  Trash2, Clock, Filter, Grid3X3, AlertCircle, Check,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { EvalResultsGrid } from './EvalResultsGrid';
import { LabProgress } from './LabProgress';
import { statusBadge } from './labUtils';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/UseCasesList';
import { Listbox } from '@/features/shared/components/Listbox';
import type { ModelTestConfig } from '@/api/tests';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
}

const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet' },
  { id: 'opus', label: 'Opus', provider: 'anthropic', model: 'opus' },
];

const OLLAMA_MODELS: ModelOption[] = OLLAMA_CLOUD_PRESETS.map((p) => ({
  id: p.value,
  label: p.label,
  provider: 'ollama',
  model: p.modelId,
  base_url: OLLAMA_CLOUD_BASE_URL,
}));

const ALL_MODELS: ModelOption[] = [...ANTHROPIC_MODELS, ...OLLAMA_MODELS];

export function EvalPanel() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const promptVersions = usePersonaStore((s) => s.promptVersions);
  const evalRuns = usePersonaStore((s) => s.evalRuns);
  const evalResults = usePersonaStore((s) => s.evalResults);
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
    const runId = await startEval(
      selectedPersona.id,
      [...selectedVersionIds],
      models,
      useCaseFilter,
      testInput.trim() || undefined,
    );
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelEval(activeRunId);
      setActiveRunId(null);
    }
  };

  // Parse version numbers from run JSON for display
  const parseVersionNums = (run: { versionNumbers: string }) => {
    try {
      const nums = JSON.parse(run.versionNumbers) as number[];
      return nums.map((n) => `v${n}`).join(', ');
    } catch {
      return run.versionNumbers;
    }
  };

  return (
    <div className="space-y-6" data-testid="eval-panel">
      <div className="border border-primary/15 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-5 space-y-4">
          {/* Version multi-select */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">
              Prompt Versions (select 2+)
            </label>
            <div className="flex flex-wrap gap-2" data-testid="eval-version-selector">
              {promptVersions.map((v) => {
                const isSelected = selectedVersionIds.has(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => toggleVersion(v.id)}
                    disabled={isLabRunning}
                    data-testid={`eval-version-toggle-${v.version_number}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                      isSelected
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'
                    } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {isSelected && <Check className="w-3 h-3" />}
                    <span className="font-mono">v{v.version_number}</span>
                    <span className="text-xs opacity-60">{v.tag}</span>
                  </button>
                );
              })}
            </div>
            {promptVersions.length < 2 && (
              <p className="text-xs text-amber-400/80 mt-1">
                At least 2 prompt versions are needed. Create more versions in the Versions tab.
              </p>
            )}
          </div>

          {/* Model selector */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2" data-testid="eval-model-selector">
              {ANTHROPIC_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelectedModels((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.id)) next.delete(m.id);
                      else next.add(m.id);
                      return next;
                    });
                  }}
                  disabled={isLabRunning}
                  data-testid={`eval-model-toggle-${m.id}`}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    selectedModels.has(m.id)
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'
                  } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Use case filter */}
          {useCases.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />
                Focus
              </label>
              <Listbox
                itemCount={useCaseOptions.length}
                onSelectFocused={(idx) => {
                  const opt = useCaseOptions[idx];
                  if (opt) setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value);
                }}
                ariaLabel="Filter by use case"
                renderTrigger={({ isOpen, toggle }) => (
                  <button
                    onClick={toggle}
                    disabled={isLabRunning}
                    data-testid="eval-usecase-trigger"
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm border transition-all ${
                      isOpen ? 'bg-primary/10 border-primary/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'
                    } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? 'All Use Cases'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              >
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/15 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {useCaseOptions.map((opt, i) => (
                      <button
                        key={opt.value}
                        onClick={() => { setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); close(); }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                          focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                        } ${(selectedUseCaseId ?? '__all__') === opt.value ? 'text-primary font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          )}

          {/* Test input */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground/70">Test Input (optional JSON)</label>
            <textarea
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder='{"task": "Summarize the latest sales report"}'
              disabled={isLabRunning}
              data-testid="eval-test-input"
              className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/15 rounded-lg text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono disabled:opacity-50"
            />
          </div>

          {/* Combination preview */}
          {selectedVersionIds.size >= 2 && selectedModels.size > 0 && (
            <div className="text-xs text-muted-foreground/70 bg-secondary/30 rounded-lg px-3 py-2">
              {selectedVersionIds.size} versions × {selectedModels.size} models = {selectedVersionIds.size * selectedModels.size} evaluation cells
            </div>
          )}

          {/* Run / Cancel */}
          {isLabRunning ? (
            <button
              onClick={() => void handleCancel()}
              data-testid="eval-cancel-btn"
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20"
            >
              <Square className="w-4 h-4" />
              Cancel Eval
            </button>
          ) : (
            <button
              onClick={() => void handleStart()}
              disabled={selectedVersionIds.size < 2 || selectedModels.size === 0}
              data-testid="eval-start-btn"
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <Play className="w-4 h-4" />
              Run Evaluation Matrix
            </button>
          )}

          <LabProgress />
        </div>
      </div>

      {/* History */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          <Clock className="w-3.5 h-3.5" />
          Eval History
        </h4>

        {evalRuns.length === 0 ? (
          <div className="text-center py-12 bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl" data-testid="eval-history-empty">
            <div className="w-14 h-14 rounded-2xl bg-primary/8 border border-primary/12 flex items-center justify-center mx-auto mb-4">
              <Grid3X3 className="w-7 h-7 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground/80">No evaluation runs yet</p>
            <p className="text-sm text-muted-foreground/80 mt-1">Select versions and models, then run</p>
          </div>
        ) : (
          <div className="space-y-2">
            {evalRuns.map((run) => {
              const isExpanded = expandedRunId === run.id;
              return (
                <div key={run.id} className="border border-primary/10 rounded-xl overflow-hidden" data-testid={`eval-run-${run.id}`}>
                  <button
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-background/30 hover:bg-secondary/20 transition-colors text-left"
                    data-testid={`eval-run-toggle-${run.id}`}
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-foreground/80">{parseVersionNums(run)}</span>
                        <span className={statusBadge(run.status)}>{run.status}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/80">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(run.createdAt).toLocaleString()}
                        </span>
                        {run.scenariosCount > 0 && (
                          <span className="text-xs">{run.scenariosCount} scenarios</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteEvalRun(run.id); }}
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/80 hover:text-red-400 transition-colors"
                      title="Delete run"
                      data-testid={`eval-run-delete-${run.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="border-t border-primary/10 bg-secondary/10"
                      >
                        <div className="p-4">
                          {run.error && (
                            <div className="flex items-start gap-2 px-3 py-2.5 mb-4 rounded-xl bg-red-500/10 border border-red-500/20">
                              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                              <span className="text-sm text-red-400">{run.error}</span>
                            </div>
                          )}
                          <EvalResultsGrid results={evalResults} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
