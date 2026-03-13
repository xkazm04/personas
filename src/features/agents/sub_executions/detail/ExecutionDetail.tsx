import { useState } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { ExecutionInspector } from '@/features/agents/sub_executions/detail/inspector/ExecutionInspector';
import { TraceInspector } from '@/features/agents/sub_executions/detail/inspector/TraceInspector';
import { PipelineWaterfall } from '@/features/agents/sub_executions/replay/PipelineWaterfall';
import { ReplaySandbox } from '@/features/agents/sub_executions/replay/ReplaySandbox';
import { hasNonEmptyJson } from './executionDetailTypes';
import { ExecutionDetailTabs, type DetailTab } from './ExecutionDetailTabs';
import { ExecutionDetailContent } from './ExecutionDetailContent';

interface ExecutionDetailProps {
  execution: PersonaExecution;
}

export function ExecutionDetail({ execution }: ExecutionDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('detail');

  const hasToolSteps = hasNonEmptyJson(execution.tool_steps, 'array');
  const hasInputData = hasNonEmptyJson(execution.input_data, 'object');
  const hasOutputData = hasNonEmptyJson(execution.output_data, 'object');

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <ExecutionDetailTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        hasToolSteps={hasToolSteps}
        executionStatus={execution.status}
      />

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
        <ExecutionDetailContent
          execution={execution}
          hasInputData={hasInputData}
          hasOutputData={hasOutputData}
        />
      )}
    </div>
  );
}
