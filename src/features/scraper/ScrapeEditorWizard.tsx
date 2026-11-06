import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';

import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const Body = STEP_BODY[current.id];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="flex max-h-[80vh] min-h-[520px]">
      {/* progress rail */}
      <div className="w-52 shrink-0 border-r border-hair bg-surface-1 p-4">
        <h2 className="typo-label text-ink-3 mb-4">{isEdit ? 'Edit scrape' : 'New scrape'}</h2>
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const done = stepComplete(form, s.id);
            const active = i === step;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className={`flex w-full items-center gap-2.5 rounded-interactive px-2.5 py-2 text-left transition-colors ${
                    active ? 'bg-surface-1 text-ink-1' : 'text-ink-3 hover:bg-surface-2'
                  }`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full typo-caption ${
                      done ? 'bg-status-success/15 text-status-success' : active ? 'bg-primary/20 text-ink-1' : 'bg-surface-2'
                    }`}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="typo-caption">{t.plugins.scraper.step_labels[s.id]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* step body */}
      <div className="flex flex-1 flex-col">
        <div className="border-b border-hair px-6 py-4">
          <div className="flex items-center gap-2">
            <current.icon className="size-4 text-status-info" />
            <span className="text-ink-1">{t.plugins.scraper.step_labels[current.id]}</span>
          </div>
          <p className="typo-caption text-ink-3 mt-0.5">{t.plugins.scraper.step_hints[current.id]}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Body form={form} />
        </div>

        <div className="flex items-center justify-between border-t border-hair px-6 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            {/* An armed scrape needs a dry-run that produced a record. Say so
                here rather than leaving Save inexplicably grey. */}
            {isLast && form.saveBlockedReason === 'preview' && (
              <span
                data-testid="scrape-save-blocked"
                className="truncate typo-caption text-status-warning"
              >
                {t.plugins.scraper.save_needs_preview}
              </span>
            )}
          </div>
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
