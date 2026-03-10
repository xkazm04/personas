import { useState, useMemo, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useOverviewFilters } from '@/features/overview/components/OverviewFilterContext';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

/**
 * Manages healing-issue UI state: filtering, sorting, analysis triggers,
 * and the selected-issue modal. Reads healing data from the store
 * (fetched by useOverviewMetrics).
 */
export function useHealingWorkflow() {
  const healingIssues = usePersonaStore((s) => s.healingIssues);
  const healingRunning = usePersonaStore((s) => s.healingRunning);
  const triggerHealing = usePersonaStore((s) => s.triggerHealing);
  const resolveHealingIssue = usePersonaStore((s) => s.resolveHealingIssue);
  const personas = usePersonaStore((s) => s.personas);

  const { selectedPersonaId } = useOverviewFilters();

  const [selectedIssue, setSelectedIssue] = useState<PersonaHealingIssue | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'auto-fixed'>('all');
  const [analysisResult, setAnalysisResult] = useState<{
    failures_analyzed: number;
    issues_created: number;
    auto_fixed: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const handleRunAnalysis = useCallback(async () => {
    setAnalysisResult(null);
    setAnalysisError(null);
    const targetPersonaId = selectedPersonaId || personas[0]?.id;
    if (!targetPersonaId) {
      setAnalysisError('No persona available for analysis. Create a persona first.');
      return;
    }
    try {
      const result = await triggerHealing(targetPersonaId);
      if (result) setAnalysisResult(result);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Failed to run analysis. Please retry.');
    }
  }, [triggerHealing, selectedPersonaId, personas]);

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
    healingIssues,
    healingRunning,
    resolveHealingIssue,
    selectedIssue,
    setSelectedIssue,
    issueFilter,
    setIssueFilter,
    analysisResult,
    setAnalysisResult,
    analysisError,
    setAnalysisError,
    handleRunAnalysis,
    issueCounts,
    sortedFilteredIssues,
  };
}
