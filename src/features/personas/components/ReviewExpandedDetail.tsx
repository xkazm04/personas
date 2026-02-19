import { useState } from 'react';
import { Lightbulb, RotateCcw } from 'lucide-react';
import { TemplatePromptPreview } from './TemplatePromptPreview';
import { TemplateConnectorGrid } from './TemplateConnectorGrid';
import { TemplateQualitySection } from './TemplateQualitySection';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

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
}: {
  review: PersonaDesignReview;
  isRunning: boolean;
  onApplyAdjustment: (adjustedInstruction: string) => void;
}) {
  const [showJson, setShowJson] = useState(false);

  const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
  const adjustment = parseJsonSafe<{
    suggestion: string;
    reason: string;
    appliedFixes: string[];
  } | null>(review.suggested_adjustment, null);

  if (!designResult) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground/40">
        Design data unavailable for this template.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1. Summary Card */}
      {designResult.summary && (
        <div className="bg-gradient-to-r from-violet-500/5 to-transparent border border-violet-500/10 rounded-xl px-4 py-3">
          <p className="text-sm text-foreground/70 leading-relaxed">{designResult.summary}</p>
        </div>
      )}

      {/* 2. Prompt Preview */}
      <TemplatePromptPreview designResult={designResult} />

      {/* 3. Connector Grid */}
      <TemplateConnectorGrid designResult={designResult} />

      {/* 4. Quality Section */}
      <TemplateQualitySection review={review} />

      {/* 5. Adjustment Section */}
      {adjustment && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-400/80" />
              <h4 className="text-xs font-medium text-amber-400/80 uppercase">
                Suggested Adjustment
                {review.adjustment_generation != null && review.adjustment_generation > 0 && (
                  <span className="ml-1.5 text-muted-foreground/40 normal-case">
                    (attempt {review.adjustment_generation}/3)
                  </span>
                )}
              </h4>
            </div>
            <button
              onClick={() => onApplyAdjustment(adjustment.suggestion)}
              disabled={isRunning}
              className="px-3 py-1.5 text-xs rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3 h-3" />
              Apply &amp; Re-run
            </button>
          </div>
          <p className="text-xs text-muted-foreground/50">{adjustment.reason}</p>
          <div className="bg-background/50 rounded-md px-3 py-2 text-sm text-foreground/70 border border-primary/10">
            {adjustment.suggestion}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {adjustment.appliedFixes.map((fix: string, i: number) => (
              <span
                key={i}
                className="px-2 py-0.5 text-[10px] rounded-full bg-amber-500/10 border border-amber-500/15 text-amber-400/70"
              >
                {fix}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 6. References indicator */}
      {review.had_references && (
        <div className="flex items-center gap-1.5 text-xs text-violet-400/50">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/40" />
          This template used reference patterns from prior passing reviews
        </div>
      )}

      {/* 7. Footer */}
      <div className="flex items-center justify-end pt-2 border-t border-primary/[0.08]">
        <button
          onClick={() => setShowJson(!showJson)}
          className="text-xs text-violet-400/60 hover:text-violet-400/80 transition-colors"
        >
          {showJson ? 'Hide' : 'View'} Raw JSON
        </button>
      </div>

      {showJson && (
        <pre className="p-3 bg-background/70 rounded-lg border border-primary/10 text-xs text-muted-foreground/50 overflow-x-auto max-h-[300px] overflow-y-auto">
          {JSON.stringify(designResult, null, 2)}
        </pre>
      )}
    </div>
  );
}
