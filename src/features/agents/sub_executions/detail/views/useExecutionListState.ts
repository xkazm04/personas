import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import * as api from '@/api/tauriApi';
import { getRetryChain } from '@/api/overview/healing';
import { TEMPLATE_CATALOG } from '@/lib/personas/templates/templateCatalog';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { useToastStore } from '@/stores/toastStore';
import { TEMPLATE_SAMPLE_INPUT } from '../executionListConstants';

export function useExecutionListState() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const isExecuting = usePersonaStore((state) => state.isExecuting);
  const setRerunInputData = usePersonaStore((state) => state.setRerunInputData);
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { copied: hasCopied, copy: copyToClipboard } = useCopyToClipboard();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const prevIsExecutingRef = useRef(isExecuting);

  const [showRaw, setShowRaw] = useState(false);

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const personaId = selectedPersona?.id || '';

  const sampleInput = useMemo(() => {
    if (!selectedPersona) return '{}';
    const match = TEMPLATE_CATALOG.find(
      (t) => t.name === selectedPersona.name,
    );
    const data = match ? TEMPLATE_SAMPLE_INPUT[match.id] ?? {} : {};
    return JSON.stringify(data, null, 2);
  }, [selectedPersona]);

  const handleTryIt = () => {
    setRerunInputData(sampleInput === '{}' ? '{}' : sampleInput);
  };

  const fetchExecutions = async () => {
    if (!personaId) return;
    setLoading(true);
    try {
      const data = await api.listExecutions(personaId);
      setExecutions(data || []);
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (personaId) {
      fetchExecutions();
    }
  }, [personaId]);

  // Re-fetch when execution finishes (isExecuting transitions true -> false)
  useEffect(() => {
    if (prevIsExecutingRef.current && !isExecuting && personaId) {
      fetchExecutions();
    }
    prevIsExecutingRef.current = isExecuting;
  }, [isExecuting, personaId]);

  // Auto-suggest retry comparison: when an execution with retries is expanded
  const handleAutoCompareRetry = useCallback(async (executionId: string) => {
    if (!personaId) return;
    try {
      const chain = await getRetryChain(executionId, personaId);
      if (chain.length >= 2) {
        // Compare original (first) vs latest retry (last)
        setCompareLeft(chain[0]!.id);
        setCompareRight(chain[chain.length - 1]!.id);
        setCompareMode(true);
      }
    } catch {
      useToastStore.getState().addToast('Failed to load retry chain for comparison', 'error');
    }
  }, [personaId]);

  const handleCompareSelect = (executionId: string) => {
    if (!compareLeft) {
      setCompareLeft(executionId);
    } else if (!compareRight && executionId !== compareLeft) {
      setCompareRight(executionId);
    } else {
      // Reset and start new selection
      setCompareLeft(executionId);
      setCompareRight(null);
    }
  };

  const exitCompareMode = () => {
    setCompareMode(false);
    setCompareLeft(null);
    setCompareRight(null);
    setShowComparison(false);
  };

  const canCompare = !!(compareLeft && compareRight && compareLeft !== compareRight);

  const leftExec = useMemo(
    () => executions.find(e => e.id === compareLeft) ?? null,
    [executions, compareLeft],
  );
  const rightExec = useMemo(
    () => executions.find(e => e.id === compareRight) ?? null,
    [executions, compareRight],
  );

  const formatTokens = (tokens: number) => {
    if (tokens === 0) return '-';
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return String(tokens);
  };

  const handleRowClick = (executionId: string) => {
    if (compareMode) {
      handleCompareSelect(executionId);
      return;
    }
    setExpandedId(expandedId === executionId ? null : executionId);
  };

  return {
    selectedPersona,
    executions,
    expandedId,
    hasCopied,
    copyToClipboard,
    copiedId,
    setCopiedId,
    loading,
    showRaw,
    setShowRaw,
    compareMode,
    setCompareMode,
    compareLeft,
    compareRight,
    showComparison,
    setShowComparison,
    sampleInput,
    handleTryIt,
    handleAutoCompareRetry,
    exitCompareMode,
    canCompare,
    leftExec,
    rightExec,
    formatTokens,
    handleRowClick,
    setRerunInputData,
  };
}
