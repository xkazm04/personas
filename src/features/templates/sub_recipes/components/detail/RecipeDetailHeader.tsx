import { ArrowLeft, Sparkles, AlertTriangle, Lock, Check } from 'lucide-react';
import { CONNECTOR_META, ConnectorIcon, getConnectorMeta } from '@/lib/connectors/connectorMeta';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { Recipe, Eligibility } from '../../types';
import { categoryLabel } from '../../libs/categoryLabels';
import { EligibilityChip } from '../EligibilityChip';

interface RecipeDetailHeaderProps {
  recipe: Recipe;
  eligibility: Eligibility;
  canAdopt: boolean;
  hasPersona: boolean;
  /** The selected persona already adopted this recipe. */
  adopted: boolean;
  onBack: () => void;
  onAdopt: () => void;
}

/**
 * Hero band of the recipe detail view: connector-accented identity block,
 * category/author/published meta, eligibility chip and the Adopt CTA.
 * Includes the contextual eligibility banner so the orchestrator stays slim.
 */
export function RecipeDetailHeader({
  recipe, eligibility, canAdopt, hasPersona, adopted, onBack, onAdopt,
}: RecipeDetailHeaderProps) {
  const { t, tx } = useTranslation();
  const iconKey = recipe.iconConnector ?? recipe.requiredConnectors[0] ?? null;
  const iconMeta = iconKey ? CONNECTOR_META[iconKey] ?? null : null;
  const accent = recipe.color ?? iconMeta?.color ?? null;

  return (
    <>
      <div className="relative flex items-start gap-3 px-4 py-4 border-b border-card-border/60 flex-shrink-0 bg-secondary/20 overflow-hidden" data-testid="recipe-detail-header">
        {/* Connector-tinted wash so each recipe's header carries its brand */}
        {accent && (
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{ background: `linear-gradient(105deg, ${accent}14 0%, transparent 45%)` }}
          />
        )}
        <button
          type="button"
          onClick={onBack}
          className="relative mt-1 inline-flex items-center justify-center w-8 h-8 rounded-full border border-card-border bg-secondary/40 text-foreground hover:border-primary/40 cursor-pointer transition-colors"
          title={t.recipes_catalog.back_to_catalog}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        {iconMeta && (
          <span
            className="relative shrink-0 flex items-center justify-center rounded-card mt-0.5"
            style={{
              width: 52, height: 52,
              background: `${iconMeta.color}1f`,
              border: `1px solid ${iconMeta.color}55`,
              boxShadow: `0 0 24px ${iconMeta.color}26`,
            }}
          >
            <ConnectorIcon meta={iconMeta} size="w-6 h-6" />
          </span>
        )}
        <div className="relative flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-title text-foreground">{recipe.name}</span>
            {/* Eligibility is a per-persona verdict — meaningless before one
                is selected, so the chip waits for a persona. */}
            {hasPersona && <EligibilityChip eligibility={eligibility} />}
            {hasPersona && adopted && (
              <span className="inline-flex items-center gap-0.5 typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border border-status-success/35 bg-status-success/10 text-status-success">
                <Check className="w-2.5 h-2.5" />
                {t.recipes_catalog.adopted_badge}
              </span>
            )}
          </div>
          <div className="typo-body text-foreground mt-0.5">{recipe.summary}</div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary">
              {categoryLabel(t, recipe.category)}
            </span>
            <span className="typo-label font-mono px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/40 text-foreground">
              v{recipe.version}
            </span>
            <span className="typo-caption text-foreground">
              {tx(t.recipes_catalog.detail_by_prefix, { author: recipe.author })}
            </span>
            {/* Builtins' publishedAt is the local seed-insert time, not a
                real publication date — showing it reads as "just now" for
                the entire shipped catalog. */}
            {!recipe.isBuiltin && (
              <>
                <span className="typo-caption text-foreground" aria-hidden>·</span>
                <span className="typo-caption text-foreground inline-flex items-center gap-1">
                  {t.recipes_catalog.published_label}
                  <RelativeTime timestamp={recipe.publishedAt} />
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onAdopt}
          disabled={!canAdopt}
          className={`relative shrink-0 self-center inline-flex items-center gap-2 px-4 py-2 rounded-interactive border typo-body font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
            canAdopt
              ? 'border-primary/45 bg-primary/15 text-primary hover:bg-primary/25 shadow-elevation-1'
              : 'border-card-border bg-secondary/40 text-foreground'
          }`}
          title={
            !hasPersona
              ? t.recipes_catalog.adopt_tooltip_no_persona
              : eligibility.state === 'incompatible'
                ? eligibility.reason
                : eligibility.state === 'adoptable-with-setup'
                  ? tx(t.recipes_catalog.adopt_tooltip_needs_setup, { count: eligibility.missingConnectors.length })
                  : t.recipes_catalog.adopt_tooltip_ready
          }
        >
          <Sparkles className="w-4 h-4" />
          {eligibility.state === 'adoptable-with-setup' ? t.recipes_catalog.adopt_with_setup_label : t.recipes_catalog.adopt_label}
        </button>
      </div>

      {eligibility.state === 'adoptable-with-setup' && (
        <EligibilityBanner
          kind="setup"
          title={t.recipes_catalog.banner_setup_title}
          body={
            <>
              {t.recipes_catalog.banner_setup_body_prefix}{' '}
              {eligibility.missingConnectors.map((slug, i) => {
                const m = getConnectorMeta(slug);
                return (
                  <span key={slug} className="inline-flex items-center gap-1 mx-0.5">
                    <ConnectorIcon meta={m} size="w-3 h-3" />
                    <span className="font-medium" style={{ color: m.color }}>{m.label}</span>
                    {i < eligibility.missingConnectors.length - 1 && <span className="text-foreground">,</span>}
                  </span>
                );
              })}{' '}
              {t.recipes_catalog.banner_setup_body_suffix}
            </>
          }
        />
      )}
      {eligibility.state === 'incompatible' && (
        <EligibilityBanner
          kind="locked"
          title={t.recipes_catalog.banner_locked_title}
          body={eligibility.reason}
        />
      )}
    </>
  );
}

interface EligibilityBannerProps {
  kind: 'setup' | 'locked';
  title: string;
  body: React.ReactNode;
}

function EligibilityBanner({ kind, title, body }: EligibilityBannerProps) {
  const cls = kind === 'setup'
    ? 'border-status-warning/35 bg-status-warning/10'
    : 'border-card-border bg-secondary/40';
  const Icon = kind === 'setup' ? AlertTriangle : Lock;
  const iconCls = kind === 'setup' ? 'text-status-warning' : 'text-foreground';
  return (
    <div className={`mx-4 mt-4 px-3 py-2.5 rounded-card border ${cls} flex items-start gap-2`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconCls}`} />
      <div className="flex-1 min-w-0">
        <div className={`typo-label uppercase tracking-wider ${iconCls}`}>{title}</div>
        <div className="typo-caption text-foreground/85 mt-0.5">{body}</div>
      </div>
    </div>
  );
}
