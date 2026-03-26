import { useState, useMemo, useCallback, useEffect } from 'react';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

interface UseHealingPanelStateParams {
  healingIssues: PersonaHealingIssue[];
  triggerHealing: (personaId: string) => Promise<{ failures_analyzed: number; issues_created: number; auto_fixed: number } | null>;
  selectedPersonaId: string | null;
  personas: { id: string }[];
  fetchHealingTimeline: (personaId: string) => void;
}

export function useHealingPanelState({
  healingIssues,
  triggerHealing,
  selectedPersonaId,
  personas,
  fetchHealingTimeline,
}: UseHealingPanelStateParams) {
  const [selectedIssue, setSelectedIssue] = useState<PersonaHealingIssue | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'auto-fixed'>('all');
  const [analysisResult, setAnalysisResult] = useState<{
    failures_analyzed: number;
    issues_created: number;
    auto_fixed: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [healingViewMode, setHealingViewMode] = useState<'list' | 'timeline'>('list');

  const handleRunAnalysis = useCallback(async () => {
    setAnalysisResult(null);
    setAnalysisError(null);
    try {
      const pid = selectedPersonaId || personas[0]?.id;
      if (!pid) return;
      const result = await triggerHealing(pid);
      if (result) {
        setAnalysisResult(result);
      } else {
        setAnalysisError('Healing analysis failed. Please try again.');
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Healing analysis failed');
    }
  }, [triggerHealing, selectedPersonaId, personas]);

  useEffect(() => {
    if (healingViewMode === 'timeline') {
      const pid = selectedPersonaId || personas[0]?.id;
      if (pid) fetchHealingTimeline(pid);
    }
  }, [healingViewMode, selectedPersonaId, personas, fetchHealingTimeline]);

  const { issueCounts, sortedFilteredIssues } = useMemo(() => {
    let open = 0, autoFixed = 0;
    for (const i of healingIssues) {
      if (i.auto_fixed) autoFixed++;
      else open++;
    }
    const counts = { all: healingIssues.length, open, autoFixed };
    const filtered = issueFilter === 'all' ? healingIssues
      : issueFilter === 'open' ? healingIssues.filter(i => !i.auto_fixed)
      : healingIssues.filter(i => i.auto_fixed);
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...filtered].sort((a, b) => {
      if (a.auto_fixed !== b.auto_fixed) return a.auto_fixed ? 1 : -1;
      return (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    });
    return { issueCounts: counts, sortedFilteredIssues: sorted };
  }, [healingIssues, issueFilter]);

  return {
    selectedIssue,
    setSelectedIssue,
    issueFilter,
    setIssueFilter,
    analysisResult,
    setAnalysisResult,
    analysisError,
    setAnalysisError,
    healingViewMode,
    setHealingViewMode,
    handleRunAnalysis,
    issueCounts,
    sortedFilteredIssues,
  };
}
