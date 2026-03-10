import { useState, useEffect } from 'react';
import { usePersonaStore } from '@/stores/personaStore';

interface UsePanelRunStateOptions {
  fetchRuns: (personaId: string) => void;
  fetchResults: (runId: string) => void;
  cancelRun: (runId: string) => Promise<void>;
  defaultModels?: Set<string>;
}

export function usePanelRunState({
  fetchRuns,
  fetchResults,
  cancelRun,
  defaultModels = new Set(['haiku']),
}: UsePanelRunStateOptions) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);

  const [selectedModels, setSelectedModels] = useState<Set<string>>(defaultModels);
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

  return {
    selectedPersona,
    selectedModels,
    setSelectedModels,
    toggleModel,
    expandedRunId,
    setExpandedRunId,
    activeRunId,
    setActiveRunId,
    selectedUseCaseId,
    setSelectedUseCaseId,
    handleCancel,
  };
}
