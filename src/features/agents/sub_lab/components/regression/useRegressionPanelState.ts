import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { silentCatch } from '@/lib/silentCatch';
import { usePanelRunState } from '../../libs/usePanelRunState';

export const REG_DEFAULT_THRESHOLD = 5;

/**
 * Shared state hook for the Regression panel and its variants.
 *
 * Wraps `usePanelRunState` (the canonical lab run-state primitive) so model
 * selection, effort selection, and use-case filtering propagate consistently
 * with AB / Arena / Eval / Matrix. Adds Regression-specific state:
 *   - baselinePin / threshold / selectedVersion (delta computation)
 *   - regressionRunId (run-id capture; not aliased to activeRunId because a
 *     regression run intentionally overrides the panel's activeRunId scope)
 *   - running (in-flight UI guard, distinct from `activeRunId` which is set
 *     only AFTER startEval resolves)
 */
export function useRegressionPanelState() {
  const baselinePin = useAgentStore((s) => s.baselinePin);
  const loadBaseline = useAgentStore((s) => s.loadBaseline);
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const fetchVersions = useAgentStore((s) => s.fetchVersions);
  const evalResultsMap = useAgentStore((s) => s.evalResultsMap);
  const fetchEvalRuns = useAgentStore((s) => s.fetchEvalRuns);
  const fetchEvalResults = useAgentStore((s) => s.fetchEvalResults);
  const cancelEval = useAgentStore((s) => s.cancelEval);
  const startEval = useAgentStore((s) => s.startEval);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const setLabMode = useAgentStore((s) => s.setLabMode);

  const panel = usePanelRunState({
    fetchRuns: (pid) => { fetchVersions(pid); fetchEvalRuns(pid); },
    fetchResults: fetchEvalResults,
    cancelRun: cancelEval,
  });

  const personaId = panel.selectedPersona?.id;

  const [threshold, setThreshold] = useState(REG_DEFAULT_THRESHOLD);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [regressionRunId, setRegressionRunId] = useState<string | null>(null);

  useEffect(() => {
    if (personaId) loadBaseline(personaId);
  }, [personaId, loadBaseline]);

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

  useEffect(() => {
    if (baselinePin?.runId) {
      void Promise.resolve(fetchEvalResults(baselinePin.runId)).catch(
        silentCatch('lab:regression-baseline-results'),
      );
    }
  }, [baselinePin?.runId, fetchEvalResults]);

  useEffect(() => {
    if (regressionRunId) {
      void Promise.resolve(fetchEvalResults(regressionRunId)).catch(
        silentCatch('lab:regression-current-results'),
      );
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

  const handleRunRegression = useCallback(async () => {
    if (!personaId || !baselinePin || !selectedVersionId || panel.selectedModels.size === 0) return;
    setRunning(true);
    try {
      const models = selectedModelsToConfigs(panel.selectedModels);
      const versionIds = [baselinePin.versionId, selectedVersionId];
      const runId = await startEval(personaId, versionIds, models);
      if (runId) {
        setRegressionRunId(runId);
        panel.setActiveRunId(runId);
      }
    } finally {
      setRunning(false);
    }
  }, [personaId, baselinePin, selectedVersionId, panel, startEval]);

  return {
    ...panel,
    personaId,
    baselinePin,
    promptVersions,
    selectedVersionId, setSelectedVersionId,
    selectedVersion,
    threshold, setThreshold,
    running,
    isLabRunning,
    regressionRunId,
    baselineResults,
    currentResults,
    setLabMode,
    handleRunRegression,
  };
}
