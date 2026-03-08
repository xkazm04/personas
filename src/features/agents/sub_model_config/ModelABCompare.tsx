import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ArrowLeftRight, Play, Square, Loader2, Trophy, Clock,
  DollarSign, Target, FileText, Shield, ChevronDown, AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import type { ModelTestConfig } from '@/api/tests';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from './OllamaCloudPresets';
import { COPILOT_PRESETS } from './CopilotPresets';

// ---------------------------------------------------------------------------
// Model options
// ---------------------------------------------------------------------------

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
  group: string;
  cost: string;
}

const ALL_COMPARE_MODELS: ModelOption[] = [
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku', group: 'Anthropic', cost: '~$0.25/1K' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet', group: 'Anthropic', cost: '~$3/1K' },
  { id: 'opus', label: 'Opus', provider: 'anthropic', model: 'opus', group: 'Anthropic', cost: '~$15/1K' },
  ...OLLAMA_CLOUD_PRESETS.map((p) => ({
    id: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'ollama',
    model: p.modelId,
    base_url: OLLAMA_CLOUD_BASE_URL,
    group: 'Ollama',
    cost: 'Free',
  })),
  ...COPILOT_PRESETS.map((p) => ({
    id: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'copilot',
    model: p.modelId,
    group: 'Copilot',
    cost: p.value === 'copilot:gpt-5-mini' ? 'Free' : '~$3/1K',
  })),
];

function toTestConfig(opt: ModelOption): ModelTestConfig {
  return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
}

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

interface ModelMetrics {
  modelId: string;
  provider: string;
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  composite: number;
  totalCost: number;
  avgDuration: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  count: number;
}

function aggregateResults(results: LabArenaResult[], modelId: string): ModelMetrics | null {
  const rows = results.filter((r) => r.modelId === modelId);
  if (rows.length === 0) return null;
  const n = rows.length;
  const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / n;
  const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / n;
  const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / n;
  return {
    modelId,
    provider: rows[0]?.provider ?? 'unknown',
    avgToolAccuracy: Math.round(avgTA),
    avgOutputQuality: Math.round(avgOQ),
    avgProtocolCompliance: Math.round(avgPC),
    composite: compositeScore(avgTA, avgOQ, avgPC),
    totalCost: rows.reduce((s, r) => s + r.costUsd, 0),
    avgDuration: Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / n),
    totalInputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    count: n,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModelABCompare() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const isLabRunning = usePersonaStore((s) => s.isLabRunning);
  const startArena = usePersonaStore((s) => s.startArena);
  const cancelArena = usePersonaStore((s) => s.cancelArena);
  const arenaResultsMap = usePersonaStore((s) => s.arenaResultsMap);
  const fetchArenaResults = usePersonaStore((s) => s.fetchArenaResults);
  const labProgress = usePersonaStore((s) => s.labProgress);

  const [expanded, setExpanded] = useState(false);
  const [modelA, setModelA] = useState('haiku');
  const [modelB, setModelB] = useState('sonnet');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<LabArenaResult[] | null>(null);

  // Fetch results when run completes
  useEffect(() => {
    if (activeRunId && !isLabRunning && labProgress === null) {
      fetchArenaResults(activeRunId).then(() => {
        const results = arenaResultsMap[activeRunId];
        if (results) setLastResults(results);
      }).catch(() => {});
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
            : 'bg-secondary/40 border-primary/15 hover:border-primary/25 hover:bg-secondary/50'
        }`}
      >
        <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-400/70 flex-shrink-0" />
        <span className="text-sm font-medium text-foreground/85 flex-1">
          Compare Models
          <span className="text-muted-foreground/50 font-normal ml-1.5">Side-by-side</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-1 space-y-3">
              {/* Selector row */}
              <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
                <ModelDropdown
                  label="Model A"
                  value={modelA}
                  onChange={setModelA}
                  disabled={isLabRunning}
                  accentColor="text-blue-400"
                />
                <div className="pb-2">
                  <ArrowLeftRight className="w-4 h-4 text-muted-foreground/40" />
                </div>
                <ModelDropdown
                  label="Model B"
                  value={modelB}
                  onChange={setModelB}
                  disabled={isLabRunning}
                  accentColor="text-amber-400"
                />
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
                <div className="px-3 py-2.5 rounded-xl bg-secondary/40 border border-primary/15 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    <span>
                      {progress.phase === 'generating' ? 'Generating scenarios...' :
                       progress.modelId ? `Testing ${progress.modelId}` :
                       'Running...'}
                      {progress.scenarioName ? ` — ${progress.scenarioName}` : ''}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model dropdown
// ---------------------------------------------------------------------------

function ModelDropdown({
  label,
  value,
  onChange,
  disabled,
  accentColor,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  accentColor: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const m of ALL_COMPARE_MODELS) {
      const arr = map.get(m.group) ?? [];
      arr.push(m);
      map.set(m.group, arr);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="space-y-1">
      <label className={`text-xs font-medium ${accentColor} uppercase tracking-wider`}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-2.5 py-2 text-sm rounded-xl bg-secondary/40 border border-primary/15
                   text-foreground/80 focus:outline-none focus:border-indigo-500/40
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {groups.map(([group, models]) => (
          <optgroup key={group} label={group}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.cost})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side-by-side results
// ---------------------------------------------------------------------------

function ComparisonResults({
  modelA,
  modelB,
  metricsA,
  metricsB,
  results,
}: {
  modelA: ModelOption;
  modelB: ModelOption;
  metricsA: ModelMetrics;
  metricsB: ModelMetrics;
  results: LabArenaResult[];
}) {
  const winner = metricsA.composite > metricsB.composite ? 'A' : metricsA.composite < metricsB.composite ? 'B' : null;

  // Per-scenario side by side
  const scenarios = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) set.add(r.scenarioName);
    return [...set];
  }, [results]);

  const scenarioMatrix = useMemo(() => {
    const mtx: Record<string, Record<string, LabArenaResult>> = {};
    for (const r of results) {
      if (!mtx[r.scenarioName]) mtx[r.scenarioName] = {};
      mtx[r.scenarioName]![r.modelId] = r;
    }
    return mtx;
  }, [results]);

  return (
    <div className="space-y-3">
      {/* Winner banner */}
      {winner && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/15">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground/90">
            {winner === 'A' ? modelA.label : modelB.label} wins
          </span>
          <span className="text-sm text-muted-foreground/60">
            ({(winner === 'A' ? metricsA : metricsB).composite} vs {(winner === 'A' ? metricsB : metricsA).composite} composite)
          </span>
        </div>
      )}

      {/* Side-by-side metrics cards */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard model={modelA} metrics={metricsA} isWinner={winner === 'A'} accent="blue" />
        <MetricCard model={modelB} metrics={metricsB} isWinner={winner === 'B'} accent="amber" />
      </div>

      {/* Metric comparison bars */}
      <div className="space-y-2 px-1">
        <CompareBar label="Quality" labelIcon={FileText} valueA={metricsA.avgOutputQuality} valueB={metricsB.avgOutputQuality} />
        <CompareBar label="Tool Accuracy" labelIcon={Target} valueA={metricsA.avgToolAccuracy} valueB={metricsB.avgToolAccuracy} />
        <CompareBar label="Protocol" labelIcon={Shield} valueA={metricsA.avgProtocolCompliance} valueB={metricsB.avgProtocolCompliance} />
      </div>

      {/* Per-scenario breakdown */}
      {scenarios.length > 1 && (
        <div className="overflow-x-auto border border-primary/10 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground/80 text-xs">Scenario</th>
                <th className="text-center px-3 py-2 font-medium text-blue-400/80 text-xs">{modelA.label}</th>
                <th className="text-center px-3 py-2 font-medium text-amber-400/80 text-xs">{modelB.label}</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => {
                const rA = scenarioMatrix[scenario]?.[modelA.id];
                const rB = scenarioMatrix[scenario]?.[modelB.id];
                const scoreA = rA ? compositeScore(rA.toolAccuracyScore ?? 0, rA.outputQualityScore ?? 0, rA.protocolCompliance ?? 0) : null;
                const scoreB = rB ? compositeScore(rB.toolAccuracyScore ?? 0, rB.outputQualityScore ?? 0, rB.protocolCompliance ?? 0) : null;
                const rowWinner = scoreA != null && scoreB != null ? (scoreA > scoreB ? 'A' : scoreA < scoreB ? 'B' : null) : null;
                return (
                  <tr key={scenario} className="border-b border-primary/5">
                    <td className="px-3 py-2 text-foreground/80 max-w-[180px] truncate">{scenario}</td>
                    <td className={`px-3 py-2 text-center font-mono ${rowWinner === 'A' ? 'font-bold' : ''}`}>
                      <span className={scoreColor(scoreA)}>{scoreA ?? '-'}</span>
                      {rA && <span className="text-muted-foreground/50 ml-1.5 text-xs">{(rA.durationMs / 1000).toFixed(1)}s</span>}
                    </td>
                    <td className={`px-3 py-2 text-center font-mono ${rowWinner === 'B' ? 'font-bold' : ''}`}>
                      <span className={scoreColor(scoreB)}>{scoreB ?? '-'}</span>
                      {rB && <span className="text-muted-foreground/50 ml-1.5 text-xs">{(rB.durationMs / 1000).toFixed(1)}s</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Output previews side by side */}
      {results.length > 0 && (
        <OutputPreviews modelA={modelA} modelB={modelB} results={results} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  model,
  metrics,
  isWinner,
  accent,
}: {
  model: ModelOption;
  metrics: ModelMetrics;
  isWinner: boolean;
  accent: 'blue' | 'amber';
}) {
  const borderColor = isWinner
    ? accent === 'blue' ? 'border-blue-500/30' : 'border-amber-500/30'
    : 'border-primary/10';
  const bgColor = isWinner
    ? accent === 'blue' ? 'bg-blue-500/5' : 'bg-amber-500/5'
    : 'bg-background/30';

  return (
    <div className={`px-3 py-2.5 rounded-xl border ${borderColor} ${bgColor} space-y-2`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground/90">{model.label}</span>
        {isWinner && <Trophy className="w-3 h-3 text-primary" />}
      </div>

      <div className={`text-2xl font-bold tabular-nums ${scoreColor(metrics.composite)}`}>
        {metrics.composite}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <MetricRow icon={Clock} label="Latency" value={`${(metrics.avgDuration / 1000).toFixed(1)}s`} />
        <MetricRow icon={DollarSign} label="Cost" value={`$${metrics.totalCost.toFixed(4)}`} />
        <MetricRow icon={Target} label="Tokens In" value={metrics.totalInputTokens.toLocaleString()} />
        <MetricRow icon={FileText} label="Tokens Out" value={metrics.totalOutputTokens.toLocaleString()} />
      </div>
    </div>
  );
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1 text-muted-foreground/70">
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{label}:</span>
      <span className="text-foreground/80 font-mono ml-auto">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare bar (horizontal dual bar)
// ---------------------------------------------------------------------------

function CompareBar({
  label,
  labelIcon: Icon,
  valueA,
  valueB,
}: {
  label: string;
  labelIcon: typeof Target;
  valueA: number;
  valueB: number;
}) {
  const max = Math.max(valueA, valueB, 1);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        {/* A bar (right-aligned, blue) */}
        <div className="flex-1 flex justify-end">
          <div className="h-2.5 rounded-full bg-blue-500/30 overflow-hidden" style={{ width: `${(valueA / max) * 100}%` }}>
            <div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }} />
          </div>
        </div>
        <div className="w-16 text-center text-xs font-mono tabular-nums">
          <span className={scoreColor(valueA)}>{valueA}</span>
          <span className="text-muted-foreground/40 mx-0.5">:</span>
          <span className={scoreColor(valueB)}>{valueB}</span>
        </div>
        {/* B bar (left-aligned, amber) */}
        <div className="flex-1">
          <div className="h-2.5 rounded-full bg-amber-500/30 overflow-hidden" style={{ width: `${(valueB / max) * 100}%` }}>
            <div className="h-full bg-amber-500 rounded-full" style={{ width: '100%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Output previews
// ---------------------------------------------------------------------------

function OutputPreviews({
  modelA,
  modelB,
  results,
}: {
  modelA: ModelOption;
  modelB: ModelOption;
  results: LabArenaResult[];
}) {
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

  const scenarios = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) set.add(r.scenarioName);
    return [...set];
  }, [results]);

  if (scenarios.length === 0) return null;

  // If only one scenario, show it directly
  const firstScenario = scenarios.length === 1 ? scenarios[0]! : expandedScenario;

  return (
    <div className="space-y-2">
      <h5 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">Output Previews</h5>
      {scenarios.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {scenarios.map((s) => (
            <button
              key={s}
              onClick={() => setExpandedScenario(expandedScenario === s ? null : s)}
              className={`px-2 py-1 text-xs rounded-lg border transition-colors cursor-pointer ${
                expandedScenario === s
                  ? 'bg-primary/15 border-primary/25 text-primary'
                  : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {firstScenario && (
        <div className="grid grid-cols-2 gap-2">
          <OutputBox
            label={modelA.label}
            text={results.find((r) => r.modelId === modelA.id && r.scenarioName === firstScenario)?.outputPreview ?? ''}
            accent="blue"
          />
          <OutputBox
            label={modelB.label}
            text={results.find((r) => r.modelId === modelB.id && r.scenarioName === firstScenario)?.outputPreview ?? ''}
            accent="amber"
          />
        </div>
      )}
    </div>
  );
}

function OutputBox({ label, text, accent }: { label: string; text: string; accent: 'blue' | 'amber' }) {
  const borderCls = accent === 'blue' ? 'border-blue-500/20' : 'border-amber-500/20';
  const headerCls = accent === 'blue' ? 'text-blue-400/80' : 'text-amber-400/80';
  return (
    <div className={`rounded-xl border ${borderCls} overflow-hidden`}>
      <div className={`px-2.5 py-1.5 text-xs font-medium ${headerCls} bg-secondary/30 border-b ${borderCls}`}>
        {label}
      </div>
      <div className="px-2.5 py-2 text-xs text-foreground/70 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
        {text || <span className="text-muted-foreground/60 italic">No output</span>}
      </div>
    </div>
  );
}
