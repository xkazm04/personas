import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FlaskConical, Play, Square, ChevronDown, ChevronRight,
  Trash2, Clock, Trophy, Loader2, AlertCircle,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaTests } from '@/hooks/tests/usePersonaTests';
import { TestComparisonTable } from './TestComparisonTable';
import type { PersonaTestRun } from '@/lib/bindings/PersonaTestRun';
import type { ModelTestConfig } from '@/api/tests';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';

// ── Available models for testing ──────────────────────────────────────

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

// ── Status helpers ────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    generating: { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
    running: { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
    completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    failed: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/20' },
    cancelled: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
  };
  const fallback = { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/20' };
  const c = map[status] ?? fallback;
  return `px-2 py-0.5 rounded-md text-[11px] font-medium border ${c.bg} ${c.text} ${c.border}`;
}

// ── Main component ────────────────────────────────────────────────────

export function PersonaTestsTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const testRuns = usePersonaStore((s) => s.testRuns);
  const isTestRunning = usePersonaStore((s) => s.isTestRunning);
  const testRunProgress = usePersonaStore((s) => s.testRunProgress);
  const activeTestResults = usePersonaStore((s) => s.activeTestResults);
  const fetchTestRuns = usePersonaStore((s) => s.fetchTestRuns);
  const startTest = usePersonaStore((s) => s.startTest);
  const cancelTest = usePersonaStore((s) => s.cancelTest);
  const fetchTestResults = usePersonaStore((s) => s.fetchTestResults);
  const deleteTest = usePersonaStore((s) => s.deleteTest);

  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['haiku', 'sonnet']));
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  usePersonaTests();

  useEffect(() => {
    if (selectedPersona?.id) {
      fetchTestRuns(selectedPersona.id);
    }
  }, [selectedPersona?.id, fetchTestRuns]);

  // Fetch results when expanding a run
  useEffect(() => {
    if (expandedRunId) {
      fetchTestResults(expandedRunId);
    }
  }, [expandedRunId, fetchTestResults]);

  const toggleModel = useCallback((id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleStartTest = async () => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => {
        const opt = ALL_MODELS.find((m) => m.id === id);
        if (!opt) return null;
        return {
          id: opt.id,
          provider: opt.provider,
          model: opt.model,
          base_url: opt.base_url,
        };
      })
      .filter(Boolean) as ModelTestConfig[];

    const runId = await startTest(selectedPersona.id, models);
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelTest(activeRunId);
      setActiveRunId(null);
    }
  };

  const handleDelete = async (runId: string) => {
    await deleteTest(runId);
    if (expandedRunId === runId) setExpandedRunId(null);
  };

  const toggleExpand = (runId: string) => {
    setExpandedRunId((prev) => (prev === runId ? null : runId));
  };

  // Parse summary for best model
  const parseSummary = (run: PersonaTestRun) => {
    if (!run.summary) return null;
    try {
      return JSON.parse(run.summary) as {
        best_quality_model?: string;
        best_value_model?: string;
        rankings?: Array<{ model_id: string; composite_score: number; total_cost_usd: number }>;
      };
    } catch {
      return null;
    }
  };

  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-6">
      {/* Test Runner */}
      <div className="border border-primary/15 rounded-2xl overflow-hidden backdrop-blur-sm">
        <div className="px-5 py-4 bg-secondary/30 border-b border-primary/10">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Sandbox Test Runner</h3>
          </div>
          <p className="text-xs text-muted-foreground/50 mt-1">
            Test your persona across multiple LLM models with auto-generated scenarios
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* Warnings */}
          {(!hasPrompt || !hasTools) && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-400/90">
                {!hasPrompt && <p>This persona has no prompt configured. Add a prompt first.</p>}
                {!hasTools && <p>This persona has no tools assigned. Add tools for richer testing.</p>}
              </div>
            </div>
          )}

          {/* Model selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground/60">Select Models to Compare</label>
            <div className="space-y-2">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Anthropic</span>
                <div className="flex flex-wrap gap-2">
                  {ANTHROPIC_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => toggleModel(m.id)}
                      disabled={isTestRunning}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        selectedModels.has(m.id)
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-background/30 text-muted-foreground/50 border-primary/10 hover:border-primary/20 hover:text-foreground/70'
                      } ${isTestRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {OLLAMA_MODELS.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Ollama Cloud</span>
                  <div className="flex flex-wrap gap-2">
                    {OLLAMA_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => toggleModel(m.id)}
                        disabled={isTestRunning}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          selectedModels.has(m.id)
                            ? 'bg-primary/15 text-primary border-primary/30'
                            : 'bg-background/30 text-muted-foreground/50 border-primary/10 hover:border-primary/20 hover:text-foreground/70'
                        } ${isTestRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Run / Cancel button */}
          {isTestRunning ? (
            <button
              onClick={handleCancel}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20"
            >
              <Square className="w-4 h-4" />
              Cancel Test Run
            </button>
          ) : (
            <button
              onClick={handleStartTest}
              disabled={selectedModels.size === 0 || !hasPrompt}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <Play className="w-4 h-4" />
              Run Test ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''})
            </button>
          )}

          {/* Progress */}
          <AnimatePresence>
            {isTestRunning && testRunProgress && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      <span className="text-sm text-foreground/80 capitalize">
                        {testRunProgress.phase === 'generating'
                          ? 'Generating test scenarios...'
                          : testRunProgress.phase === 'executing'
                            ? `Testing ${testRunProgress.modelId ?? ''} — ${testRunProgress.scenarioName ?? ''}`
                            : testRunProgress.phase}
                      </span>
                    </div>
                    {testRunProgress.total && (
                      <span className="text-xs text-muted-foreground/50">
                        {testRunProgress.current ?? 0} / {testRunProgress.total}
                      </span>
                    )}
                  </div>

                  {testRunProgress.total && (
                    <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-primary/60"
                        animate={{ width: `${((testRunProgress.current ?? 0) / testRunProgress.total) * 100}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </div>
                  )}

                  {testRunProgress.scores && (
                    <div className="flex items-center gap-4 text-xs text-muted-foreground/50">
                      <span>Tool: {testRunProgress.scores.tool_accuracy ?? '—'}</span>
                      <span>Output: {testRunProgress.scores.output_quality ?? '—'}</span>
                      <span>Protocol: {testRunProgress.scores.protocol_compliance ?? '—'}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Results History */}
      <div className="space-y-3">
        <h3 className="text-xs font-mono text-muted-foreground/50 uppercase tracking-wider px-1">
          Test History
        </h3>

        {testRuns.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-2xl bg-secondary/60 border border-primary/15 flex items-center justify-center mx-auto mb-4">
              <FlaskConical className="w-7 h-7 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground/40">No test runs yet</p>
            <p className="text-xs text-muted-foreground/30 mt-1">Select models above and run a test</p>
          </div>
        ) : (
          <div className="space-y-2">
            {testRuns.map((run) => {
              const isExpanded = expandedRunId === run.id;
              const summary = parseSummary(run);
              const modelsList: string[] = (() => {
                try { return JSON.parse(run.models_tested); } catch { return []; }
              })();

              return (
                <div key={run.id} className="border border-primary/10 rounded-xl overflow-hidden">
                  {/* Run header */}
                  <button
                    onClick={() => toggleExpand(run.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-background/30 hover:bg-secondary/20 transition-colors text-left"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground/80 font-medium">
                          {modelsList.join(', ') || 'Test Run'}
                        </span>
                        <span className={statusBadge(run.status)}>{run.status}</span>
                        {run.scenarios_count > 0 && (
                          <span className="text-[10px] text-muted-foreground/40">
                            {run.scenarios_count} scenario{run.scenarios_count !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground/40">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(run.created_at).toLocaleString()}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(run.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/30 hover:text-red-400 transition-colors"
                      title="Delete test run"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </button>

                  {/* Expanded results */}
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
                              <span className="text-xs text-red-400">{run.error}</span>
                            </div>
                          )}
                          <TestComparisonTable results={activeTestResults} />
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
