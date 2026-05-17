import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { Rocket, Play, Clock } from 'lucide-react';
import { getExecution } from '@/api/agents/executions';
import { getRetryChain } from '@/api/overview/healing';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { ExecutionComparison } from './ExecutionComparison';
import { BulkRerunStrip } from './BulkRerunStrip';
import { BulkRerunReport } from './BulkRerunReport';
import { BulkRerunToolbar } from './BulkRerunToolbar';
import { useBulkRerun } from '../../libs/useBulkRerun';
import { useToastStore } from '@/stores/toastStore';
import { useExecutionList, getSampleInput } from '../../libs/useExecutionList';
import { ExecutionListFilters } from './ExecutionListFilters';
import { ExecutionListRow } from './ExecutionListRow';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { useTranslation } from '@/i18n/useTranslation';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { createLogger } from '@/lib/log';
import { useDensity } from '@/hooks/utility/data/useDensity';
import { DensityToggle } from '@/features/shared/components/display/DensityToggle';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { useExecutionAnnotations } from '@/hooks/agents/useExecutionAnnotations';
import { Star } from 'lucide-react';

const logger = createLogger('execution-list');

export function ExecutionList() {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);

  const personaId = selectedPersona?.id || '';
  const { executions: rawExecutions, loading } = useExecutionList(personaId);
  const useCases = useSelectedUseCases();
  const useCaseTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const uc of useCases) m.set(uc.id, uc.title);
    return m;
  }, [useCases]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { copied: hasCopied, copy: copyToClipboard } = useCopyToClipboard();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [showSimulations, setShowSimulations] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [executionDetails, setExecutionDetails] = useState<Record<string, PersonaExecution>>({});
  const { density, setDensity, tokens: densityTokens } = useDensity('execution-list');
  const { byExecution: annotationsByExecution, annotations } = useExecutionAnnotations(personaId);

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [showBulkReport, setShowBulkReport] = useState(false);
  const bulkRerun = useBulkRerun();

  // Two most recently starred executions among the currently-loaded rows,
  // ordered by annotation updated_at DESC. Powers the "compare starred pair"
  // shortcut in compare mode.
  const starredPair = useMemo(() => {
    const starred = rawExecutions
      .map((exec) => ({ exec, ann: annotationsByExecution.get(exec.id) }))
      .filter((x) => x.ann?.starred)
      .sort((a, b) => (b.ann!.updated_at ?? '').localeCompare(a.ann!.updated_at ?? ''));
    if (starred.length < 2) return null;
    return [starred[0]!.exec.id, starred[1]!.exec.id] as const;
  }, [rawExecutions, annotationsByExecution]);

  const hasSimulations = useMemo(
    () => rawExecutions.some((e) => e.is_simulation),
    [rawExecutions],
  );
  const executions = useMemo(
    () => (showSimulations ? rawExecutions : rawExecutions.filter((e) => !e.is_simulation)),
    [rawExecutions, showSimulations],
  );

  const [sampleInput, setSampleInput] = useState('{}');
  useEffect(() => {
    getSampleInput(selectedPersona?.name).then(setSampleInput, (err) => {
      // Keep the '{}' default — sample input is hint-only, not load-bearing.
      logger.warn('getSampleInput failed', { error: err });
    });
  }, [selectedPersona?.name]);

  const handleTryIt = () => {
    setRerunInputData(sampleInput === '{}' ? '{}' : sampleInput);
  };

  const handleAutoCompareRetry = useCallback(async (executionId: string) => {
    if (!personaId) return;
    try {
      const chain = await getRetryChain(executionId, personaId);
      if (chain.length >= 2) {
        setCompareLeft(chain[0]!.id);
        setCompareRight(chain[chain.length - 1]!.id);
        setCompareMode(true);
      }
    } catch (err) {
      logger.warn('Failed to load retry chain', { error: err });
      useToastStore.getState().addToast(e.failed_to_load_chain, 'error');
    }
  }, [personaId]);

  const handleCompareSelect = (executionId: string) => {
    if (!compareLeft) { setCompareLeft(executionId); }
    else if (!compareRight && executionId !== compareLeft) { setCompareRight(executionId); }
    else { setCompareLeft(executionId); setCompareRight(null); }
  };

  const exitCompareMode = () => {
    setCompareMode(false); setCompareLeft(null); setCompareRight(null); setShowComparison(false);
  };

  const canCompare = compareLeft && compareRight && compareLeft !== compareRight;

  const hydrateExecution = useCallback(async (executionId: string) => {
    if (executionDetails[executionId]) return executionDetails[executionId];
    const detail = await getExecution(executionId, personaId);
    setExecutionDetails((prev) => ({ ...prev, [executionId]: detail }));
    return detail;
  }, [executionDetails, personaId]);

  const handleAutoCompareStarred = useCallback(async () => {
    if (!starredPair) return;
    setCompareMode(true);
    setCompareLeft(starredPair[0]);
    setCompareRight(starredPair[1]);
    try {
      await Promise.all([hydrateExecution(starredPair[0]), hydrateExecution(starredPair[1])]);
      setShowComparison(true);
    } catch (err) {
      logger.warn('Failed to hydrate starred-pair comparison', { error: err });
    }
  }, [starredPair, hydrateExecution]);

  const leftExec = compareLeft ? executionDetails[compareLeft] ?? null : null;
  const rightExec = compareRight ? executionDetails[compareRight] ?? null : null;

  const toggleBulkSelected = useCallback((executionId: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(executionId)) next.delete(executionId);
      else next.add(executionId);
      return next;
    });
  }, []);

  const handleRowClick = useCallback((executionId: string) => {
    if (bulkMode) { toggleBulkSelected(executionId); return; }
    if (compareMode) { handleCompareSelect(executionId); return; }
    const nextExpandedId = expandedId === executionId ? null : executionId;
    setExpandedId(nextExpandedId);
    if (nextExpandedId) {
      void hydrateExecution(nextExpandedId).catch((err) => {
        logger.warn('Failed to hydrate execution detail', { executionId: nextExpandedId, error: err });
      });
    }
  }, [bulkMode, compareMode, expandedId, toggleBulkSelected, hydrateExecution]);

  // Stable refs for the per-row handlers — pairs with React.memo on
  // ExecutionListRow so a parent re-render that doesn't touch these
  // dependencies skips the row subtree.
  const handleCopyId = useCallback((id: string) => {
    copyToClipboard(id);
    setCopiedId(id);
  }, [copyToClipboard]);

  const handleRerun = useCallback((inputData: string | null) => {
    setRerunInputData(inputData || '{}');
  }, [setRerunInputData]);

  const enterBulkMode = () => {
    setBulkMode(true);
    setBulkSelected(new Set());
    setCompareMode(false);
    setCompareLeft(null);
    setCompareRight(null);
    setShowComparison(false);
    setExpandedId(null);
  };

  const exitBulkMode = () => {
    setBulkMode(false);
    setBulkSelected(new Set());
    setShowBulkReport(false);
    bulkRerun.reset();
  };

  const handleSelectAllFailed = useCallback(() => {
    const failedIds = executions
      .filter((row) => row.status === 'failed' || row.status === 'cancelled' || row.status === 'timeout')
      .map((row) => row.id);
    setBulkSelected(new Set(failedIds));
  }, [executions]);

  const handleSelectSinceTimestamp = useCallback((isoTimestamp: string) => {
    const failedIds = executions
      .filter((row) => {
        const isFailed = row.status === 'failed' || row.status === 'cancelled' || row.status === 'timeout';
        if (!isFailed) return false;
        const ts = row.started_at ?? row.created_at;
        return ts >= isoTimestamp;
      })
      .map((row) => row.id);
    setBulkSelected(new Set(failedIds));
  }, [executions]);

  const handleClearBulkSelection = useCallback(() => setBulkSelected(new Set()), []);

  const handleStartBulkRerun = useCallback(async () => {
    if (!personaId) return;
    const rows = executions.filter((row) => bulkSelected.has(row.id));
    if (rows.length === 0) return;
    setShowBulkReport(false);
    try {
      await bulkRerun.start(rows, personaId);
      setShowBulkReport(true);
      // Refresh shared execution list so new rows surface in the table.
      void useAgentStore.getState().fetchExecutions(personaId).catch((err) => {
        logger.warn('Post-bulk-rerun fetch failed', { err });
      });
    } catch (err) {
      logger.warn('Bulk rerun failed', { err });
      useToastStore.getState().addToast(e.bulk_rerun_failed_toast, 'error');
    }
  }, [bulkRerun, bulkSelected, executions, personaId, e.bulk_rerun_failed_toast]);

  const handleBulkCompareItem = useCallback(async (originalId: string, newExecutionId: string) => {
    if (!personaId) return;
    try {
      await Promise.all([hydrateExecution(originalId), hydrateExecution(newExecutionId)]);
      setCompareLeft(originalId);
      setCompareRight(newExecutionId);
      setShowBulkReport(false);
      setBulkMode(false);
      setCompareMode(true);
      setShowComparison(true);
    } catch (err) {
      logger.warn('Failed to hydrate bulk-rerun pair', { err });
      useToastStore.getState().addToast(e.failed_to_hydrate_comparison, 'error');
    }
  }, [hydrateExecution, personaId, e.failed_to_hydrate_comparison]);

  const handleShowComparison = async () => {
    if (!compareLeft || !compareRight) return;
    try {
      await Promise.all([hydrateExecution(compareLeft), hydrateExecution(compareRight)]);
      setShowComparison(true);
    } catch (err) {
      logger.warn('Failed to hydrate comparison executions', { error: err });
      useToastStore.getState().addToast(e.failed_to_hydrate_comparison, 'error');
    }
  };

  if (!selectedPersona) {
    return <div className="flex items-center justify-center py-8 text-foreground">{e.no_persona_selected}</div>;
  }

  if (loading) {
    return <ContentLoader variant="panel" hint="executions" />;
  }

  if (showComparison && leftExec && rightExec) {
    return <div className="space-y-3"><ExecutionComparison left={leftExec} right={rightExec} onClose={exitCompareMode} /></div>;
  }

  if (showBulkReport && bulkRerun.phase === 'completed') {
    return (
      <div className="space-y-3">
        <BulkRerunReport
          cohort={bulkRerun.cohort}
          items={bulkRerun.items}
          onClose={exitBulkMode}
          onCompareItem={(orig, next) => { void handleBulkCompareItem(orig, next); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="flex items-center gap-2.5 typo-heading text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          <Clock className="w-3.5 h-3.5" />
          {e.history}
        </h4>
        <ExecutionListFilters
          showRaw={showRaw} setShowRaw={setShowRaw}
          showSimulations={showSimulations} setShowSimulations={setShowSimulations}
          hasSimulations={hasSimulations}
          compareMode={compareMode} exitCompareMode={exitCompareMode} setCompareMode={setCompareMode}
          hasExecutions={executions.length > 0} hasEnoughToCompare={executions.length >= 2}
          compareLeft={compareLeft} compareRight={compareRight}
          canCompare={!!canCompare} onShowComparison={() => { void handleShowComparison(); }}
        />
        <BulkRerunToolbar
          bulkMode={bulkMode}
          onEnter={enterBulkMode}
          onExit={exitBulkMode}
          selectedIds={bulkSelected}
          rows={executions}
          annotations={annotations}
          onSelectAllFailed={handleSelectAllFailed}
          onSelectSinceTimestamp={handleSelectSinceTimestamp}
          onClear={handleClearBulkSelection}
          onStart={() => { void handleStartBulkRerun(); }}
          hasExecutions={executions.length > 0}
          hasEnoughToBulk={executions.length >= 2}
        />
        {starredPair && (
          <button
            onClick={() => { void handleAutoCompareStarred(); }}
            className="flex items-center gap-1 px-2 py-1 typo-body rounded-card transition-colors text-amber-400 hover:bg-amber-500/10 border border-amber-400/20"
            title={e.compare_starred_pair_tooltip}
          >
            <Star className="w-3 h-3" fill="currentColor" />
            {e.compare_starred_pair}
          </button>
        )}
        <div className="ml-auto">
          <DensityToggle density={density} onChange={setDensity} scopeId="execution-list" />
        </div>
      </div>

      {(bulkRerun.phase === 'running' || (bulkRerun.phase === 'completed' && !showBulkReport)) && (
        <BulkRerunStrip
          phase={bulkRerun.phase}
          items={bulkRerun.items}
          cohort={bulkRerun.cohort}
          onCancel={bulkRerun.cancel}
          onOpenReport={() => setShowBulkReport(true)}
        />
      )}

      {executions.length === 0 ? (
        <div
          className="animate-fade-slide-in flex flex-col items-center text-center py-12 px-6 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal">
          <div className="w-12 h-12 rounded-modal bg-primary/8 border border-primary/20 flex items-center justify-center mb-4">
            <Rocket className="w-5.5 h-5.5 text-primary/40" />
          </div>
          <p className="typo-heading text-foreground">{e.agent_ready}</p>
          <p className="typo-body text-foreground mt-1 max-w-[260px]">{e.agent_ready_subtitle}</p>
          <button onClick={handleTryIt} className="mt-4 flex items-center gap-2 px-4 py-2 typo-heading rounded-modal bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors">
            <Play className="w-3.5 h-3.5" />{e.try_it_now}
          </button>
        </div>
      ) : (
        <div className="overflow-hidden border border-primary/20 rounded-modal backdrop-blur-sm bg-secondary/40">
          <div className={`hidden md:grid grid-cols-12 gap-4 px-4 ${densityTokens.headerPaddingY} bg-primary/8 border-b border-primary/10 typo-code text-foreground uppercase tracking-wider`}>
            {(compareMode || bulkMode) && <div className="col-span-1">{bulkMode ? e.bulk_rerun_col_header : ''}</div>}
            <div className="col-span-2">{e.col_status}</div>
            <div className="col-span-2">{e.col_capability}</div>
            <div className={compareMode || bulkMode ? 'col-span-1' : 'col-span-2'}>{e.col_duration}</div>
            <div className="col-span-2">{e.col_started}</div>
            <div className="col-span-2">{e.col_tokens}</div>
            <div className={compareMode || bulkMode ? 'col-span-1' : 'col-span-2'}>{e.col_cost}</div>
          </div>

          {executions.map((execution, execIdx) => (
            <ExecutionListRow
              key={execution.id}
              execution={executionDetails[execution.id] ?? execution}
              execIdx={execIdx}
              executions={executions}
              compareMode={compareMode}
              compareLeft={compareLeft}
              compareRight={compareRight}
              bulkMode={bulkMode}
              bulkSelected={bulkSelected.has(execution.id)}
              bulkDisabled={bulkMode && bulkRerun.phase === 'running'}
              isExpanded={expandedId === execution.id && !compareMode && !bulkMode}
              showRaw={showRaw}
              hasCopied={hasCopied}
              copiedId={copiedId}
              capabilityTitle={execution.use_case_id ? useCaseTitleById.get(execution.use_case_id) ?? null : null}
              onRowClick={handleRowClick}
              onCopyId={handleCopyId}
              onRerun={handleRerun}
              onAutoCompareRetry={handleAutoCompareRetry}
              densityTokens={densityTokens}
            />
          ))}
        </div>
      )}
    </div>
  );
}
