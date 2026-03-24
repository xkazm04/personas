import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ArrowLeftRight, Play, Square, ChevronDown, AlertCircle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import type { ModelTestConfig } from '@/api/agents/tests';
import { silentCatch } from "@/lib/silentCatch";
import { ALL_COMPARE_MODELS, toTestConfig, aggregateResults } from '../../libs/compareHelpers';
import { ModelDropdown } from './ModelDropdown';
import { ComparisonResults } from './CompareResultsTable';

export function ModelABCompare() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const startArena = useAgentStore((s) => s.startArena);
  const cancelArena = useAgentStore((s) => s.cancelArena);
  const arenaResultsMap = useAgentStore((s) => s.arenaResultsMap);
  const fetchArenaResults = useAgentStore((s) => s.fetchArenaResults);
  const labProgress = useAgentStore((s) => s.labProgress);

  const [expanded, setExpanded] = useState(false);
  const [modelA, setModelA] = useState('haiku');
  const [modelB, setModelB] = useState('sonnet');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<import('@/lib/bindings/LabArenaResult').LabArenaResult[] | null>(null);

  // Fetch results when run completes
  useEffect(() => {
    if (activeRunId && !isLabRunning && labProgress === null) {
      fetchArenaResults(activeRunId).then(() => {
        const results = arenaResultsMap[activeRunId];
        if (results) setLastResults(results);
      }).catch(silentCatch("ModelABCompare:fetchArenaResults"));
    }
  }, [activeRunId, isLabRunning, labProgress, fetchArenaResults, arenaResultsMap]);

  // Also sync from store when results arrive
  useEffect(() => {
    if (activeRunId && arenaResultsMap[activeRunId]?.length) {
      setLastResults(arenaResultsMap[activeRunId]!);
    }
  }, [activeRunId, arenaResultsMap]);

  const optA = useMemo(() => ALL_COMPARE_MODELS.find((m) => m.id === modelA), [modelA]);
  const optB = useMemo(() => ALL_COMPARE_MODELS.find((m) => m.id === modelB), [modelB]);

  const handleStart = useCallback(async () => {
    if (!selectedPersona || !optA || !optB || modelA === modelB) return;
    setLastResults(null);
    const models: ModelTestConfig[] = [toTestConfig(optA), toTestConfig(optB)];
    const runId = await startArena(selectedPersona.id, models);
    if (runId) setActiveRunId(runId);
  }, [selectedPersona, optA, optB, modelA, modelB, startArena]);

  const handleCancel = useCallback(async () => {
    if (activeRunId) {
      await cancelArena(activeRunId);
      setActiveRunId(null);
    }
  }, [activeRunId, cancelArena]);

  const metricsA = useMemo(() => lastResults ? aggregateResults(lastResults, modelA) : null, [lastResults, modelA]);
  const metricsB = useMemo(() => lastResults ? aggregateResults(lastResults, modelB) : null, [lastResults, modelB]);

  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;
  const canRun = hasPrompt && modelA !== modelB && !isLabRunning;

  // Progress
  const progress = isLabRunning && labProgress?.mode === 'arena' ? labProgress : null;

  return (
    <div className="space-y-1.5">
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all text-left cursor-pointer ${
          expanded
            ? 'bg-indigo-500/8 border-indigo-500/25'
            : 'bg-secondary/40 border-primary/20 hover:border-primary/30 hover:bg-secondary/50'
        }`}
      >
        <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-400/70 flex-shrink-0" />
        <span className="text-sm font-medium text-foreground/85 flex-1">
          Compare Models
          <span className="text-muted-foreground/50 font-normal ml-1.5">Side-by-side</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="pt-1 space-y-3">
              {/* Selector row */}
              <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
                <ModelDropdown label="Model A" value={modelA} onChange={setModelA} disabled={isLabRunning} accentColor="text-blue-400" />
                <div className="pb-2">
                  <ArrowLeftRight className="w-4 h-4 text-muted-foreground/40" />
                </div>
                <ModelDropdown label="Model B" value={modelB} onChange={setModelB} disabled={isLabRunning} accentColor="text-amber-400" />
              </div>

              {/* Warnings */}
              {!hasPrompt && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-amber-400/90">Add a prompt first to run comparisons.</span>
                </div>
              )}
              {modelA === modelB && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-amber-400/90">Select two different models to compare.</span>
                </div>
              )}

              {/* Run / Cancel */}
              {isLabRunning ? (
                <button
                  onClick={() => void handleCancel()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm
                             bg-red-500/80 hover:bg-red-500 text-foreground transition-all cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => void handleStart()}
                  disabled={!canRun}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm
                             bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-500/90 hover:to-violet-500/90
                             text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run Comparison
                </button>
              )}

              {/* Progress */}
              {progress && (
                <div className="px-3 py-2.5 rounded-xl bg-secondary/40 border border-primary/20 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
                    <LoadingSpinner size="sm" className="text-indigo-400" />
                    <span>
                      {progress.phase === 'generating' ? 'Generating scenarios...' :
                       progress.modelId ? `Testing ${progress.modelId}` :
                       'Running...'}
                      {progress.scenarioName ? ` -- ${progress.scenarioName}` : ''}
                    </span>
                  </div>
                  {progress.total != null && progress.current != null && (
                    <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                        style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Results */}
              {metricsA && metricsB && (
                <ComparisonResults modelA={optA!} modelB={optB!} metricsA={metricsA} metricsB={metricsB} results={lastResults!} />
              )}
            </div>
          </div>
        )}
    </div>
  );
}
