import { useState, useMemo, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';

export function useUseCasesTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const isExecuting = usePersonaStore((s) => s.isExecuting);

  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(new Set());
  const [expandedConfigIds, setExpandedConfigIds] = useState<Set<string>>(new Set());
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [toolRunnerOpen, setToolRunnerOpen] = useState(false);

  const executionPanelRef = useRef<HTMLDivElement>(null);

  const personaId = selectedPersona?.id ?? '';

  const contextData = useMemo(
    () => parseDesignContext(selectedPersona?.design_context),
    [selectedPersona?.design_context],
  );
  const useCases: UseCaseItem[] = contextData.useCases ?? [];

  const selectedUseCase = useMemo(
    () => useCases.find((uc) => uc.id === selectedUseCaseId) ?? null,
    [useCases, selectedUseCaseId],
  );

  const historyExpandedMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const id of expandedHistoryIds) map.set(id, true);
    return map;
  }, [expandedHistoryIds]);

  const configExpandedMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const id of expandedConfigIds) map.set(id, true);
    return map;
  }, [expandedConfigIds]);

  const handleExecute = useCallback((useCaseId: string, _sampleInput?: Record<string, unknown>) => {
    setSelectedUseCaseId(useCaseId);
    setTimeout(() => {
      executionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }, []);

  const handleToggleHistory = useCallback((useCaseId: string) => {
    setExpandedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(useCaseId)) next.delete(useCaseId);
      else next.add(useCaseId);
      return next;
    });
  }, []);

  const handleToggleConfig = useCallback((useCaseId: string) => {
    setExpandedConfigIds((prev) => {
      const next = new Set(prev);
      if (next.has(useCaseId)) next.delete(useCaseId);
      else next.add(useCaseId);
      return next;
    });
  }, []);

  const handleRerun = useCallback((_inputData: string) => {
    // Re-run opens execution panel; input pre-filled from sample_input
  }, []);

  const handleExecutionFinished = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  return {
    selectedPersona,
    isExecuting,
    personaId,
    contextData,
    useCases,
    selectedUseCaseId,
    setSelectedUseCaseId,
    selectedUseCase,
    historyExpandedMap,
    configExpandedMap,
    historyRefreshKey,
    toolRunnerOpen,
    setToolRunnerOpen,
    executionPanelRef,
    handleExecute,
    handleToggleHistory,
    handleToggleConfig,
    handleRerun,
    handleExecutionFinished,
  };
}
