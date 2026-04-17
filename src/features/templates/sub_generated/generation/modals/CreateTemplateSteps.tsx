import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { TransformProgress } from '@/features/shared/components/progress/TransformProgress';
import { DraftEditStep } from '@/features/shared/components/editors/draft-editor/DraftEditStep';
import type { useCreateTemplateReducer } from '../useCreateTemplateReducer';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { useTranslation } from '@/i18n/useTranslation';

// -- Step 1: Describe --

interface DescribeStepProps {
  templateName: string;
  description: string;
  error: string;
  reducer: ReturnType<typeof useCreateTemplateReducer>;
}

export function DescribeStep({ templateName, description, error, reducer }: DescribeStepProps) {
  const { t } = useTranslation();
  return (
    <div
      key="describe"
      className="animate-fade-in p-6 space-y-6"
    >
      <div className="space-y-1.5">
        <label className="typo-heading font-semibold text-foreground uppercase tracking-wider">
          {t.templates.generation.template_name_label_step}
        </label>
        <input
          type="text"
          value={templateName}
          onChange={(e) => reducer.setTemplateName(e.target.value)}
          placeholder={t.templates.generation.template_name_placeholder}
          className="w-full px-4 py-3 rounded-modal border border-primary/15 bg-background/40 typo-body text-foreground placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:border-violet-500/40 transition-colors"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <label className="typo-heading font-semibold text-foreground uppercase tracking-wider">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => reducer.setDescription(e.target.value)}
          placeholder={'Describe what this persona should do, what services it connects to, and how it should behave. Be specific about tools, triggers, and integrations needed.\n\nExample: A persona that monitors a Gmail inbox for important emails, classifies them by priority, sends Slack notifications for urgent ones, and creates a daily digest summary.'}
          className="w-full h-48 px-4 py-3 rounded-modal border border-primary/15 bg-background/40 typo-body text-foreground placeholder-muted-foreground/30 resize-none focus-visible:outline-none focus-visible:border-violet-500/40 transition-colors"
        />
        <p className="typo-body text-foreground">
          {t.templates.generation.description_hint}
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-modal bg-red-500/10 border border-red-500/20 typo-body text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

// -- Step 2: Generate --

interface GenerateStepProps {
  generateLines: string[];
  generatePhase: CliRunPhase;
  backgroundGenId: string | null;
  onRetry: () => void;
  onCancel: () => void;
}

export function GenerateStep({ generateLines, generatePhase, backgroundGenId, onRetry, onCancel }: GenerateStepProps) {
  return (
    <div
      key="generate"
      className="animate-fade-in p-6"
    >
      <TransformProgress
        lines={generateLines}
        mode="transform"
        phase={generatePhase}
        runId={backgroundGenId}
        onRetry={onRetry}
        onCancel={onCancel}
      />
    </div>
  );
}

// -- Step 3: Review --

interface ReviewStepProps {
  draft: N8nPersonaDraft;
  draftJson: string;
  draftJsonError: string;
  adjustmentRequest: string;
  transforming: boolean;
  saving: boolean;
  saved: boolean;
  updateDraft: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
  reducer: ReturnType<typeof useCreateTemplateReducer>;
  onApplyAdjustment: () => void;
}

export function ReviewStep({
  draft,
  draftJson,
  draftJsonError,
  adjustmentRequest,
  transforming,
  saving,
  saved,
  updateDraft,
  reducer,
  onApplyAdjustment,
}: ReviewStepProps) {
  return (
    <div
      key="review"
      className="animate-fade-in p-6 h-[60vh]"
    >
      <DraftEditStep
        draft={draft}
        draftJson={draftJson}
        draftJsonError={draftJsonError}
        adjustmentRequest={adjustmentRequest}
        transforming={transforming}
        disabled={saving || saved}
        updateDraft={updateDraft}
        onDraftUpdated={(d) => reducer.draftUpdated(d)}
        onJsonEdited={(json, d, error) => reducer.draftJsonEdited(json, d, error)}
        onAdjustmentChange={(text) => reducer.setAdjustment(text)}
        onApplyAdjustment={onApplyAdjustment}
      />
    </div>
  );
}
