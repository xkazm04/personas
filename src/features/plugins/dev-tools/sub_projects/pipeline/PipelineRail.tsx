/**
 * PipelineRail — presentational horizontal stepper rail.
 *
 * Renders a row of stage nodes connected by rails. The PARENT renders the
 * active stage's content below the rail (edit mode) or per-stage summaries
 * (view mode) — this component only draws the rail. Reused by both the project
 * onboarding modal (`mode="edit"`, clickable) and the Overview pipeline strip
 * (`mode="view"`, static).
 */
import { Check } from 'lucide-react';
import type { PipelineStage } from './pipelineTypes';

interface PipelineRailProps {
  stages: PipelineStage[];
  activeIndex: number;
  /** When provided, nodes are clickable (edit mode). Omit for a static view. */
  onSelect?: (index: number) => void;
  size?: 'md' | 'sm';
}

export function PipelineRail({ stages, activeIndex, onSelect, size = 'md' }: PipelineRailProps) {
  const interactive = !!onSelect;
  const nodeSize = size === 'sm' ? 'w-6 h-6' : 'w-9 h-9';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  return (
    <div className="flex items-stretch" data-testid="project-pipeline-rail">
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        const isActive = i === activeIndex;
        const isComplete = stage.status === 'complete';
        const nodeTone = isComplete
          ? 'bg-emerald-500/20 border-emerald-500/45 text-emerald-300'
          : isActive
            ? 'bg-amber-500/20 border-amber-500/55 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.18)]'
            : 'bg-secondary/40 border-primary/15 text-foreground/45';
        const labelTone = isActive
          ? 'text-foreground font-medium'
          : isComplete
            ? 'text-foreground/75'
            : 'text-foreground/45';

        return (
          <div key={stage.id} className="flex-1 flex flex-col items-center min-w-0">
            <div className="flex items-center w-full">
              {/* left rail (hidden on first node) */}
              <span
                className={`h-0.5 flex-1 rounded-full ${
                  i === 0 ? 'opacity-0' : i <= activeIndex || isComplete ? 'bg-emerald-500/40' : 'bg-primary/12'
                }`}
              />
              <button
                type="button"
                disabled={!interactive}
                onClick={interactive ? () => onSelect?.(i) : undefined}
                aria-current={isActive ? 'step' : undefined}
                className={`relative flex items-center justify-center rounded-full border transition-all ${nodeSize} ${nodeTone} ${
                  interactive ? 'cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40' : 'cursor-default'
                }`}
                data-testid={`pipeline-node-${i}`}
              >
                {isComplete ? <Check className={iconSize} /> : <Icon className={iconSize} />}
              </button>
              {/* right rail (hidden on last node) — fills once this stage is
                  done, so the view-mode strip (no active node) still reads as
                  a connected, completed pipeline. */}
              <span
                className={`h-0.5 flex-1 rounded-full ${
                  i === stages.length - 1 ? 'opacity-0' : i < activeIndex || isComplete ? 'bg-emerald-500/40' : 'bg-primary/12'
                }`}
              />
            </div>
            <span className={`mt-2 typo-caption text-center truncate max-w-full px-1 ${labelTone}`}>
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
