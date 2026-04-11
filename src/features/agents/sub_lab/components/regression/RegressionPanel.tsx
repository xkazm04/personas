import { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, Star, Play, AlertTriangle } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ModelToggleGrid } from '../../shared';
import { RegressionResultsView } from './RegressionResultsView';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { useTranslation } from '@/i18n/useTranslation';

const DEFAULT_THRESHOLD = 5;

export function RegressionPanel() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const baselinePin = useAgentStore((s) => s.baselinePin);
  const loadBaseline = useAgentStore((s) => s.loadBaseline);
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const fetchVersions = useAgentStore((s) => s.fetchVersions);
  const evalResultsMap = useAgentStore((s) => s.evalResultsMap);
  const fetchEvalRuns = useAgentStore((s) => s.fetchEvalRuns);
  const fetchEvalResults = useAgentStore((s) => s.fetchEvalResults);
  const startEval = useAgentStore((s) => s.startEval);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const setLabMode = useAgentStore((s) => s.setLabMode);

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [regressionRunId, setRegressionRunId] = useState<string | null>(null);

  const personaId = selectedPersona?.id;

  // Load data on mount
  useEffect(() => {
    if (personaId) {
      loadBaseline(personaId);
      fetchVersions(personaId);
      fetchEvalRuns(personaId);
    }
  }, [personaId, loadBaseline, fetchVersions, fetchEvalRuns]);

  // Auto-select the production version as comparison target
  useEffect(() => {
    if (!selectedVersionId && promptVersions.length > 0) {
      const prod = promptVersions.find((v) => v.tag === 'production');
      if (prod && prod.id !== baselinePin?.versionId) {
        setSelectedVersionId(prod.id);
      } else {
        const latest = promptVersions[0];
        if (latest && latest.id !== baselinePin?.versionId) {
          setSelectedVersionId(latest.id);
        }
      }
    }
  }, [promptVersions, baselinePin, selectedVersionId]);

  // Load baseline eval results if we have a pinned run
  useEffect(() => {
    if (baselinePin?.runId) {
      fetchEvalResults(baselinePin.runId);
    }
  }, [baselinePin?.runId, fetchEvalResults]);

  // Load regression run results
  useEffect(() => {
    if (regressionRunId) {
      fetchEvalResults(regressionRunId);
    }
  }, [regressionRunId, fetchEvalResults]);

  const baselineResults: LabEvalResult[] = useMemo(
    () => (baselinePin?.runId ? evalResultsMap[baselinePin.runId] ?? [] : []),
    [baselinePin?.runId, evalResultsMap],
  );

  const currentResults: LabEvalResult[] = useMemo(
    () => (regressionRunId ? evalResultsMap[regressionRunId] ?? [] : []),
    [regressionRunId, evalResultsMap],
  );

  const selectedVersion = useMemo(
    () => promptVersions.find((v) => v.id === selectedVersionId) ?? null,
    [promptVersions, selectedVersionId],
  );

  const toggleModel = useCallback((id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRunRegression = useCallback(async () => {
    if (!personaId || !baselinePin || !selectedVersionId || selectedModels.size === 0) return;
    setRunning(true);
    try {
      const models = selectedModelsToConfigs(selectedModels);
      const versionIds = [baselinePin.versionId, selectedVersionId];
      const runId = await startEval(personaId, versionIds, models);
      if (runId) setRegressionRunId(runId);
    } finally {
      setRunning(false);
    }
  }, [personaId, baselinePin, selectedVersionId, selectedModels, startEval]);

  // No baseline pinned
  if (!baselinePin) {
    return (
      <div className="py-12">
        <EmptyState
          icon={Star}
          title={t.agents.lab.no_baseline_title}
          subtitle={t.agents.lab.no_baseline_subtitle}
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
          action={{
            label: t.agents.lab.go_to_versions,
            onClick: () => setLabMode('versions'),
            icon: Shield,
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="regression-panel">
      {/* Baseline info */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
        <Star className="w-5 h-5 text-amber-400 flex-shrink-0" />
        <div className="flex-1">
          <p className="typo-heading text-amber-400">Baseline: v{baselinePin.versionNumber}</p>
          <p className="typo-caption text-muted-foreground/50">
            Pinned {new Date(baselinePin.pinnedAt).toLocaleDateString()}
            {baselinePin.runId ? ` · Eval run: ${baselinePin.runId.slice(0, 8)}...` : ' · No eval run linked'}
          </p>
        </div>
      </div>

      {/* Version selector */}
      <div className="space-y-2">
        <p className="typo-caption text-muted-foreground/60">{t.agents.lab.compare_against}</p>
        <div className="flex flex-wrap gap-2">
          {promptVersions
            .filter((v) => v.id !== baselinePin.versionId && v.tag !== 'archived')
            .map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedVersionId(v.id)}
                className={`px-3 py-1.5 rounded-lg typo-caption transition-colors border focus-ring ${
                  selectedVersionId === v.id
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary/20 text-muted-foreground/50 border-primary/10 hover:border-primary/20'
                }`}
              >
                v{v.version_number}
                {v.tag === 'production' && <span className="ml-1 text-emerald-400/70">prod</span>}
              </button>
            ))}
        </div>
      </div>

      {/* Model selector */}
      <div className="space-y-2">
        <p className="typo-caption text-muted-foreground/60">{t.agents.lab.models_to_test}</p>
        <ModelToggleGrid selectedModels={selectedModels} toggleModel={toggleModel} />
      </div>

      {/* Threshold */}
      <div className="flex items-center gap-3">
        <p className="typo-caption text-muted-foreground/60">{t.agents.lab.regression_threshold}</p>
        <input
          type="number"
          value={threshold}
          onChange={(e) => setThreshold(Math.max(1, Math.min(50, Number(e.target.value) || DEFAULT_THRESHOLD)))}
          className="w-16 px-2 py-1 rounded-lg bg-background/50 border border-primary/12 text-foreground/80 typo-caption text-center focus-ring"
          min={1}
          max={50}
        />
        <p className="typo-caption text-muted-foreground/40">{t.agents.lab.threshold_hint}</p>
      </div>

      {/* Run button */}
      <button
        onClick={handleRunRegression}
        disabled={running || isLabRunning || !selectedVersionId || selectedModels.size === 0}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors disabled:opacity-40 focus-ring"
      >
        {running ? <LoadingSpinner size="sm" /> : <Play className="w-4 h-4" />}
        {running ? t.agents.lab.running_regression : t.agents.lab.run_regression}
      </button>

      {/* Results */}
      {currentResults.length > 0 && baselineResults.length > 0 && selectedVersion && (
        <RegressionResultsView
          baselineResults={baselineResults}
          currentResults={currentResults.filter((r) => r.versionId === selectedVersionId)}
          baselineVersionNum={baselinePin.versionNumber}
          currentVersionNum={selectedVersion.version_number}
          threshold={threshold}
        />
      )}

      {/* No baseline eval results warning */}
      {baselineResults.length === 0 && baselinePin.runId && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/15 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <p className="typo-caption text-amber-400/80">
            No eval results for baseline run. Run an eval on v{baselinePin.versionNumber} first, then pin it as baseline.
          </p>
        </div>
      )}
    </div>
  );
}
