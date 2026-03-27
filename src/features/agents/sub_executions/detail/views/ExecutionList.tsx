import { Rocket, Play } from 'lucide-react';
import { ExecutionComparison } from '../../components/list/ExecutionComparison';
import { ExecutionListHeader } from './ExecutionListHeader';
import { ExecutionRow } from './ExecutionRow';
import { useExecutionListState } from './useExecutionListState';

export function ExecutionList() {
  const {
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
    handleTryIt,
    handleAutoCompareRetry,
    exitCompareMode,
    canCompare,
    leftExec,
    rightExec,
    formatTokens,
    handleRowClick,
    setRerunInputData,
  } = useExecutionListState();

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  if (loading) return null;

  // Show comparison view
  if (showComparison && leftExec && rightExec) {
    return (
      <div className="space-y-3">
        <ExecutionComparison
          left={leftExec}
          right={rightExec}
          onClose={exitCompareMode}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ExecutionListHeader
        executionCount={executions.length}
        showRaw={showRaw}
        setShowRaw={setShowRaw}
        compareMode={compareMode}
        setCompareMode={setCompareMode}
        exitCompareMode={exitCompareMode}
        compareLeft={compareLeft}
        compareRight={compareRight}
        canCompare={canCompare}
        setShowComparison={setShowComparison}
      />

      {executions.length === 0 ? (
        <div
          className="animate-fade-slide-in flex flex-col items-center text-center py-12 px-6 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl"
        >
          <div className="w-12 h-12 rounded-xl bg-primary/8 border border-primary/20 flex items-center justify-center mb-4">
            <Rocket className="w-5.5 h-5.5 text-primary/40" />
          </div>
          <p className="typo-heading text-foreground/80">
            Your agent is ready to go
          </p>
          <p className="typo-body text-muted-foreground/80 mt-1 max-w-[260px]">
            Run it to see results here. Each execution will appear in this timeline.
          </p>
          <button
            onClick={handleTryIt}
            className="mt-4 flex items-center gap-2 px-4 py-2 typo-heading rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Try it now
          </button>
        </div>
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
            <ExecutionRow
              key={execution.id}
              execution={execution}
              execIdx={execIdx}
              executions={executions}
              compareMode={compareMode}
              compareLeft={compareLeft}
              compareRight={compareRight}
              expandedId={expandedId}
              showRaw={showRaw}
              hasCopied={hasCopied}
              copiedId={copiedId}
              formatTokens={formatTokens}
              handleRowClick={handleRowClick}
              copyToClipboard={copyToClipboard}
              setCopiedId={setCopiedId}
              setRerunInputData={setRerunInputData}
              handleAutoCompareRetry={handleAutoCompareRetry}
            />
          ))}
        </div>
      )}
    </div>
  );
}
