import { UserCheck, Brain, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Recipe } from '../../types';

interface RecipeGuardrailsCardProps {
  recipe: Recipe;
}

/**
 * "Guardrails & memory" — surfaces the recipe's review policy, memory policy
 * and failure handling as explained prose instead of bare ON/OFF toggles.
 * ~90% of seeded recipes carry at least one of these; the card hides
 * entirely when none are declared.
 */
export function RecipeGuardrailsCard({ recipe }: RecipeGuardrailsCardProps) {
  const { t } = useTranslation();
  const { reviewPolicy, memoryPolicy, errorHandling, generationSettings } = recipe.template;

  const hasReview = !!(reviewPolicy?.context || generationSettings?.reviews);
  const hasMemory = !!(memoryPolicy?.context || generationSettings?.memories);
  if (!hasReview && !hasMemory && !errorHandling) return null;

  const reviewSetting = generationSettings?.reviews;
  const reviewBadge = reviewSetting === 'on'
    ? { label: t.recipes_catalog.review_mode_always, cls: 'border-status-warning/40 bg-status-warning/10 text-status-warning' }
    : reviewSetting === 'trust_llm'
      ? { label: t.recipes_catalog.review_mode_conditional, cls: 'border-primary/35 bg-primary/10 text-primary' }
      : { label: t.recipes_catalog.review_mode_never, cls: 'border-card-border bg-secondary/40 text-foreground' };

  const memoryOn = generationSettings?.memories !== 'off';
  const memoryBadge = memoryOn
    ? { label: t.recipes_catalog.memory_on_label, cls: 'border-status-success/35 bg-status-success/10 text-status-success' }
    : { label: t.recipes_catalog.memory_off_label, cls: 'border-card-border bg-secondary/40 text-foreground' };

  return (
    <section className="mx-4 mb-6 rounded-card border border-card-border bg-secondary/30 p-4 shadow-elevation-1">
      <h4 className="typo-label uppercase tracking-wider text-foreground mb-3">
        {t.recipes_catalog.guardrails_heading}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {hasReview && (
          <PolicyBlock
            icon={UserCheck}
            label={t.recipes_catalog.spec_review_label}
            badge={reviewBadge}
            body={reviewPolicy?.context}
          />
        )}
        {hasMemory && (
          <PolicyBlock
            icon={Brain}
            label={t.recipes_catalog.spec_memory_label}
            badge={memoryBadge}
            body={memoryPolicy?.context}
          />
        )}
        {errorHandling && (
          <PolicyBlock
            icon={AlertTriangle}
            label={t.recipes_catalog.error_handling_label}
            body={errorHandling}
          />
        )}
      </div>
    </section>
  );
}

interface PolicyBlockProps {
  icon: typeof UserCheck;
  label: string;
  badge?: { label: string; cls: string };
  body?: string;
}

function PolicyBlock({ icon: Icon, label, badge, body }: PolicyBlockProps) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3.5 h-3.5 text-foreground shrink-0" />
        <span className="typo-caption font-medium text-foreground">{label}</span>
        {badge && (
          <span className={`typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
      {body && (
        <p className="typo-caption text-foreground/90 leading-relaxed">{body}</p>
      )}
    </div>
  );
}
