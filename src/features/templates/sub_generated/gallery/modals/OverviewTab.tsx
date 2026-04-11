import { Workflow, Lightbulb, AlertTriangle, BarChart3, ThumbsUp, ThumbsDown, DollarSign, Activity, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { AgentIR } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useTemplatePerformance } from '@/hooks/design/template/useTemplatePerformance';

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
        <div className="bg-gradient-to-r from-violet-500/5 to-transparent border border-violet-500/10 rounded-xl px-4 py-3">
          <p className="text-sm text-foreground/90 leading-relaxed">{designResult.summary}</p>
        </div>
      )}

      {/* Performance Metrics */}
      {perfLoading && (
        <div className="rounded-xl border border-primary/10 bg-secondary/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/80 animate-spin" />
            <span className="text-sm text-muted-foreground/60">{t.templates.overview_tab.loading_metrics}</span>
          </div>
        </div>
      )}
      {!perfLoading && perfError && (
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400/70" />
            <span className="text-sm text-amber-400/80">{t.templates.overview_tab.metrics_unavailable}</span>
          </div>
          <p className="text-sm text-muted-foreground/60 mt-1">{t.templates.overview_tab.metrics_load_error}</p>
        </div>
      )}
      {!perfLoading && !perfError && performance && !performance.data_available && (
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400/70" />
            <span className="text-sm text-amber-400/80">{t.templates.overview_tab.incomplete_data}</span>
          </div>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {t.templates.overview_tab.incomplete_data_hint}
          </p>
        </div>
      )}
      {!perfLoading && !perfError && performance && performance.data_available && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">
            {t.templates.overview_tab.performance}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-primary/10 bg-secondary/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Users className="w-3.5 h-3.5 text-violet-400/70" />
                <span className="text-sm text-muted-foreground/60">{t.templates.overview_tab.adoptions_label}</span>
              </div>
              <span className="text-lg font-semibold text-foreground/90 font-mono">{performance.total_adoptions}</span>
            </div>
            <div className="rounded-xl border border-primary/10 bg-secondary/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity className="w-3.5 h-3.5 text-blue-400/70" />
                <span className="text-sm text-muted-foreground/60">{t.templates.overview_tab.executions_label}</span>
              </div>
              <span className="text-lg font-semibold text-foreground/90 font-mono">{performance.total_executions}</span>
            </div>
            <div className="rounded-xl border border-primary/10 bg-secondary/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart3 className="w-3.5 h-3.5 text-emerald-400/70" />
                <span className="text-sm text-muted-foreground/60">{t.templates.overview_tab.success_label}</span>
              </div>
              <span className="text-lg font-semibold text-foreground/90 font-mono">{Math.round(performance.success_rate * 100)}%</span>
            </div>
            <div className="rounded-xl border border-primary/10 bg-secondary/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <DollarSign className="w-3.5 h-3.5 text-amber-400/70" />
                <span className="text-sm text-muted-foreground/60">{t.templates.overview_tab.avg_cost_label}</span>
              </div>
              <span className="text-lg font-semibold text-foreground/90 font-mono">${performance.avg_cost_usd.toFixed(3)}</span>
            </div>
          </div>
          {/* Feedback summary */}
          {(performance.positive_count > 0 || performance.negative_count > 0) && (
            <div className="flex items-center gap-4 mt-3">
              {performance.positive_count > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-400/80">
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {performance.positive_count}
                </span>
              )}
              {performance.negative_count > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-red-400/80">
                  <ThumbsDown className="w-3.5 h-3.5" />
                  {performance.negative_count}
                </span>
              )}
              {performance.derived_quality_score > 0 && (
                <span className="text-sm text-muted-foreground/50 ml-auto">
                  {t.templates.overview_tab.quality_score}: <span className="font-mono font-semibold text-foreground/70">{Math.round(performance.derived_quality_score)}</span>/100
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Use Case Flows */}
      {flows.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">
            {t.templates.overview_tab.use_case_flows}
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
                  <span>{t.templates.overview_tab.nodes.replace('{count}', String(flow.nodes.length))}</span>
                  <span>{t.templates.overview_tab.edges.replace('{count}', String(flow.edges.length))}</span>
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
              {t.templates.overview_tab.suggested_adjustment}
              {review.adjustment_generation != null && review.adjustment_generation > 0 && (
                <span className="ml-1.5 text-muted-foreground/80 normal-case">
                  {t.templates.overview_tab.adjustment_attempt.replace('{attempt}', String(review.adjustment_generation))}
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
            {t.templates.overview_tab.dimension_completion}
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
              {t.templates.overview_tab.dimensions_score.replace('{score}', String(Math.round(review.structural_score / 100 * 9)))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
