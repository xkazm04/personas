import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';

import { ExtractStep, OutputStep, PreviewStep, ScheduleStep, SourceStep, STEPS, stepComplete } from './EditorSteps';
import type { EditorVariantProps } from './useScrapeForm';

/**
 * The scrape editor — a guided assembly line. One pipeline step at a time with a
 * progress rail down the left; you can't lose your place, and each step is fully
 * focused. The Preview step dry-runs the rules against the live page so pumper
 * can be validated in isolation before anything is saved.
 */
const STEP_BODY = {
  source: SourceStep,
  extract: ExtractStep,
  preview: PreviewStep,
  output: OutputStep,
  schedule: ScheduleStep,
} as const;

export function ScrapeEditorWizard({ form, isEdit, saving, onCancel, onSave }: EditorVariantProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const Body = STEP_BODY[current.id];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="flex max-h-[80vh] min-h-[520px]">
      {/* progress rail */}
      <div className="w-52 shrink-0 border-r border-primary/10 bg-secondary/20 p-4">
        <h2 className="typo-label text-muted-foreground mb-4">{isEdit ? 'Edit scrape' : 'New scrape'}</h2>
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const done = stepComplete(form, s.id);
            const active = i === step;
            return (
              <li key={s.id}>
                <button
                  onClick={() => setStep(i)}
                  className={`flex w-full items-center gap-2.5 rounded-interactive px-2.5 py-2 text-left transition-colors ${
                    active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-secondary/40'
                  }`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                      done ? 'bg-status-success/15 text-status-success' : active ? 'bg-primary/20 text-foreground' : 'bg-secondary/60'
                    }`}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="typo-caption">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* step body */}
      <div className="flex flex-1 flex-col">
        <div className="border-b border-primary/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <current.icon className="size-4 text-status-info" />
            <span className="text-foreground">{current.label}</span>
          </div>
          <p className="typo-caption text-muted-foreground mt-0.5">{current.hint}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Body form={form} />
        </div>

        <div className="flex items-center justify-between border-t border-primary/10 px-6 py-4">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            {isLast ? (
              <AsyncButton variant="primary" isLoading={saving} disabled={!form.canSave} onClick={onSave}>
                {isEdit ? 'Save changes' : 'Create scrape'}
              </AsyncButton>
            ) : (
              <Button variant="primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                Next <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
