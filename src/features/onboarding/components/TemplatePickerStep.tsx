import {
  Check,
  AlertCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR } from '@/lib/types/designTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { DimensionRadial } from '@/features/templates/sub_generated/shared/DimensionRadial';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';
import { useMemo } from 'react';
import {
  approvedAppDisplayLabel,
  pickStarterTemplates,
} from './templateRecommendation';
import type { TemplateLoadState } from './useOnboardingState';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';

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
    () => pickStarterTemplates(templates, approvedApps),
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
        <LoadingSpinner size="xl" className="text-role-agent" />
        <span className="ml-3 typo-body text-ink-1">{t.onboarding.loading_templates}</span>
      </div>
    );
  }

  if (loadState.phase === 'error') {
    return (
      <div className="text-center py-16">
        <AlertCircle className="w-10 h-10 mx-auto text-status-warning mb-3" />
        <p className="typo-body text-ink-1">{t.onboarding.templates_load_error}</p>
        {loadState.error && (
          <p className="typo-body text-ink-2 mt-1">
            {resolveErrorTranslated(t, extractMessage(loadState.error.raw)).message}
          </p>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 typo-heading rounded-card bg-role-agent/15 text-role-agent border border-role-agent/25 hover:bg-role-agent/25 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t.onboarding.retry}
        </button>
      </div>
    );
  }

  if (loadState.phase === 'empty' || templates.length === 0) {
    return (
      <EmptyState
        art="templates"
        size="md"
        title={t.onboarding.no_templates}
        subtitle={t.onboarding.no_templates_hint}
        action={{ label: t.onboarding.retry, onClick: onRetry, icon: RefreshCw }}
      />
    );
  }

  const showRecommendationStrip = matchedCount > 0 && approvedLabels.length > 0;
  const appsJoined = approvedLabels.join(', ');

  return (
    <div className="space-y-4">
      <div>
        <h3 className="typo-heading-lg text-ink-1 mb-1">{t.onboarding.pick_template_heading}</h3>
        <p className="typo-body text-ink-1">{t.onboarding.pick_template_description}</p>
      </div>
      {showRecommendationStrip && (
        <div
          data-testid="recommendation-strip"
          className="flex items-center gap-2 rounded-card bg-role-agent/10 border border-role-agent/25 px-3 py-2"
        >
          <Sparkles className="w-3.5 h-3.5 text-role-agent flex-shrink-0" />
          <p className="typo-body text-role-agent">
            {tx(t.onboarding.because_you_connected, { apps: appsJoined })}
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3">
        {ranked.map(({ review, score, matchedApps }) => {
          const designResult = parseJsonOrDefault<AgentIR | null>(review.design_result, null);
          const connectors = parseJsonOrDefault<string[]>(review.connectors_used, []);
          const isSelected = selectedId === review.id;
          const isRecommended = score > 0;

          return (
            <button
              type="button"
              key={review.id}
              data-testid={`template-card-${review.id}`}
              data-recommended={isRecommended ? 'true' : 'false'}
              onClick={() => onSelect(review.id)}
              className={`text-left rounded-modal border p-4 transition-all group ${
                isSelected
                  ? 'bg-role-agent/10 border-role-agent/30 shadow-elevation-2 shadow-violet-500/10'
                  : isRecommended
                    ? 'bg-role-agent/5 border-role-agent/20 hover:bg-role-agent/10 hover:border-role-agent/30'
                    : 'bg-surface-1 border-hair hover:bg-surface-2 hover:border-hair'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="typo-heading text-ink-1 truncate">
                      {review.test_case_name}
                    </h4>
                    {isSelected && <Check className="w-4 h-4 text-role-agent flex-shrink-0" />}
                    {!isSelected && isRecommended && (
                      <span className="inline-flex items-center gap-1 typo-caption text-role-agent flex-shrink-0">
                        <Sparkles className="w-3 h-3" />
                        {tx(t.onboarding.recommended_match_badge, {
                          apps: matchedApps.map(approvedAppDisplayLabel).join(', '),
                        })}
                      </span>
                    )}
                  </div>
                  <p className="typo-body text-ink-1 line-clamp-2">
                    {review.instruction.length > 150
                      ? review.instruction.slice(0, 150) + '...'
                      : review.instruction}
                  </p>
                  {connectors.length > 0 && (
                    <p className="typo-body text-ink-2 mt-1.5">
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
