import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { getRetryChain } from '@/api/overview/healing';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { useToastStore } from '@/stores/toastStore';
import { useExecutionList, getSampleInput } from '../../libs/useExecutionList';

export function useExecutionListState() {
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);

  const personaId = selectedPersona?.id || '';
  const { executions, loading } = useExecutionList(personaId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { copied: hasCopied, copy: copyToClipboard } = useCopyToClipboard();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showRaw, setShowRaw] = useState(false);

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const [sampleInput, setSampleInput] = useState('{}');
  useEffect(() => {
    getSampleInput(selectedPersona?.name).then(setSampleInput);
  }, [selectedPersona?.name]);

  const handleTryIt = () => {
    setRerunInputData(sampleInput === '{}' ? '{}' : sampleInput);
  };

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
