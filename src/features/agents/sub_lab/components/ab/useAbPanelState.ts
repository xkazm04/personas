import { useState, useMemo, useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';

/**
 * Shared state hook for the A/B panel variants.
 *
 * Wraps usePanelRunState and adds the version-pair selection plus the
 * custom test input. Returned shape is consumed by every variant — keep
 * it stable so variants stay interchangeable behind the tab switcher.
 */
export function useAbPanelState() {
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const abRuns = useAgentStore((s) => s.abRuns);
  const abResultsMap = useAgentStore((s) => s.abResultsMap);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const fetchVersions = useAgentStore((s) => s.fetchVersions);
  const fetchAbRuns = useAgentStore((s) => s.fetchAbRuns);
  const startAb = useAgentStore((s) => s.startAb);
  const cancelAb = useAgentStore((s) => s.cancelAb);
  const fetchAbResults = useAgentStore((s) => s.fetchAbResults);
  const deleteAbRun = useAgentStore((s) => s.deleteAbRun);
  const abPreselectedA = useAgentStore((s) => s.abPreselectedA);
  const abPreselectedB = useAgentStore((s) => s.abPreselectedB);
  const setAbPreselect = useAgentStore((s) => s.setAbPreselect);

  const panel = usePanelRunState({
    fetchRuns: (pid) => { fetchVersions(pid); fetchAbRuns(pid); },
    fetchResults: fetchAbResults,
    cancelRun: cancelAb,
  });

  const [versionAId, setVersionAId] = useState<string | null>(abPreselectedA);
  const [versionBId, setVersionBId] = useState<string | null>(abPreselectedB);
  const [testInput, setTestInput] = useState('');

  useEffect(() => {
    if (abPreselectedA || abPreselectedB) {
      if (abPreselectedA) setVersionAId(abPreselectedA);
      if (abPreselectedB) setVersionBId(abPreselectedB);
      setAbPreselect(null, null);
    }
  }, [abPreselectedA, abPreselectedB, setAbPreselect]);

  const versionA = useMemo(() => promptVersions.find((v) => v.id === versionAId) ?? null, [promptVersions, versionAId]);
  const versionB = useMemo(() => promptVersions.find((v) => v.id === versionBId) ?? null, [promptVersions, versionBId]);

  const handleStart = async () => {
    if (!panel.selectedPersona || !versionAId || !versionBId || panel.selectedModels.size === 0) return;
    const models = selectedModelsToConfigs(panel.selectedModels);
    const useCaseFilter = panel.selectedUseCaseId && panel.selectedUseCaseId !== '__all__' ? panel.selectedUseCaseId : undefined;
    const runId = await startAb(panel.selectedPersona.id, versionAId, versionBId, models, useCaseFilter, testInput.trim() || undefined);
    if (runId) panel.setActiveRunId(runId);
  };

  return {
    ...panel,
    promptVersions,
    abRuns,
    abResultsMap,
    isLabRunning,
    deleteAbRun,
    versionAId, setVersionAId,
    versionBId, setVersionBId,
    versionA,
    versionB,
    testInput, setTestInput,
    handleStart,
  };
}
