import { useState } from 'react';
import { Lightbulb, RotateCcw, Download, Workflow } from 'lucide-react';
import { TemplatePromptPreview } from '@/features/templates/sub_builtin/TemplatePromptPreview';
import { TemplateConnectorGrid } from '@/features/templates/sub_builtin/TemplateConnectorGrid';
import { TemplateQualitySection } from '@/features/templates/sub_builtin/TemplateQualitySection';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function ReviewExpandedDetail({
  review,
  isRunning,
  onApplyAdjustment,
  onAdopt,
  isAdopting,
  onViewDiagram,
}: {
  review: PersonaDesignReview;
  isRunning: boolean;
  onApplyAdjustment: (adjustedInstruction: string) => void;
  onAdopt?: () => void;
  isAdopting?: boolean;
  onViewDiagram?: () => void;
}) {
  const [showJson, setShowJson] = useState(false);

  const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
  const adjustment = parseJsonSafe<{
    suggestion: string;
    reason: string;
    appliedFixes: string[];
  } | null>(review.suggested_adjustment, null);
  const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);

  if (!designResult) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground/80">
        Design data unavailable for this template.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1. Summary Card */}
      {designResult.summary && (
        <div className="bg-gradient-to-r from-violet-500/5 to-transparent border border-violet-500/10 rounded-xl px-4 py-3">
          <p className="text-sm text-foreground/90 leading-relaxed">{designResult.summary}</p>
        </div>
      )}

      {/* 2. Prompt Preview */}
      <TemplatePromptPreview designResult={designResult} />

      {/* 3. Connector Grid */}
      <TemplateConnectorGrid designResult={designResult} />

      {/* 3.5. Use Case Flows Preview */}
      {flows.length > 0 && onViewDiagram && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground/90 uppercase tracking-wide mb-2">
            Use Case Flows
          </h4>
          <div className="flex items-center gap-3 flex-wrap">
            {flows.map((flow) => (
              <button
                key={flow.id}
                onClick={onViewDiagram}
                className="bg-violet-500/5 border border-violet-500/15 rounded-xl px-4 py-3 text-left hover:bg-violet-500/10 hover:border-violet-500/25 transition-all group min-w-[180px]"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Workflow className="w-4 h-4 text-violet-400/70 group-hover:text-violet-400 transition-colors" />
                  <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground/95 truncate">
                    {flow.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground/80">
                  <span>{flow.nodes.length} nodes</span>
                  <span>{flow.edges.length} edges</span>
                </div>
                <div className="text-sm text-violet-400/50 mt-1.5 group-hover:text-violet-400/70 transition-colors">
                  View diagram
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 4. Quality Section */}
      <TemplateQualitySection review={review} />

      {/* 5. Adjustment Section */}
      {adjustment && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
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
            <button
              onClick={() => onApplyAdjustment(adjustment.suggestion)}
              disabled={isRunning}
              className="px-3 py-1.5 text-sm rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3 h-3" />
              Apply &amp; Re-run
            </button>
          </div>
          <p className="text-sm text-muted-foreground/90">{adjustment.reason}</p>
          <div className="bg-background/50 rounded-md px-3 py-2 text-sm text-foreground/90 border border-primary/10">
            {adjustment.suggestion}
          </div>
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
        </div>
      )}

      {/* 6. References indicator */}
      {review.had_references && (
        <div className="flex items-center gap-1.5 text-sm text-violet-400/50">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/40" />
          This template used reference patterns from prior passing reviews
        </div>
      )}

      {/* 7. Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-primary/[0.08]">
        {onAdopt ? (
          <button
            onClick={onAdopt}
            disabled={isAdopting}
            className="px-4 py-2.5 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Adopt as New Persona
          </button>
        ) : (
          <div />
        )}
        <button
          onClick={() => setShowJson(!showJson)}
          className="text-sm text-violet-400/60 hover:text-violet-400/80 transition-colors"
        >
          {showJson ? 'Hide' : 'View'} Raw JSON
        </button>
      </div>

      {showJson && (
        <pre className="p-3 bg-background/70 rounded-lg border border-primary/10 text-sm text-muted-foreground/90 overflow-x-auto max-h-[300px] overflow-y-auto">
          {JSON.stringify(designResult, null, 2)}
        </pre>
      )}
    </div>
  );
}
