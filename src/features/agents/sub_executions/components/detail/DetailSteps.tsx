import { useState, useCallback } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { Clock, Calendar, RotateCw, RefreshCw, Search, ListTree, Activity, Zap, Shield, Play } from 'lucide-react';
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

interface ExecutionDetailProps {
  execution: PersonaExecution;
}

export function ExecutionDetail({ execution }: ExecutionDetailProps) {
  const setRerunInputData = useSystemStore((s) => s.setRerunInputData);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const [activeTab, setActiveTab] = useState<'detail' | 'inspector' | 'trace' | 'pipeline' | 'replay'>('detail');

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
  const hasToolSteps = hasNonEmptyJson(execution.tool_steps, 'array');
  const hasInputData = hasNonEmptyJson(execution.input_data, 'object');
  const hasOutputData = hasNonEmptyJson(execution.output_data, 'object');

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex gap-1 p-1 rounded-xl bg-secondary/40 border border-primary/10 w-fit">
        <button onClick={() => setActiveTab('detail')} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${activeTab === 'detail' ? 'bg-primary/15 text-foreground/90 border border-primary/30' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
          <ListTree className="w-3.5 h-3.5" />Detail
        </button>
        {hasToolSteps && (
          <button onClick={() => setActiveTab('inspector')} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${activeTab === 'inspector' ? 'bg-primary/15 text-foreground/90 border border-primary/30' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
            <Search className="w-3.5 h-3.5" />Inspector
          </button>
        )}
        <button onClick={() => setActiveTab('trace')} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${activeTab === 'trace' ? 'bg-primary/15 text-foreground/90 border border-primary/30' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
          <Activity className="w-3.5 h-3.5" />Trace
        </button>
        <button onClick={() => setActiveTab('pipeline')} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${activeTab === 'pipeline' ? 'bg-primary/15 text-foreground/90 border border-primary/30' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
          <Zap className="w-3.5 h-3.5" />Pipeline
        </button>
        {isTerminalState(execution.status) && (
          <button onClick={() => setActiveTab('replay')} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${activeTab === 'replay' ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25' : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'}`}>
            <Play className="w-3.5 h-3.5" />Replay
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
              <div className="typo-code text-muted-foreground/80 uppercase tracking-wider">Status</div>
              <div className="flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 rounded-lg typo-heading ${badgeClass(getStatusEntry(execution.status))}`}>{getStatusEntry(execution.status).label}</span>
                {execution.retry_count > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count}`}>
                    <RefreshCw className="w-2.5 h-2.5" />Retry #{execution.retry_count}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1"><Clock className="w-3 h-3" />Duration</div>
              <div className="typo-code text-foreground">{formatDuration(execution.duration_ms)}</div>
            </div>
            <div className="space-y-1.5">
              <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3 h-3" />Started</div>
              <div className="typo-body text-foreground">{formatTimestamp(execution.started_at)}</div>
            </div>
            <div className="space-y-1.5">
              <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3 h-3" />Completed</div>
              <div className="typo-body text-foreground">{formatTimestamp(execution.completed_at)}</div>
            </div>
          </div>

          {/* Masked / Raw toggle */}
          {(execution.error_message || hasInputData || hasOutputData) && (
            <div className="flex justify-end">
              <button onClick={() => setShowRaw(!showRaw)} className={`flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-xl border transition-colors ${showRaw ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:text-muted-foreground/80'}`} title={showRaw ? 'Sensitive values are visible' : 'Sensitive values are masked'}>
                <Shield className="w-3 h-3" />{showRaw ? 'Raw' : 'Masked'}
              </button>
            </div>
          )}

          {execution.error_message && <ErrorDisplay errorMessage={execution.error_message} showRaw={showRaw} onErrorAction={handleErrorAction} />}

          {isTerminalState(execution.status) && (
            <button onClick={() => setRerunInputData(execution.input_data || '{}')} className="flex items-center gap-2 px-3.5 py-2 typo-heading rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors">
              <RotateCw className="w-3.5 h-3.5" />{execution.status === 'cancelled' ? 'Re-run execution' : 'Re-run with same input'}
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
