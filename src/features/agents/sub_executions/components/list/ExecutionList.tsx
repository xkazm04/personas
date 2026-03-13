import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { Rocket, Play, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { listExecutions } from "@/api/agents/executions";
import { getRetryChain } from '@/api/overview/healing';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { ExecutionComparison } from './ExecutionComparison';
import { useToastStore } from '@/stores/toastStore';
import { getSampleInput } from '../../libs/useExecutionList';
import { ExecutionListFilters } from './ExecutionListFilters';
import { ExecutionListRow } from './ExecutionListRow';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';

export function ExecutionList() {
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const isExecuting = useAgentStore((state) => state.isExecuting);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { copied: hasCopied, copy: copyToClipboard } = useCopyToClipboard();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const prevIsExecutingRef = useRef(isExecuting);
  const [showRaw, setShowRaw] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const personaId = selectedPersona?.id || '';

  const sampleInput = useMemo(() => getSampleInput(selectedPersona?.name), [selectedPersona]);

  const handleTryIt = () => {
    setRerunInputData(sampleInput === '{}' ? '{}' : sampleInput);
  };

  const fetchExecutions = async () => {
    if (!personaId) return;
    setLoading(true);
    try {
      const data = await listExecutions(personaId);
      setExecutions(data || []);
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (personaId) fetchExecutions(); }, [personaId]);

  useEffect(() => {
    if (prevIsExecutingRef.current && !isExecuting && personaId) fetchExecutions();
    prevIsExecutingRef.current = isExecuting;
  }, [isExecuting, personaId]);

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
    return <div className="flex items-center justify-center py-8 text-muted-foreground/80">No persona selected</div>;
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
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
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
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center text-center py-12 px-6 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl">
          <div className="w-12 h-12 rounded-xl bg-primary/8 border border-primary/20 flex items-center justify-center mb-4">
            <Rocket className="w-5.5 h-5.5 text-primary/40" />
          </div>
          <p className="text-sm font-medium text-foreground/80">Your agent is ready to go</p>
          <p className="text-sm text-muted-foreground/80 mt-1 max-w-[260px]">Run it to see results here. Each execution will appear in this timeline.</p>
          <button onClick={handleTryIt} className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors">
            <Play className="w-3.5 h-3.5" />Try it now
          </button>
        </motion.div>
      ) : (
        <div className="overflow-hidden border border-primary/20 rounded-xl backdrop-blur-sm bg-secondary/40">
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2.5 bg-primary/8 border-b border-primary/10 text-sm font-mono text-muted-foreground/80 uppercase tracking-wider">
            {compareMode && <div className="col-span-1" />}
            <div className={compareMode ? 'col-span-2' : 'col-span-2'}>Status</div>
            <div className="col-span-2">Duration</div>
            <div className={compareMode ? 'col-span-2' : 'col-span-3'}>Started</div>
            <div className="col-span-2">Tokens</div>
            <div className={compareMode ? 'col-span-2' : 'col-span-3'}>Cost</div>
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
