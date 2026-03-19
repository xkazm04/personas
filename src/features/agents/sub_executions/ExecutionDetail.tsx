import { useState } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { Search, ListTree, Zap, Activity, Play } from 'lucide-react';
import { ExecutionInspector } from './components/detail/ExecutionInspector';
import { TraceInspector } from './components/detail/TraceInspector';
import { PipelineWaterfall } from './replay/PipelineWaterfall';
import { ReplaySandbox } from './replay/ReplaySandbox';
import { isTerminalState } from '@/lib/execution/executionState';
import { hasNonEmptyJson } from './executionDetailHelpers';
import { ExecutionDetailContent } from './ExecutionDetailContent';

interface ExecutionDetailProps {
  execution: PersonaExecution;
}

export function ExecutionDetail({ execution }: ExecutionDetailProps) {
  const [activeTab, setActiveTab] = useState<'detail' | 'inspector' | 'trace' | 'pipeline' | 'replay'>('detail');

  const hasToolSteps = hasNonEmptyJson(execution.tool_steps, 'array');

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex gap-1 p-1 rounded-xl bg-secondary/40 border border-primary/10 w-fit">
        <button
          onClick={() => setActiveTab('detail')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${
            activeTab === 'detail'
              ? 'bg-primary/15 text-foreground/90 border border-primary/30'
              : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'
          }`}
        >
          <ListTree className="w-3.5 h-3.5" />
          Detail
        </button>
        {hasToolSteps && (
          <button
            onClick={() => setActiveTab('inspector')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${
              activeTab === 'inspector'
                ? 'bg-primary/15 text-foreground/90 border border-primary/30'
                : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Inspector
          </button>
        )}
        <button
          onClick={() => setActiveTab('trace')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${
            activeTab === 'trace'
              ? 'bg-primary/15 text-foreground/90 border border-primary/30'
              : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Trace
        </button>
        <button
          onClick={() => setActiveTab('pipeline')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${
            activeTab === 'pipeline'
              ? 'bg-primary/15 text-foreground/90 border border-primary/30'
              : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          Pipeline
        </button>
        {isTerminalState(execution.status) && (
          <button
            onClick={() => setActiveTab('replay')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl typo-heading transition-all ${
              activeTab === 'replay'
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                : 'text-muted-foreground/90 hover:text-foreground/95 border border-transparent'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            Replay
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
        <ExecutionDetailContent execution={execution} />
      )}
    </div>
  );
}
