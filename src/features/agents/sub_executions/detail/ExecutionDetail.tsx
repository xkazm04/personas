import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { PersonaExecution } from '@/lib/types/types';
import { ExecutionInspector } from '@/features/agents/sub_executions/detail/inspector/ExecutionInspector';
import { TraceInspector } from '@/features/agents/sub_executions/detail/inspector/TraceInspector';
import { PipelineWaterfall } from '@/features/agents/sub_executions/replay/PipelineWaterfall';
import { ReplaySandbox } from '@/features/agents/sub_executions/replay/ReplaySandbox';
import { hasNonEmptyJson } from './executionDetailTypes';
import { ExecutionDetailTabs, type DetailTab } from './ExecutionDetailTabs';
import { ExecutionDetailContent } from './ExecutionDetailContent';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { AnnotationEditor } from '../components/AnnotationEditor';
import { useExecutionAnnotations } from '@/hooks/agents/useExecutionAnnotations';
import { useDryRun } from '../libs/useDryRun';
import { DryRunModal } from '../components/runner/DryRunModal';
import { useTranslation } from '@/i18n/useTranslation';

interface ExecutionDetailProps {
  execution: PersonaExecution;
}

export function ExecutionDetail({ execution }: ExecutionDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('detail');
  const { byExecution, knownTags, upsert, remove } = useExecutionAnnotations(execution.persona_id);
  const annotation = byExecution.get(execution.id) ?? null;
  const { t } = useTranslation();
  const dryRun = useDryRun({
    personaId: execution.persona_id,
    getInputData: () => execution.input_data ?? undefined,
    useCaseId: execution.use_case_id ?? undefined,
  });

  const hasToolSteps = Array.isArray(execution.tool_steps) && execution.tool_steps.length > 0;
  const hasInputData = hasNonEmptyJson(execution.input_data, 'object');
  const hasOutputData = hasNonEmptyJson(execution.output_data, 'object');
  const directorReviewMd = execution.director_review_md ?? null;

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ExecutionDetailTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          hasToolSteps={hasToolSteps}
          hasDirectorReview={!!directorReviewMd}
          executionStatus={execution.status}
        />
        <div className="flex items-center gap-2">
          <button
            data-testid="dry-run-from-execution-btn"
            onClick={dryRun.run}
            disabled={dryRun.loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-card typo-caption border border-primary/15 bg-secondary/30 text-foreground hover:bg-secondary/50 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={t.agents.executions.dry_run.button_hint}
          >
            <FlaskConical className="w-3 h-3" />
            {dryRun.loading ? t.agents.executions.dry_run.button_running : t.agents.executions.dry_run.button_label}
          </button>
        </div>
      </div>
      <DryRunModal open={dryRun.open} loading={dryRun.loading} report={dryRun.report} errorMessage={dryRun.errorMessage} onClose={dryRun.close} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="min-w-0 space-y-4">
          {/* Tab Content */}
          {activeTab === 'director' && directorReviewMd ? (
            <div className="rounded-modal border border-violet-500/20 bg-violet-500/[0.03] p-5">
              <div className="max-w-3xl mx-auto">
                <MarkdownRenderer content={directorReviewMd} />
              </div>
            </div>
          ) : activeTab === 'replay' ? (
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
        <aside className="bg-secondary/30 border border-primary/15 rounded-modal p-3">
          <AnnotationEditor
            executionId={execution.id}
            personaId={execution.persona_id}
            annotation={annotation}
            knownTags={knownTags}
            onSave={upsert}
            onDelete={remove}
          />
        </aside>
      </div>
    </div>
  );
}
