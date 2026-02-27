import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Square, ChevronDown, ChevronRight,
  Trash2, Clock, Filter, GitBranch, AlertCircle,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { AbResultsView } from './AbResultsView';
import { DiffViewer } from './DiffViewer';
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

export function AbPanel() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const promptVersions = usePersonaStore((s) => s.promptVersions);
  const abRuns = usePersonaStore((s) => s.abRuns);
  const abResults = usePersonaStore((s) => s.abResults);
  const isLabRunning = usePersonaStore((s) => s.isLabRunning);
  const fetchVersions = usePersonaStore((s) => s.fetchVersions);
  const fetchAbRuns = usePersonaStore((s) => s.fetchAbRuns);
  const startAb = usePersonaStore((s) => s.startAb);
  const cancelAb = usePersonaStore((s) => s.cancelAb);
  const fetchAbResults = usePersonaStore((s) => s.fetchAbResults);
  const deleteAbRun = usePersonaStore((s) => s.deleteAbRun);

  const [versionAId, setVersionAId] = useState<string | null>(null);
  const [versionBId, setVersionBId] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['haiku']));
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPersona?.id) {
      fetchVersions(selectedPersona.id);
      fetchAbRuns(selectedPersona.id);
    }
  }, [selectedPersona?.id, fetchVersions, fetchAbRuns]);

  useEffect(() => {
    if (expandedRunId) fetchAbResults(expandedRunId);
  }, [expandedRunId, fetchAbResults]);

  const versionA = useMemo(() => promptVersions.find((v) => v.id === versionAId) ?? null, [promptVersions, versionAId]);
  const versionB = useMemo(() => promptVersions.find((v) => v.id === versionBId) ?? null, [promptVersions, versionBId]);

  const useCases: UseCaseItem[] = useMemo(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    return ctx.useCases ?? [];
  }, [selectedPersona?.design_context]);

  const useCaseOptions = useMemo(() => [
    { value: '__all__', label: 'All Use Cases' },
    ...useCases.map((uc) => ({ value: uc.id, label: uc.title })),
  ], [useCases]);

  const versionOptions = useMemo(() =>
    promptVersions.map((v) => ({ value: v.id, label: `v${v.version_number} — ${v.tag}` })),
  [promptVersions]);

  const handleStart = async () => {
    if (!selectedPersona || !versionAId || !versionBId || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => {
        const opt = ALL_MODELS.find((m) => m.id === id);
        if (!opt) return null;
        return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
      })
      .filter(Boolean) as ModelTestConfig[];

    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startAb(selectedPersona.id, versionAId, versionBId, models, useCaseFilter, testInput.trim() || undefined);
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelAb(activeRunId);
      setActiveRunId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-primary/15 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-5 space-y-4">
          {/* Version pickers */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-blue-400">Version A</label>
              <Listbox
                itemCount={versionOptions.length}
                onSelectFocused={(idx) => {
                  const opt = versionOptions[idx];
                  if (opt) setVersionAId(opt.value);
                }}
                ariaLabel="Select version A"
                renderTrigger={({ isOpen, toggle }) => (
                  <button
                    onClick={toggle}
                    disabled={isLabRunning}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm border transition-all ${
                      isOpen ? 'bg-blue-500/10 border-blue-500/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'
                    } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className="text-foreground/80">{versionOptions.find((o) => o.value === versionAId)?.label ?? 'Select version'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              >
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/15 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {versionOptions.map((opt, i) => (
                      <button
                        key={opt.value}
                        onClick={() => { setVersionAId(opt.value); close(); }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                          focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                        } ${versionAId === opt.value ? 'text-blue-400 font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-violet-400">Version B</label>
              <Listbox
                itemCount={versionOptions.length}
                onSelectFocused={(idx) => {
                  const opt = versionOptions[idx];
                  if (opt) setVersionBId(opt.value);
                }}
                ariaLabel="Select version B"
                renderTrigger={({ isOpen, toggle }) => (
                  <button
                    onClick={toggle}
                    disabled={isLabRunning}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm border transition-all ${
                      isOpen ? 'bg-violet-500/10 border-violet-500/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'
                    } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className="text-foreground/80">{versionOptions.find((o) => o.value === versionBId)?.label ?? 'Select version'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              >
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/15 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {versionOptions.map((opt, i) => (
                      <button
                        key={opt.value}
                        onClick={() => { setVersionBId(opt.value); close(); }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                          focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                        } ${versionBId === opt.value ? 'text-violet-400 font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          </div>

          {/* Inline diff preview */}
          {versionA && versionB && (
            <div className="rounded-lg border border-primary/10 bg-secondary/10 p-3">
              <DiffViewer versionA={versionA} versionB={versionB} />
            </div>
          )}

          {/* Model selector */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2">
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
              className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/15 rounded-lg text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono disabled:opacity-50"
            />
          </div>

          {/* Run / Cancel */}
          {isLabRunning ? (
            <button
              onClick={() => void handleCancel()}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20"
            >
              <Square className="w-4 h-4" />
              Cancel A/B Test
            </button>
          ) : (
            <button
              onClick={() => void handleStart()}
              disabled={!versionAId || !versionBId || selectedModels.size === 0}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <Play className="w-4 h-4" />
              Run A/B Test
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
          A/B History
        </h4>

        {abRuns.length === 0 ? (
          <div className="text-center py-12 bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl">
            <div className="w-14 h-14 rounded-2xl bg-primary/8 border border-primary/12 flex items-center justify-center mx-auto mb-4">
              <GitBranch className="w-7 h-7 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground/80">No A/B test runs yet</p>
            <p className="text-sm text-muted-foreground/80 mt-1">Select two versions and run a comparison</p>
          </div>
        ) : (
          <div className="space-y-2">
            {abRuns.map((run) => {
              const isExpanded = expandedRunId === run.id;
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
                        <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-blue-500/15 text-blue-400">v{run.versionANum}</span>
                        <span className="text-muted-foreground/50 text-xs">vs</span>
                        <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-violet-500/15 text-violet-400">v{run.versionBNum}</span>
                        <span className={statusBadge(run.status)}>{run.status}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/80">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(run.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteAbRun(run.id); }}
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
                          <AbResultsView results={abResults} />
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
