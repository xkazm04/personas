import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';

export const REG_DEFAULT_THRESHOLD = 5;

export function useRegressionPanelState() {
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

  const [threshold, setThreshold] = useState(REG_DEFAULT_THRESHOLD);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [regressionRunId, setRegressionRunId] = useState<string | null>(null);

  const personaId = selectedPersona?.id;

  useEffect(() => {
    if (personaId) {
      loadBaseline(personaId);
      fetchVersions(personaId);
      fetchEvalRuns(personaId);
    }
  }, [personaId, loadBaseline, fetchVersions, fetchEvalRuns]);

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
    if (baselinePin?.runId) fetchEvalResults(baselinePin.runId);
  }, [baselinePin?.runId, fetchEvalResults]);

  useEffect(() => {
    if (regressionRunId) fetchEvalResults(regressionRunId);
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

  return {
    personaId,
    baselinePin,
    promptVersions,
    selectedVersionId, setSelectedVersionId,
    selectedVersion,
    selectedModels, toggleModel,
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
