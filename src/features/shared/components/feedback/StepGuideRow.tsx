import type { LucideIcon } from 'lucide-react';

/**
 * @catalog StepGuideRow — the numbered Create → Credential → Run path under a first-run empty state; steps become buttons when the caller supplies handlers. Rendered for you by `ScenarioEmptyState`.
 */
export interface StepGuide {
  icon: LucideIcon;
  label: string;
  color: string;
}

interface StepGuideRowProps {
  steps: StepGuide[];
  /**
   * Handler per step, positionally aligned with `steps`. A step with a handler
   * renders as a real button in the tab order (its translated label is its
   * accessible name); a step without one stays the caption it always was.
   */
  stepActions?: (undefined | (() => void))[];
}

/**
 * The Create -> Credential -> Run path drawn under a first-run empty state.
 * Extracted from `ScenarioEmptyState` so the next-action wiring does not push
 * that file further past the size limit.
 */
export function StepGuideRow({ steps, stepActions }: StepGuideRowProps) {
  return (
    <div className="flex items-center gap-3 mt-2">
      {steps.map((step, i) => {
        const StepIcon = step.icon;
        const onClick = stepActions?.[i];
        const inner = (
          <>
            <div className={`w-6 h-6 rounded-lg border flex items-center justify-center ${step.color}`}>
              <StepIcon className="w-3 h-3" />
            </div>
            <span className="typo-body text-foreground">{step.label}</span>
          </>
        );
        return (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && <div className="w-4 h-px bg-muted-foreground/20" />}
            {onClick ? (
              <button
                type="button"
                onClick={onClick}
                className="flex items-center gap-1.5 rounded-interactive px-1 py-0.5 -mx-1 hover:bg-secondary/40 transition-colors cursor-pointer focus-ring"
              >
                {inner}
              </button>
            ) : (
              <div className="flex items-center gap-1.5">{inner}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
