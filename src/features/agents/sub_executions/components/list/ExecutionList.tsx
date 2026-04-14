import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { Rocket, Play, Clock } from 'lucide-react';
import { getRetryChain } from '@/api/overview/healing';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { ExecutionComparison } from './ExecutionComparison';
import { useToastStore } from '@/stores/toastStore';
import { useExecutionList, getSampleInput } from '../../libs/useExecutionList';
import { ExecutionListFilters } from './ExecutionListFilters';
import { ExecutionListRow } from './ExecutionListRow';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { useTranslation } from '@/i18n/useTranslation';

export function ExecutionList() {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);

  const personaId = selectedPersona?.id || '';
  const { executions, loading } = useExecutionList(personaId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { copied: hasCopied, copy: copyToClipboard } = useCopyToClipboard();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
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

  const leftExec = useMemo(() => executions.find(e => e.id === compareLeft) ?? null, [executions, compareLeft]);
  const rightExec = useMemo(() => executions.find(e => e.id === compareRight) ?? null, [executions, compareRight]);

  const handleRowClick = (executionId: string) => {
    if (compareMode) { handleCompareSelect(executionId); return; }
    setExpandedId(expandedId === executionId ? null : executionId);
  };

  if (!selectedPersona) {
    return <div className="flex items-center justify-center py-8 text-muted-foreground/80">{e.no_persona_selected}</div>;
  }

  if (loading) {
    return <ContentLoader variant="panel" hint="executions" />;
  }

  if (showComparison && leftExec && rightExec) {
    return <div className="space-y-3"><ExecutionComparison left={leftExec} right={rightExec} onClose={exitCompareMode} /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="flex items-center gap-2.5 typo-heading text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          <Clock className="w-3.5 h-3.5" />
          History
        </h4>
        <ExecutionListFilters
          showRaw={showRaw} setShowRaw={setShowRaw}
          compareMode={compareMode} exitCompareMode={exitCompareMode} setCompareMode={setCompareMode}
          hasExecutions={executions.length > 0} hasEnoughToCompare={executions.length >= 2}
          compareLeft={compareLeft} compareRight={compareRight}
          canCompare={!!canCompare} onShowComparison={() => setShowComparison(true)}
        />
      </div>

      {executions.length === 0 ? (
        <div
          className="animate-fade-slide-in flex flex-col items-center text-center py-12 px-6 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl">
          <div className="w-12 h-12 rounded-xl bg-primary/8 border border-primary/20 flex items-center justify-center mb-4">
            <Rocket className="w-5.5 h-5.5 text-primary/40" />
          </div>
          <p className="typo-heading text-foreground/80">{e.agent_ready}</p>
          <p className="typo-body text-muted-foreground/80 mt-1 max-w-[260px]">{e.agent_ready_subtitle}</p>
          <button onClick={handleTryIt} className="mt-4 flex items-center gap-2 px-4 py-2 typo-heading rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors">
            <Play className="w-3.5 h-3.5" />{e.try_it_now}
          </button>
        </div>
      ) : (
        <div className="overflow-hidden border border-primary/20 rounded-xl backdrop-blur-sm bg-secondary/40">
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2.5 bg-primary/8 border-b border-primary/10 typo-code text-muted-foreground/80 uppercase tracking-wider">
            {compareMode && <div className="col-span-1" />}
            <div className={compareMode ? 'col-span-2' : 'col-span-2'}>{e.col_status}</div>
            <div className="col-span-2">{e.col_duration}</div>
            <div className={compareMode ? 'col-span-2' : 'col-span-3'}>{e.col_started}</div>
            <div className="col-span-2">{e.col_tokens}</div>
            <div className={compareMode ? 'col-span-2' : 'col-span-3'}>{e.col_cost}</div>
          </div>

          {executions.map((execution, execIdx) => (
            <ExecutionListRow
              key={execution.id}
              execution={execution}
              execIdx={execIdx}
              executions={executions}
              compareMode={compareMode}
              compareLeft={compareLeft}
              compareRight={compareRight}
              isExpanded={expandedId === execution.id && !compareMode}
              showRaw={showRaw}
              hasCopied={hasCopied}
              copiedId={copiedId}
              onRowClick={handleRowClick}
              onCopyId={(id) => { copyToClipboard(id); setCopiedId(id); }}
              onRerun={(inputData) => setRerunInputData(inputData || '{}')}
              onAutoCompareRetry={handleAutoCompareRetry}
            />
          ))}
        </div>
      )}
    </div>
  );
}
