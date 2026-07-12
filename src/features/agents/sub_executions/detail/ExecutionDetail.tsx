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
import { ChainTraceView } from './chain/ChainTraceView';
import { useChainTrace } from '../libs/useChainTrace';
import { getExecution } from '@/api/agents/executions';
import { silentCatch } from '@/lib/silentCatch';
import { BaseModal } from '@/lib/ui/BaseModal';
import { X } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { AnnotationEditor } from '../components/AnnotationEditor';
import { useExecutionAnnotations } from '@/hooks/agents/useExecutionAnnotations';
import { useDryRun } from '../libs/useDryRun';
import { DryRunModal } from '../components/runner/DryRunModal';
import { useTranslation } from '@/i18n/useTranslation';

interface ExecutionDetailProps {
  execution: PersonaExecution;
  /** Rendered inside another ExecutionDetail's chain drill-down modal — hides
   *  the chain tab so drilling can't recurse indefinitely. */
  nested?: boolean;
}

export function ExecutionDetail({ execution, nested = false }: ExecutionDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('detail');
  const [chainOpen, setChainOpen] = useState<PersonaExecution | null>(null);
  const { byExecution, knownTags, upsert, remove } = useExecutionAnnotations(execution.persona_id);
  const annotation = byExecution.get(execution.id) ?? null;
  const { t } = useTranslation();
  const chain = useChainTrace(execution.id, execution.persona_id, nested);

  const openChainExecution = (executionId: string) => {
    getExecution(executionId, execution.persona_id)
      .then(setChainOpen)
      .catch(silentCatch('execution-detail:openChainExecution'));
  };
  const dryRun = useDryRun({
    personaId: execution.persona_id,
    getInputData: () => execution.input_data ?? undefined,
    useCaseId: execution.use_case_id ?? undefined,
  });

  const hasToolSteps = Array.isArray(execution.tool_steps) && execution.tool_steps.length > 0;
  const hasInputData = hasNonEmptyJson(execution.input_data, 'object');
  const hasOutputData = hasNonEmptyJson(execution.output_data, 'object');
  const directorReviewMd = execution.director_review_md ?? null;
  // Pipeline waterfall builds from the run's timeline (synthetic trace) or a
  // live trace — both require the run to have started. Gate the tab so it never
  // dead-ends on a never-started (queued) run.
  const hasPipeline = !!execution.started_at;

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ExecutionDetailTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          hasToolSteps={hasToolSteps}
          hasDirectorReview={!!directorReviewMd}
          hasPipeline={hasPipeline}
          hasChain={chain.hasChain}
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
          ) : activeTab === 'chain' ? (
            <ChainTraceView
              traces={chain.traces}
              loading={chain.loading}
              error={chain.error}
              partial={chain.partial}
              currentExecutionId={execution.id}
              onOpenExecution={openChainExecution}
            />
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

      {chainOpen && (
        <BaseModal
          isOpen={!!chainOpen}
          onClose={() => setChainOpen(null)}
          titleId="chain-execution-detail-title"
          size="xl"
          portal
          panelClassName="bg-background border border-primary/15 rounded-modal shadow-elevation-4 overflow-hidden"
        >
          <div className="flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-primary/10">
              <h3 id="chain-execution-detail-title" className="typo-heading text-foreground/90 truncate">
                {t.agents.executions.chain_open} #{chainOpen.id.slice(0, 8)}
              </h3>
              <button
                onClick={() => setChainOpen(null)}
                aria-label={t.common.close}
                className="p-1.5 rounded-card text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              <ExecutionDetail execution={chainOpen} nested />
            </div>
          </div>
        </BaseModal>
      )}
    </div>
  );
}
