import { Workflow, Lightbulb } from 'lucide-react';
import type { AgentIR } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

interface OverviewTabProps {
  designResult: AgentIR | null;
  flows: UseCaseFlow[];
  adjustment: { suggestion: string; reason: string; appliedFixes: string[] } | null;
  review: PersonaDesignReview;
  onViewFlows: () => void;
}

export function OverviewTab({
  designResult,
  flows,
  adjustment,
  review,
  onViewFlows,
}: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      {designResult?.summary && (
        <div className="bg-gradient-to-r from-violet-500/5 to-transparent border border-violet-500/10 rounded-xl px-4 py-3">
          <p className="text-sm text-foreground/90 leading-relaxed">{designResult.summary}</p>
        </div>
      )}

      {/* Use Case Flows */}
      {flows.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">
            Use Case Flows
          </h4>
          <div className="flex items-center gap-3 flex-wrap">
            {flows.map((flow) => (
              <button
                key={flow.id}
                onClick={onViewFlows}
                className="bg-violet-500/5 border border-violet-500/15 rounded-xl px-4 py-3 text-left hover:bg-violet-500/10 hover:border-violet-500/25 transition-all group min-w-[180px]"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Workflow className="w-4 h-4 text-violet-400/70 group-hover:text-violet-400 transition-colors" />
                  <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground/95 truncate">
                    {flow.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground/60">
                  <span>{flow.nodes.length} nodes</span>
                  <span>{flow.edges.length} edges</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Adjustment */}
      {adjustment && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-400/80" />
            <h4 className="text-sm font-medium text-amber-400/80 uppercase">
              Suggested Adjustment
              {review.adjustment_generation != null && review.adjustment_generation > 0 && (
                <span className="ml-1.5 text-muted-foreground/80 normal-case">
                  (attempt {review.adjustment_generation}/3)
                </span>
              )}
            </h4>
          </div>
          <p className="text-sm text-muted-foreground/90">{adjustment.reason}</p>
          <div className="bg-background/50 rounded-xl px-3 py-2 text-sm text-foreground/90 border border-primary/10">
            {adjustment.suggestion}
          </div>
          {adjustment.appliedFixes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {adjustment.appliedFixes.map((fix: string, i: number) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-sm rounded-full bg-amber-500/10 border border-amber-500/15 text-amber-400/70"
                >
                  {fix}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dimension completion */}
      {review.structural_score !== null && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">
            Dimension Completion
          </h4>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-secondary/40 rounded-full overflow-hidden max-w-[200px]">
              <div
                className={`h-full rounded-full transition-all ${
                  review.structural_score >= 80 ? 'bg-emerald-500/70' : review.structural_score >= 60 ? 'bg-amber-500/70' : 'bg-red-500/70'
                }`}
                style={{ width: `${Math.min(review.structural_score, 100)}%` }}
              />
            </div>
            <span className={`text-sm font-mono font-semibold ${
              review.structural_score >= 80 ? 'text-emerald-400' : review.structural_score >= 60 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {review.structural_score}%
            </span>
            <span className="text-sm text-muted-foreground/50">
              ({Math.round(review.structural_score / 100 * 9)}/9 dimensions)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
