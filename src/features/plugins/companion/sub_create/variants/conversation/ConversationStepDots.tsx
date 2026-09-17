import { useTranslation } from '@/i18n/useTranslation';
import { CSS_DURATION_CLASS } from '@/lib/utils/animation/animationPresets';
import type { CreateAthenaStep } from '../../engine/createAthenaTypes';

/**
 * A thin row of step dots: done = filled, current = a wider pill, skipped =
 * hollow, todo = faint. No text labels — the one accessible name is the
 * "Step n of m" aria-label on the row.
 */
export function ConversationStepDots({
  steps,
  stepIndex,
}: {
  steps: CreateAthenaStep[];
  stepIndex: number;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuenow={stepIndex + 1}
      aria-label={tx(c.create_progress, { current: stepIndex + 1, total: steps.length })}
      className="flex items-center justify-center gap-1.5"
      data-testid="create-athena-step-dots"
    >
      {steps.map((step) => (
        <span
          key={step.id}
          data-status={step.status}
          className={`h-1.5 rounded-pill transition-all ${CSS_DURATION_CLASS.smooth} ${dotClass(step.status)}`}
        />
      ))}
    </div>
  );
}

function dotClass(status: CreateAthenaStep['status']): string {
  switch (status) {
    case 'current':
      return 'w-5 bg-primary';
    case 'done':
      return 'w-1.5 bg-primary/70';
    case 'skipped':
      return 'w-1.5 bg-transparent border border-foreground/30';
    case 'todo':
      return 'w-1.5 bg-foreground/15';
  }
}
