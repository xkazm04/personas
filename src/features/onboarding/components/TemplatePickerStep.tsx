import {
  FlaskConical,
  Check,
  AlertCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR } from '@/lib/types/designTypes';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import { DimensionRadial } from '@/features/templates/sub_generated/shared/DimensionRadial';
import { useTranslation } from '@/i18n/useTranslation';
import { useMemo } from 'react';
import {
  approvedAppDisplayLabel,
  rankTemplatesByApprovedApps,
} from './templateRecommendation';
import type { TemplateLoadState } from './useOnboardingState';

export function TemplatePickerStep({
  templates,
  loadState,
  selectedId,
  approvedApps,
  onSelect,
  onRetry,
}: {
  templates: PersonaDesignReview[];
  loadState: TemplateLoadState;
  selectedId: string | null;
  approvedApps: Set<string>;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  const { t, tx } = useTranslation();

  const ranked = useMemo(
    () => rankTemplatesByApprovedApps(templates, approvedApps),
    [templates, approvedApps],
  );
  const matchedCount = useMemo(
    () => ranked.filter((r) => r.score > 0).length,
    [ranked],
  );
  const approvedLabels = useMemo(() => {
    return [...approvedApps].map(approvedAppDisplayLabel);
  }, [approvedApps]);

  if (loadState.phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="xl" className="text-violet-400" />
        <span className="ml-3 typo-body text-foreground">{t.onboarding.loading_templates}</span>
      </div>
    );
  }

  if (loadState.phase === 'error') {
    return (
      <div className="text-center py-16">
        <AlertCircle className="w-10 h-10 mx-auto text-amber-400 mb-3" />
        <p className="typo-body text-foreground">{t.onboarding.templates_load_error}</p>
        {loadState.error && (
          <p className="typo-body text-foreground mt-1">{loadState.error}</p>
        )}
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 typo-heading rounded-card bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t.onboarding.retry}
        </button>
      </div>
    );
  }

  if (loadState.phase === 'empty' || templates.length === 0) {
    return (
      <div className="text-center py-16">
        <FlaskConical className="w-10 h-10 mx-auto text-foreground mb-3" />
        <p className="typo-body text-foreground">{t.onboarding.no_templates}</p>
        <p className="typo-body text-foreground mt-1">{t.onboarding.no_templates_hint}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 typo-heading rounded-card border border-primary/15 text-foreground hover:bg-secondary/50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t.onboarding.retry}
        </button>
      </div>
    );
  }

  const showRecommendationStrip = matchedCount > 0 && approvedLabels.length > 0;
  const appsJoined = approvedLabels.join(', ');

  return (
    <div className="space-y-4">
      <div>
        <h3 className="typo-heading-lg text-foreground/90 mb-1">{t.onboarding.pick_template_heading}</h3>
        <p className="typo-body text-foreground">{t.onboarding.pick_template_description}</p>
      </div>
      {showRecommendationStrip && (
        <div
          data-testid="recommendation-strip"
          className="flex items-center gap-2 rounded-card bg-violet-500/10 border border-violet-500/25 px-3 py-2"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
          <p className="typo-body text-violet-200">
            {tx(t.onboarding.because_you_connected, { apps: appsJoined })}
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3">
        {ranked.map(({ review, score, matchedApps }) => {
          const designResult = parseJsonSafe<AgentIR | null>(review.design_result, null);
          const connectors = parseJsonSafe<string[]>(review.connectors_used, []);
          const isSelected = selectedId === review.id;
          const isRecommended = score > 0;

          return (
            <button
              key={review.id}
              data-testid={`template-card-${review.id}`}
              data-recommended={isRecommended ? 'true' : 'false'}
              onClick={() => onSelect(review.id)}
              className={`text-left rounded-modal border p-4 transition-all group ${
                isSelected
                  ? 'bg-violet-500/10 border-violet-500/30 shadow-elevation-2 shadow-violet-500/10'
                  : isRecommended
                    ? 'bg-violet-500/5 border-violet-500/20 hover:bg-violet-500/10 hover:border-violet-500/30'
                    : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50 hover:border-primary/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="typo-heading text-foreground/90 truncate">
                      {review.test_case_name}
                    </h4>
                    {isSelected && <Check className="w-4 h-4 text-violet-400 flex-shrink-0" />}
                    {!isSelected && isRecommended && (
                      <span className="inline-flex items-center gap-1 typo-caption text-violet-300 bg-violet-500/15 border border-violet-500/25 rounded-card px-1.5 py-0.5 flex-shrink-0">
                        <Sparkles className="w-3 h-3" />
                        {tx(t.onboarding.recommended_match_badge, {
                          apps: matchedApps.map(approvedAppDisplayLabel).join(', '),
                        })}
                      </span>
                    )}
                  </div>
                  <p className="typo-body text-foreground line-clamp-2">
                    {review.instruction.length > 150
                      ? review.instruction.slice(0, 150) + '...'
                      : review.instruction}
                  </p>
                  {connectors.length > 0 && (
                    <p className="typo-body text-foreground mt-1.5">
                      {connectors.slice(0, 4).join(', ')}
                      {connectors.length > 4 && ` ${tx(t.onboarding.more_connectors, { count: connectors.length - 4 })}`}
                    </p>
                  )}
                </div>
                {designResult && (
                  <div className="flex-shrink-0">
                    <DimensionRadial designResult={designResult} size={36} />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
