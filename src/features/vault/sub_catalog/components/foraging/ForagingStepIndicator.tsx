import type { ForagingPhase } from "@/hooks/design/credential/useCredentialForaging";

const STEPS: { key: ForagingPhase; label: string }[] = [
  { key: "idle", label: "Start" },
  { key: "scanning", label: "Scan" },
  { key: "results", label: "Results" },
  { key: "importing", label: "Import" },
  { key: "done", label: "Done" },
];

const STEP_INDEX: Record<string, number> = {
  idle: 0,
  scanning: 1,
  results: 2,
  importing: 3,
  done: 4,
  error: 1, // error maps back to scanning step
};

interface ForagingStepIndicatorProps {
  phase: ForagingPhase;
}

export function ForagingStepIndicator({ phase }: ForagingStepIndicatorProps) {
  const currentIndex = STEP_INDEX[phase] ?? 0;

  return (
    <div className="flex items-center justify-center gap-0 py-1" role="group" aria-label="Foraging progress">
      {STEPS.map((step, i) => {
        const isCompleted = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <div key={step.key} className="flex items-center">
            {/* Dot */}
            <div
              className={[
                "w-2 h-2 rounded-full transition-colors duration-300",
                isCompleted && "bg-emerald-400",
                isCurrent && "bg-violet-400 animate-pulse",
                !isCompleted && !isCurrent && "bg-muted-foreground/20",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={`${step.label}${isCompleted ? " (completed)" : isCurrent ? " (current)" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            />
            {/* Connector line (except after last dot) */}
            {i < STEPS.length - 1 && (
              <div
                className={[
                  "w-6 h-px transition-colors duration-300",
                  i < currentIndex ? "bg-emerald-400/50" : "bg-muted-foreground/15",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
