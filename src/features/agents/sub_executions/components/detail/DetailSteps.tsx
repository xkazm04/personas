import { useState, useCallback } from 'react';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { PersonaExecution } from '@/lib/types/types';
import { Clock, Calendar, RotateCw, RefreshCw, Search, ListTree, Activity, Zap, Shield, Play, Loader2, Check, AlertTriangle } from 'lucide-react';
import { formatTimestamp, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { isTerminalState } from '@/lib/execution/executionState';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { hasNonEmptyJson, type ErrorAction } from '../../libs/useExecutionDetail';
import { ErrorDisplay } from './DetailHeader';
import { DetailDataSections, DetailMemories, DetailLogSection } from './DetailMetadata';
import { ExecutionInspector } from './ExecutionInspector';
import { TraceInspector } from './TraceInspector';
import { PipelineWaterfall } from '../replay/PipelineWaterfall';
import { ReplaySandbox } from '../replay/ReplaySandbox';
import { useTranslation } from '@/i18n/useTranslation';

interface ExecutionDetailProps {
  execution: PersonaExecution;
}

export function ExecutionDetail({ execution }: ExecutionDetailProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const executePersona = useAgentStore((s) => s.executePersona);
  const fetchExecutions = useAgentStore((s) => s.fetchExecutions);
  const [activeTab, setActiveTab] = useState<'detail' | 'inspector' | 'trace' | 'pipeline' | 'replay'>('detail');
  const [isRerunning, setIsRerunning] = useState(false);
  const [rerunResult, setRerunResult] = useState<'success' | 'error' | null>(null);

  const handleRerun = useCallback(async () => {
    setIsRerunning(true);
    setRerunResult(null);
    try {
      let inputData: object | undefined;
      if (execution.input_data) {
        inputData = parseJsonOrDefault(execution.input_data, undefined);
      }
      const newId = await executePersona(execution.persona_id, inputData);
      if (newId) {
        setRerunResult('success');
        fetchExecutions(execution.persona_id);
      } else {
        setRerunResult('error');
      }
    } catch {
      setRerunResult('error');
    } finally {
      setIsRerunning(false);
    }
  }, [execution.persona_id, execution.input_data, executePersona, fetchExecutions]);

  const handleErrorAction = useCallback((action: ErrorAction) => {
    switch (action.navigate) {
      case 'vault': setSidebarSection('credentials'); break;
      case 'triggers': setSidebarSection('events'); break;
      case 'persona-settings':
        if (execution.persona_id) { selectPersona(execution.persona_id); setEditorTab('settings'); }
        break;
    }
  }, [execution.persona_id, setSidebarSection, setEditorTab, selectPersona]);

  const [showRaw, setShowRaw] = useState(false);
  const hasToolSteps = Array.isArray(execution.tool_steps) && execution.tool_steps.length > 0;
  const hasInputData = hasNonEmptyJson(execution.input_data, 'object');
  const hasOutputData = hasNonEmptyJson(execution.output_data, 'object');

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex gap-1 p-1 rounded-modal bg-secondary/40 border border-primary/10 w-fit">
        <button onClick={() => setActiveTab('detail')} className={`flex items-center gap-2 px-3 py-1.5 rounded-modal typo-heading transition-all ${activeTab === 'detail' ? 'bg-primary/15 text-foreground/90 border border-primary/30' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
          <ListTree className="w-3.5 h-3.5" />{e.tab_detail}
        </button>
        {hasToolSteps && (
          <button onClick={() => setActiveTab('inspector')} className={`flex items-center gap-2 px-3 py-1.5 rounded-modal typo-heading transition-all ${activeTab === 'inspector' ? 'bg-primary/15 text-foreground/90 border border-primary/30' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
            <Search className="w-3.5 h-3.5" />{e.tab_inspector}
          </button>
        )}
        <button onClick={() => setActiveTab('trace')} className={`flex items-center gap-2 px-3 py-1.5 rounded-modal typo-heading transition-all ${activeTab === 'trace' ? 'bg-primary/15 text-foreground/90 border border-primary/30' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
          <Activity className="w-3.5 h-3.5" />{e.tab_trace}
        </button>
        <button onClick={() => setActiveTab('pipeline')} className={`flex items-center gap-2 px-3 py-1.5 rounded-modal typo-heading transition-all ${activeTab === 'pipeline' ? 'bg-primary/15 text-foreground/90 border border-primary/30' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
          <Zap className="w-3.5 h-3.5" />{e.tab_pipeline}
        </button>
        {isTerminalState(execution.status) && (
          <button onClick={() => setActiveTab('replay')} className={`flex items-center gap-2 px-3 py-1.5 rounded-modal typo-heading transition-all ${activeTab === 'replay' ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
            <Play className="w-3.5 h-3.5" />{e.tab_replay}
          </button>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'replay' ? (
        <ReplaySandbox execution={execution} />
      ) : activeTab === 'pipeline' ? (
        <PipelineWaterfall execution={execution} />
      ) : activeTab === 'trace' ? (
        <TraceInspector execution={execution} />
      ) : activeTab === 'inspector' && hasToolSteps ? (
        <ExecutionInspector execution={execution} />
      ) : (
        <>
          {/* Status Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 3xl:gap-5 4xl:gap-6">
            <div className="space-y-1.5">
              <div className="typo-code text-muted-foreground/80 uppercase tracking-wider">{e.col_status}</div>
              <div className="flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 rounded-card typo-heading ${badgeClass(getStatusEntry(execution.status))}`}>{getStatusEntry(execution.status).label}</span>
                {execution.retry_count > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-card bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={tx(e.healing_retry, { count: execution.retry_count })}>
                    <RefreshCw className="w-2.5 h-2.5" />{tx(e.retry_count, { count: execution.retry_count })}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1"><Clock className="w-3 h-3" />{e.col_duration}</div>
              <div className="typo-code text-foreground">{formatDuration(execution.duration_ms)}</div>
            </div>
            <div className="space-y-1.5">
              <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3 h-3" />{e.col_started}</div>
              <div className="typo-body text-foreground">{formatTimestamp(execution.started_at)}</div>
            </div>
            <div className="space-y-1.5">
              <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3 h-3" />{e.completed}</div>
              <div className="typo-body text-foreground">{formatTimestamp(execution.completed_at)}</div>
            </div>
          </div>

          {/* Masked / Raw toggle */}
          {(execution.error_message || hasInputData || hasOutputData) && (
            <div className="flex justify-end">
              <button onClick={() => setShowRaw(!showRaw)} className={`flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-modal border transition-colors ${showRaw ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:text-muted-foreground/80'}`} title={showRaw ? e.sensitive_visible : e.sensitive_masked}>
                <Shield className="w-3 h-3" />{showRaw ? e.raw : e.masked}
              </button>
            </div>
          )}

          {execution.error_message && <ErrorDisplay errorMessage={execution.error_message} showRaw={showRaw} onErrorAction={handleErrorAction} />}

          {isTerminalState(execution.status) && (
            <button
              onClick={handleRerun}
              disabled={isRerunning}
              className={`flex items-center gap-2 px-3.5 py-2 typo-heading rounded-modal border transition-colors disabled:opacity-50 ${
                rerunResult === 'success'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : rerunResult === 'error'
                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : 'bg-primary/10 text-primary/80 border-primary/20 hover:bg-primary/20 hover:text-primary'
              }`}
            >
              {isRerunning
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {e.running_state}</>
                : rerunResult === 'success'
                ? <><Check className="w-3.5 h-3.5" /> {e.execution_started}</>
                : rerunResult === 'error'
                ? <><AlertTriangle className="w-3.5 h-3.5" /> {e.rerun_failed}</>
                : <><RotateCw className="w-3.5 h-3.5" />{execution.status === 'cancelled' ? e.rerun_execution : e.rerun_with_same_input}</>}
            </button>
          )}

          <DetailDataSections execution={execution} showRaw={showRaw} hasInputData={hasInputData} hasOutputData={hasOutputData} />
          <DetailMemories execution={execution} />
          <DetailLogSection execution={execution} />
        </>
      )}
    </div>
  );
}
