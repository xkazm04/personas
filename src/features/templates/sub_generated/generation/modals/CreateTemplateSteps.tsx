import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { TransformProgress } from '@/features/shared/components/progress/TransformProgress';
import { DraftEditStep } from '@/features/templates/draft-editor/DraftEditStep';
import type { DraftRequirementId } from '@/features/templates/draft-editor/draftCompleteness';
import type { useCreateTemplateReducer } from '../useCreateTemplateReducer';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

// -- Step 1: Describe --

interface DescribeStepProps {
  templateName: string;
  description: string;
  error: string;
  reducer: ReturnType<typeof useCreateTemplateReducer>;
}

function ExampleChips({ reducer }: { reducer: DescribeStepProps['reducer'] }) {
  const { t } = useTranslation();
  const g = t.templates.generation;
  const examples = [
    { slug: 'inbox_triage', name: g.example_inbox_triage_name, description: g.example_inbox_triage_description },
    { slug: 'daily_digest', name: g.example_daily_digest_name, description: g.example_daily_digest_description },
    { slug: 'incident_to_slack', name: g.example_incident_to_slack_name, description: g.example_incident_to_slack_description },
  ];
  return (
    <div className="space-y-2">
      <p className="typo-caption text-foreground uppercase tracking-wider">{g.examples_label}</p>
      <div className="flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex.slug}
            type="button"
            onClick={() => {
              reducer.setTemplateName(ex.name);
              reducer.setDescription(ex.description);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-modal border border-primary/15 bg-background/40 typo-body text-foreground hover:bg-secondary/50 hover:border-violet-500/30 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" />
            {ex.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// A generative step should not open on a blank form whose only worked example
// is buried at the end of a placeholder. Each chip fills BOTH required fields,
// so Generate goes from disabled to enabled in one click and stays editable.
export function DescribeStep({ templateName, description, error, reducer }: DescribeStepProps) {
  const { t } = useTranslation();
  return (
    <div
      key="describe"
      className="animate-fade-in p-6 space-y-6"
    >
      <div className="space-y-1.5">
        <label className="typo-heading text-foreground uppercase">
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
        <label className="typo-heading text-foreground uppercase">
          {t.templates.generation.description_label}
        </label>
        <textarea
          value={description}
          onChange={(e) => reducer.setDescription(e.target.value)}
          placeholder={t.templates.generation.description_placeholder}
          className="w-full h-48 px-4 py-3 rounded-modal border border-primary/15 bg-background/40 typo-body text-foreground placeholder-muted-foreground/30 resize-none focus-visible:outline-none focus-visible:border-violet-500/40 transition-colors"
        />
        <p className="typo-body text-foreground">
          {t.templates.generation.description_hint}
        </p>
      </div>

      <ExampleChips reducer={reducer} />

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
  onCompletenessChange?: (missing: DraftRequirementId[]) => void;
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
  onCompletenessChange,
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
        onCompletenessChange={onCompletenessChange}
      />
    </div>
  );
}
