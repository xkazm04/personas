import { useState, useEffect } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { DEFAULT_EFFORT, type EffortLevel } from '@/lib/models/modelCatalog';

interface UsePanelRunStateOptions {
  fetchRuns: (personaId: string) => void;
  fetchResults: (runId: string) => void;
  cancelRun: (runId: string) => Promise<void>;
  defaultModels?: Set<string>;
  defaultEfforts?: Set<EffortLevel>;
}

export function usePanelRunState({
  fetchRuns,
  fetchResults,
  cancelRun,
  defaultModels = new Set(['haiku']),
  defaultEfforts = new Set<EffortLevel>([DEFAULT_EFFORT]),
}: UsePanelRunStateOptions) {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);

  const [selectedModels, setSelectedModels] = useState<Set<string>>(defaultModels);
  // Effort dimension — defaults to a single "medium" pick so existing lab
  // behavior is unchanged unless the user explicitly multi-selects efforts.
  const [selectedEfforts, setSelectedEfforts] = useState<Set<EffortLevel>>(defaultEfforts);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPersona?.id) fetchRuns(selectedPersona.id);
  }, [selectedPersona?.id, fetchRuns]);

  useEffect(() => {
    if (expandedRunId) fetchResults(expandedRunId);
  }, [expandedRunId, fetchResults]);

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelRun(activeRunId);
      setActiveRunId(null);
    }
  };

  const toggleModel = (id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEffort = (id: EffortLevel) => {
    setSelectedEfforts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Refuse to leave the set empty — the lab needs at least one effort
        // level to produce a runnable cell. Keep the last selection sticky.
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return {
    selectedPersona,
    selectedModels,
    setSelectedModels,
    toggleModel,
    selectedEfforts,
    setSelectedEfforts,
    toggleEffort,
    expandedRunId,
    setExpandedRunId,
    activeRunId,
    setActiveRunId,
    selectedUseCaseId,
    setSelectedUseCaseId,
    handleCancel,
  };
}
