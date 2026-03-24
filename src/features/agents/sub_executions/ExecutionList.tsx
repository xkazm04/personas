import { useState, useMemo, useCallback } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { getRetryChain } from '@/api/overview/healing';
import { ExecutionComparison } from './comparison/ExecutionComparison';
import { ExecutionListRow } from './ExecutionListRow';
import { ExecutionListToolbar, ExecutionListEmptyState } from './ExecutionListToolbar';
import { useToastStore } from '@/stores/toastStore';
import { useExecutionList, getSampleInput } from './libs/useExecutionList';

export function ExecutionList() {
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);

  const personaId = selectedPersona?.id || '';
  const { executions, loading } = useExecutionList(personaId);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showRaw, setShowRaw] = useState(false);

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const sampleInput = useMemo(() => getSampleInput(selectedPersona?.name), [selectedPersona]);

  const handleTryIt = () => {
    setRerunInputData(sampleInput === '{}' ? '{}' : sampleInput);
  };

  // Auto-suggest retry comparison
  const handleAutoCompareRetry = useCallback(async (executionId: string) => {
    if (!personaId) return;
    try {
      const chain = await getRetryChain(executionId, personaId);
      if (chain.length >= 2) {
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

  const handleRowClick = (executionId: string) => {
    if (compareMode) {
      handleCompareSelect(executionId);
      return;
    }
    setExpandedId(expandedId === executionId ? null : executionId);
  };

  const canCompare = compareLeft && compareRight && compareLeft !== compareRight;

  const leftExec = useMemo(
    () => executions.find(e => e.id === compareLeft) ?? null,
    [executions, compareLeft],
  );
  const rightExec = useMemo(
    () => executions.find(e => e.id === compareRight) ?? null,
    [executions, compareRight],
  );

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Show comparison view
  if (showComparison && leftExec && rightExec) {
    return (
      <div className="space-y-3">
        <ExecutionComparison left={leftExec} right={rightExec} onClose={exitCompareMode} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ExecutionListToolbar
        executionCount={executions.length}
        showRaw={showRaw}
        onToggleRaw={() => setShowRaw(!showRaw)}
        compareMode={compareMode}
        onToggleCompare={() => compareMode ? exitCompareMode() : setCompareMode(true)}
        compareLeft={compareLeft}
        compareRight={compareRight}
        canCompare={!!canCompare}
        onShowComparison={() => setShowComparison(true)}
      />

      {executions.length === 0 ? (
        <ExecutionListEmptyState onTryIt={handleTryIt} />
      ) : (
        <div className="overflow-hidden border border-primary/20 rounded-xl backdrop-blur-sm bg-secondary/40">
          {/* Header (desktop only) */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2.5 bg-primary/8 border-b border-primary/10 typo-code text-muted-foreground/80 uppercase tracking-wider">
            {compareMode && <div className="col-span-1" />}
            <div className={compareMode ? 'col-span-2' : 'col-span-2'}>Status</div>
            <div className="col-span-2">Duration</div>
            <div className={compareMode ? 'col-span-2' : 'col-span-3'}>Started</div>
            <div className="col-span-2">Tokens</div>
            <div className={compareMode ? 'col-span-2' : 'col-span-3'}>Cost</div>
          </div>

          {/* Rows */}
          {executions.map((execution, execIdx) => (
            <ExecutionListRow
              key={execution.id}
              execution={execution}
              execIdx={execIdx}
              executions={executions}
              isExpanded={expandedId === execution.id && !compareMode}
              compareMode={compareMode}
              compareLabel={compareLeft === execution.id ? 'A' : compareRight === execution.id ? 'B' : null}
              isCompareSelected={compareLeft === execution.id || compareRight === execution.id}
              showRaw={showRaw}
              onRowClick={handleRowClick}
              onRerun={setRerunInputData}
              onAutoCompareRetry={handleAutoCompareRetry}
            />
          ))}
        </div>
      )}
    </div>
  );
}
