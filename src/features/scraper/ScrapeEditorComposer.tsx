import { Check } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';

import { ExtractStep, OutputStep, ScheduleStep, SourceStep, STEPS, stepComplete } from './EditorSteps';
import type { EditorVariantProps } from './useScrapeForm';

/**
 * Editor variant A — "Composer". Mental model: the whole pipeline on one
 * canvas. Four numbered step-sections stacked top-to-bottom (Source → Extract →
 * Output → Schedule), each with a completion tick, everything visible + editable
 * at once. Best for "see the whole recipe and tweak anywhere".
 */
const STEP_BODY = {
  source: SourceStep,
  extract: ExtractStep,
  output: OutputStep,
  schedule: ScheduleStep,
} as const;

export function ScrapeEditorComposer({ form, isEdit, saving, onCancel, onSave }: EditorVariantProps) {
  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="border-b border-primary/10 px-6 py-4">
        <h2 className="typo-section-title text-foreground">{isEdit ? 'Edit scrape' : 'New scrape'}</h2>
        <p className="typo-caption text-muted-foreground mt-0.5">Compose the pipeline top to bottom.</p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {STEPS.map((step, i) => {
          const Body = STEP_BODY[step.id];
          const done = stepComplete(form, step.id);
          return (
            <section key={step.id} className="rounded-card border border-primary/10 bg-secondary/15 p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-xs ${
                    done ? 'bg-status-success/15 text-status-success' : 'bg-secondary/60 text-muted-foreground'
                  }`}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <step.icon className="size-4 text-muted-foreground" />
                <span className="text-foreground">{step.label}</span>
                <span className="typo-caption text-muted-foreground">· {step.hint}</span>
              </div>
              <Body form={form} />
            </section>
          );
        })}
      </div>

      <EditorFooter form={form} saving={saving} isEdit={isEdit} onCancel={onCancel} onSave={onSave} />
    </div>
  );
}

/** Shared footer (used by every variant): validity summary + cancel/save. */
export function EditorFooter({ form, saving, isEdit, onCancel, onSave }: EditorVariantProps) {
  return (
    <div className="flex items-center justify-between border-t border-primary/10 px-6 py-4">
      <span className="typo-caption text-muted-foreground">
        {form.canSave
          ? `${form.namedFieldCount} field${form.namedFieldCount === 1 ? '' : 's'} → ${form.dataset || 'dataset'}`
          : 'Add a name, at least one URL, a field, and a dataset.'}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <AsyncButton variant="primary" isLoading={saving} disabled={!form.canSave} onClick={onSave}>
          {isEdit ? 'Save changes' : 'Create scrape'}
        </AsyncButton>
      </div>
    </div>
  );
}
