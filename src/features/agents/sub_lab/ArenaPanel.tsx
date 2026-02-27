import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Square, ChevronDown, ChevronRight,
  Trash2, Clock, Trophy, AlertCircle, Filter, FlaskConical,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ArenaResultsView } from './ArenaResultsView';
import { LabProgress } from './LabProgress';
import { statusBadge } from './labUtils';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/UseCasesList';
import { Listbox } from '@/features/shared/components/Listbox';
import type { LabArenaRun } from '@/lib/bindings/LabArenaRun';
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

export function ArenaPanel() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const arenaRuns = usePersonaStore((s) => s.arenaRuns);
  const arenaResults = usePersonaStore((s) => s.arenaResults);
  const isLabRunning = usePersonaStore((s) => s.isLabRunning);
  const fetchArenaRuns = usePersonaStore((s) => s.fetchArenaRuns);
  const startArena = usePersonaStore((s) => s.startArena);
  const cancelArena = usePersonaStore((s) => s.cancelArena);
  const fetchArenaResults = usePersonaStore((s) => s.fetchArenaResults);
  const deleteArenaRun = usePersonaStore((s) => s.deleteArenaRun);

  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['haiku', 'sonnet']));
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);

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
      const match = ALL_MODELS.find((m) =>
        m.provider === override.provider && m.model === override.model
      );
      if (match) setSelectedModels(new Set([match.id]));
    }
  }, [selectedUseCase]);

  useEffect(() => {
    if (selectedPersona?.id) fetchArenaRuns(selectedPersona.id);
  }, [selectedPersona?.id, fetchArenaRuns]);

  useEffect(() => {
    if (expandedRunId) fetchArenaResults(expandedRunId);
  }, [expandedRunId, fetchArenaResults]);

  const toggleModel = useCallback((id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleStart = async () => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => {
        const opt = ALL_MODELS.find((m) => m.id === id);
        if (!opt) return null;
        return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
      })
      .filter(Boolean) as ModelTestConfig[];

    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startArena(selectedPersona.id, models, useCaseFilter);
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelArena(activeRunId);
      setActiveRunId(null);
    }
  };

  const handleDelete = async (runId: string) => {
    await deleteArenaRun(runId);
    if (expandedRunId === runId) setExpandedRunId(null);
  };

  const parseSummary = (run: LabArenaRun) => {
    if (!run.summary) return null;
    try {
      return JSON.parse(run.summary) as {
        best_quality_model?: string;
        rankings?: Array<{ model_id: string; composite_score: number }>;
      };
    } catch { return null; }
  };

  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-6">
      <div className="border border-primary/15 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-5 space-y-4">
          {/* Warnings */}
          {(!hasPrompt || !hasTools) && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-400/90">
                {!hasPrompt && <p>This persona has no prompt configured. Add a prompt first.</p>}
                {!hasTools && <p>This persona has no tools assigned. Add tools for richer testing.</p>}
              </div>
            </div>
          )}

          {/* Use case filter */}
          {useCases.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />
                Focus on Use Case
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
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm border transition-all ${
                      isOpen
                        ? 'bg-primary/10 border-primary/30 text-foreground/90'
                        : 'bg-background/30 border-primary/10 text-muted-foreground/90 hover:border-primary/20'
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
                        onClick={() => {
                          setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value);
                          close();
                        }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                          focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                        } ${
                          (selectedUseCaseId ?? '__all__') === opt.value
                            ? 'text-primary font-medium'
                            : 'text-muted-foreground/90 hover:bg-secondary/30'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          )}

          {/* Model selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground/80">Select Models to Compare</label>
            <div className="space-y-2">
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">Anthropic</span>
                <div className="flex flex-wrap gap-2">
                  {ANTHROPIC_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => toggleModel(m.id)}
                      disabled={isLabRunning}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                        selectedModels.has(m.id)
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'
                      } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {OLLAMA_MODELS.length > 0 && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">Ollama Cloud</span>
                  <div className="flex flex-wrap gap-2">
                    {OLLAMA_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => toggleModel(m.id)}
                        disabled={isLabRunning}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                          selectedModels.has(m.id)
                            ? 'bg-primary/15 text-primary border-primary/30'
                            : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'
                        } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Run / Cancel */}
          {isLabRunning ? (
            <button
              onClick={() => void handleCancel()}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20"
            >
              <Square className="w-4 h-4" />
              Cancel Test
            </button>
          ) : (
            <button
              onClick={() => void handleStart()}
              disabled={selectedModels.size === 0 || !hasPrompt}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <Play className="w-4 h-4" />
              Run Arena ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}{selectedUseCase ? ` — ${selectedUseCase.title}` : ''})
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
          Arena History
        </h4>

        {arenaRuns.length === 0 ? (
          <div className="text-center py-12 bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl">
            <div className="w-14 h-14 rounded-2xl bg-primary/8 border border-primary/12 flex items-center justify-center mx-auto mb-4">
              <FlaskConical className="w-7 h-7 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground/80">No arena runs yet</p>
            <p className="text-sm text-muted-foreground/80 mt-1">Select models above and run a test</p>
          </div>
        ) : (
          <div className="space-y-2">
            {arenaRuns.map((run) => {
              const isExpanded = expandedRunId === run.id;
              const summary = parseSummary(run);
              const modelsList: string[] = (() => {
                try { return JSON.parse(run.modelsTested); } catch { return []; }
              })();

              return (
                <div key={run.id} className="border border-primary/10 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-background/30 hover:bg-secondary/20 transition-colors text-left"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground/80 font-medium">
                          {modelsList.join(', ') || 'Arena Run'}
                        </span>
                        <span className={statusBadge(run.status)}>{run.status}</span>
                        {run.scenariosCount > 0 && (
                          <span className="text-sm text-muted-foreground/80">
                            {run.scenariosCount} scenario{run.scenariosCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/80">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(run.createdAt).toLocaleString()}
                        </span>
                        {summary?.best_quality_model && (
                          <span className="flex items-center gap-1 text-primary/70">
                            <Trophy className="w-3 h-3" />
                            Best: {summary.best_quality_model}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(run.id); }}
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/80 hover:text-red-400 transition-colors"
                      title="Delete run"
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
                          <ArenaResultsView results={arenaResults} />
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
