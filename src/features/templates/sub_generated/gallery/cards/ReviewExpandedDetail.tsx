import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Lightbulb, RotateCcw, Download, Workflow } from 'lucide-react';
import { PromptTabsPreview } from '@/features/shared/components/editors/PromptTabsPreview';
import { DesignConnectorGrid } from '@/features/shared/components/display/DesignConnectorGrid';

import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { getCachedDesignResult } from './reviewParseCache';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';

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
  const { t, tx } = useTranslation();
  const [showJson, setShowJson] = useState(false);

  const designResult = getCachedDesignResult(review);
  const adjustment = parseJsonOrDefault<{
    suggestion: string;
    reason: string;
    appliedFixes: string[];
  } | null>(review.suggested_adjustment, null);
  const flows = parseJsonOrDefault<UseCaseFlow[]>(review.use_case_flows, []);

  if (!designResult) {
    return (
      <div className="flex items-center justify-center py-8 typo-body text-foreground">
        {t.templates.review_detail.design_unavailable}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Summary Card */}
      {designResult.summary && (
        <div className="border border-role-agent/10 rounded-modal px-4 py-3 bg-surface-1">
          <p className="typo-body text-ink-1">{designResult.summary}</p>
        </div>
      )}

      {/* 2. Prompt Preview */}
      <PromptTabsPreview designResult={designResult} />

      {/* 3. Connector Grid */}
      <DesignConnectorGrid designResult={designResult} />

      {/* 3.5. Use Case Flows Preview */}
      {flows.length > 0 && onViewDiagram && (
        <div>
          <SectionLabel>{t.templates.review_detail.use_case_flows}</SectionLabel>
          <div className="flex items-center gap-3 flex-wrap">
            {flows.map((flow) => (
              <PressSurface
                key={flow.id}
                onPress={onViewDiagram}
                className="bg-surface-1 border border-hair rounded-modal px-4 py-3 group min-w-[180px]"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Workflow className="w-4 h-4 text-role-agent/70 group-hover:text-role-agent transition-colors" />
                  <span className="typo-body text-foreground group-hover:text-ink-1 truncate">
                    {flow.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 typo-body text-foreground">
                  <span>{t.templates.overview_tab.nodes.replace('{count}', String(flow.nodes.length))}</span>
                  <span>{t.templates.overview_tab.edges.replace('{count}', String(flow.edges.length))}</span>
                </div>
                <div className="typo-body text-role-agent/50 mt-1.5 group-hover:text-role-agent/70 transition-colors">
                  {t.templates.review_detail.view_diagram}
                </div>
              </PressSurface>
            ))}
          </div>
        </div>
      )}

      {/* 4. Adjustment Section */}
      {adjustment && (
        <div className="bg-status-warning/5 border border-status-warning/15 rounded-modal px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-status-warning/80" />
              <h4 className="typo-eyebrow text-status-warning/80">
                {t.templates.overview_tab.suggested_adjustment}
                {review.adjustment_generation != null && review.adjustment_generation > 0 && (
                  <span className="ml-1.5 text-foreground normal-case">
                    {tx(t.templates.overview_tab.adjustment_attempt, { attempt: review.adjustment_generation })}
                  </span>
                )}
              </h4>
            </div>
            <Button
              type="button"
              onClick={() => onApplyAdjustment(adjustment.suggestion)}
              disabled={isRunning}
              variant="accent"
              tone="warning"
              size="sm"
              icon={<RotateCcw className="w-3 h-3" />}
            >
              {t.templates.review_detail.apply_rerun}
            </Button>
          </div>
          <p className="typo-body text-foreground">{adjustment.reason}</p>
          <div className="bg-background/50 rounded-modal px-3 py-2 typo-body text-ink-1 border border-hair">
            {adjustment.suggestion}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {adjustment.appliedFixes.map((fix: string, i: number) => (
              <span
                key={i}
                className="typo-body text-status-warning"
              >
                {fix}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 6. References indicator */}
      {review.had_references && (
        <div className="flex items-center gap-1.5 typo-body text-role-agent/50">
          <span className="w-1.5 h-1.5 rounded-full bg-role-agent/40" />
          {t.templates.review_detail.used_references}
        </div>
      )}

      {/* 7. Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-primary/[0.08]">
        {onAdopt ? (
          <Button
            type="button"
            onClick={onAdopt}
            disabled={isAdopting}
            variant="primary"
            size="md"
            icon={<Download className="w-4 h-4" />}
          >
            {t.templates.review_detail.adopt_as_new_persona}
          </Button>
        ) : (
          <div />
        )}
        <Button
          type="button"
          onClick={() => setShowJson(!showJson)}
          variant="ghost"
          size="sm"
        >
          {showJson ? t.templates.review_detail.hide_raw_json : t.templates.review_detail.view_raw_json}
        </Button>
      </div>

      {showJson && (
        <pre className="p-3 bg-background/70 rounded-card border border-hair typo-body text-foreground overflow-x-auto max-h-[300px] overflow-y-auto">
          {JSON.stringify(designResult, null, 2)}
        </pre>
      )}
    </div>
  );
}
