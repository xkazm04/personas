import {
  FlaskConical,
  Check,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR } from '@/lib/types/designTypes';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import { DimensionRadial } from '@/features/templates/sub_generated/shared/DimensionRadial';
import { useTranslation } from '@/i18n/useTranslation';

export function TemplatePickerStep({
  templates,
  isLoading,
  selectedId,
  onSelect,
}: {
  templates: PersonaDesignReview[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t, tx } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="xl" className="text-violet-400" />
        <span className="ml-3 typo-body text-foreground">{t.onboarding.loading_templates}</span>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-16">
        <FlaskConical className="w-10 h-10 mx-auto text-foreground mb-3" />
        <p className="typo-body text-foreground">{t.onboarding.no_templates}</p>
        <p className="typo-body text-foreground mt-1">{t.onboarding.no_templates_hint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="typo-heading-lg text-foreground/90 mb-1">{t.onboarding.pick_template_heading}</h3>
        <p className="typo-body text-foreground">{t.onboarding.pick_template_description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {templates.map((review) => {
          const designResult = parseJsonSafe<AgentIR | null>(review.design_result, null);
          const connectors = parseJsonSafe<string[]>(review.connectors_used, []);
          const isSelected = selectedId === review.id;

          return (
            <button
              key={review.id}
              onClick={() => onSelect(review.id)}
              className={`text-left rounded-modal border p-4 transition-all group ${
                isSelected
                  ? 'bg-violet-500/10 border-violet-500/30 shadow-elevation-2 shadow-violet-500/10'
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
