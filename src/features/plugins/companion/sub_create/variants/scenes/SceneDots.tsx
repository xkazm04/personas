import { CSS_DURATION_CLASS } from '@/lib/utils/animation/animationPresets';
import type { CreateAthenaStep, CreateAthenaStepStatus } from '../../engine/createAthenaTypes';

const DOT_CLASS: Record<CreateAthenaStepStatus, string> = {
  done: 'w-2 bg-primary',
  current: 'w-6 bg-primary',
  skipped: 'w-2 border border-primary/50 bg-transparent',
  todo: 'w-2 bg-foreground/20',
};

/**
 * The sequence marker: one dot per step. Done filled, current an elongated
 * pill, skipped hollow, todo faint. The group carries the "Step n of m"
 * label; the dots themselves are decorative.
 */
export function SceneDots({ steps, label }: { steps: CreateAthenaStep[]; label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center justify-center gap-1.5"
      data-testid="create-athena-dots"
    >
      {steps.map((step) => (
        <span
          key={step.id}
          aria-hidden="true"
          data-status={step.status}
          className={`h-2 rounded-pill transition-all ${CSS_DURATION_CLASS.smooth} ${DOT_CLASS[step.status]}`}
        />
      ))}
    </div>
  );
}
