import { Workflow, Lightbulb, AlertTriangle, BarChart3, ThumbsUp, ThumbsDown, DollarSign, Activity, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { AgentIR } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useTemplatePerformance } from '@/hooks/design/template/useTemplatePerformance';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';

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
  const { t } = useTranslation();
  const { performance, loading: perfLoading, error: perfError } = useTemplatePerformance(review.id);

  return (
    <div className="space-y-6">
      {/* Summary */}
      {designResult?.summary && (
        <div className="border border-role-agent/10 rounded-modal px-4 py-3 bg-surface-1">
          <p className="typo-body text-ink-1">{designResult.summary}</p>
        </div>
      )}

      {/* Performance Metrics */}
      {perfLoading && (
        <div className="rounded-modal border border-hair bg-surface-1 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/80 animate-spin" />
            <span className="typo-body text-foreground">{t.templates.overview_tab.loading_metrics}</span>
          </div>
        </div>
      )}
      {!perfLoading && perfError && (
        <div className="rounded-modal border border-status-warning/15 bg-status-warning/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-status-warning/70" />
            <span className="typo-body text-status-warning/80">{t.templates.overview_tab.metrics_unavailable}</span>
          </div>
          <p className="typo-body text-foreground mt-1">{t.templates.overview_tab.metrics_load_error}</p>
        </div>
      )}
      {!perfLoading && !perfError && performance && !performance.data_available && (
        <div className="rounded-modal border border-status-warning/15 bg-status-warning/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-status-warning/70" />
            <span className="typo-body text-status-warning/80">{t.templates.overview_tab.incomplete_data}</span>
          </div>
          <p className="typo-body text-foreground mt-1">
            {t.templates.overview_tab.incomplete_data_hint}
          </p>
        </div>
      )}
      {!perfLoading && !perfError && performance && performance.data_available && (
        <div>
          <h4 className="typo-eyebrow text-foreground mb-2">
            {t.templates.overview_tab.performance}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-modal border border-hair bg-surface-1 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Users className="w-3.5 h-3.5 text-role-agent/70" />
                <span className="typo-body text-foreground">{t.templates.overview_tab.adoptions_label}</span>
              </div>
              <span className="typo-heading-lg text-ink-1 font-mono">{performance.total_adoptions}</span>
            </div>
            <div className="rounded-modal border border-hair bg-surface-1 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity className="w-3.5 h-3.5 text-status-info/70" />
                <span className="typo-body text-foreground">{t.templates.overview_tab.executions_label}</span>
              </div>
              <span className="typo-heading-lg text-ink-1 font-mono">{performance.total_executions}</span>
            </div>
            <div className="rounded-modal border border-hair bg-surface-1 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart3 className="w-3.5 h-3.5 text-status-success/70" />
                <span className="typo-body text-foreground">{t.templates.overview_tab.success_label}</span>
              </div>
              {/* No run yet is "not measured", never 0%: the backend reports a
                  rate of 0 when it has nothing to divide by. */}
              <Numeric
                value={performance.total_executions > 0 ? performance.success_rate : null}
                unit="ratio"
                precision={0}
                className="typo-heading-lg text-ink-1 font-mono"
              />
            </div>
            <div className="rounded-modal border border-hair bg-surface-1 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <DollarSign className="w-3.5 h-3.5 text-status-warning/70" />
                <span className="typo-body text-foreground">{t.templates.overview_tab.avg_cost_label}</span>
              </div>
              <Numeric value={performance.total_executions > 0 ? performance.avg_cost_usd : null} unit="usd" className="typo-heading-lg text-ink-1 font-mono" />
            </div>
          </div>
          {/* Feedback summary */}
          {(performance.positive_count > 0 || performance.negative_count > 0) && (
            <div className="flex items-center gap-4 mt-3">
              {performance.positive_count > 0 && (
                <span className="flex items-center gap-1.5 typo-body text-status-success/80">
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {performance.positive_count}
                </span>
              )}
              {performance.negative_count > 0 && (
                <span className="flex items-center gap-1.5 typo-body text-status-error/80">
                  <ThumbsDown className="w-3.5 h-3.5" />
                  {performance.negative_count}
                </span>
              )}
              {performance.derived_quality_score > 0 && (
                <span className="typo-body text-foreground ml-auto">
                  {t.templates.overview_tab.quality_score}: <span className="font-mono font-semibold text-foreground">{Math.round(performance.derived_quality_score)}</span>/100
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Use Case Flows */}
      {flows.length > 0 && (
        <div>
          <h4 className="typo-eyebrow text-foreground mb-2">
            {t.templates.overview_tab.use_case_flows}
          </h4>
          <div className="flex items-center gap-3 flex-wrap">
            {flows.map((flow) => (
              <PressSurface
                key={flow.id}
                onPress={onViewFlows}
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
              </PressSurface>
            ))}
          </div>
        </div>
      )}

      {/* Adjustment */}
      {adjustment && (
        <div className="bg-status-warning/5 border border-status-warning/15 rounded-modal px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-status-warning/80" />
            <h4 className="typo-eyebrow text-status-warning/80">
              {t.templates.overview_tab.suggested_adjustment}
              {review.adjustment_generation != null && review.adjustment_generation > 0 && (
                <span className="ml-1.5 text-foreground normal-case">
                  {t.templates.overview_tab.adjustment_attempt.replace('{attempt}', String(review.adjustment_generation))}
                </span>
              )}
            </h4>
          </div>
          <p className="typo-body text-foreground">{adjustment.reason}</p>
          <div className="bg-background/50 rounded-modal px-3 py-2 typo-body text-ink-1 border border-hair">
            {adjustment.suggestion}
          </div>
          {adjustment.appliedFixes.length > 0 && (
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
          )}
        </div>
      )}

      {/* Dimension completion */}
      {review.structural_score !== null && (
        <div>
          <h4 className="typo-eyebrow text-foreground mb-2">
            {t.templates.overview_tab.dimension_completion}
          </h4>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden max-w-[200px]">
              <div
                className={`h-full rounded-full transition-all ${
                  review.structural_score >= 80 ? 'bg-status-success/70' : review.structural_score >= 60 ? 'bg-status-warning/70' : 'bg-status-error/70'
                }`}
                style={{ width: `${Math.min(review.structural_score, 100)}%` }}
              />
            </div>
            <span className={`typo-code ${
              review.structural_score >= 80 ? 'text-status-success' : review.structural_score >= 60 ? 'text-status-warning' : 'text-status-error'
            }`}>
              {review.structural_score}%
            </span>
            <span className="typo-body text-foreground">
              {t.templates.overview_tab.dimensions_score.replace('{score}', String(Math.round(review.structural_score / 100 * 9)))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
