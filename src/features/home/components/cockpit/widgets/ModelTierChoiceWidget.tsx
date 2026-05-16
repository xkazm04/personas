import { useMemo } from 'react';
import { Cpu, Star, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

type TierSlug = 'haiku' | 'sonnet' | 'opus';

interface TierEntry {
  tier: TierSlug | string;
  rationale: string;
}

/**
 * Inline chat-card Athena emits via
 *   `show_model_tier_choice { intent, recommended, tiers: [{tier, rationale}] }`.
 *
 * Renders the three tiers side-by-side with the recommended one accented.
 * Pulls from cycle-6 doctrine's heuristics: Haiku for high-volume
 * routing/triage with structured output, Sonnet as the default for the
 * majority of personas, Opus for long-context reasoning over large
 * inputs or persona outputs where a single bad reply is expensive.
 *
 * The card is informational — it doesn't write any selection. The user
 * picks the tier when they reach the build flow.
 */
export function ModelTierChoiceWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent =
    typeof config?.intent === 'string' ? (config.intent as string).trim() : '';
  const recommended =
    typeof config?.recommended === 'string'
      ? (config.recommended as TierSlug)
      : 'sonnet';
  const tiers = useMemo<TierEntry[]>(() => {
    const raw = config?.tiers;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (e): e is Record<string, unknown> => typeof e === 'object' && e !== null,
      )
      .map((e) => ({
        tier: typeof e.tier === 'string' ? (e.tier as TierSlug) : 'sonnet',
        rationale: typeof e.rationale === 'string' ? e.rationale : '',
      }))
      .filter((e) => e.tier && e.rationale.length > 0);
  }, [config]);

  if (tiers.length === 0) {
    return (
      <div className="rounded-card border border-foreground/10 bg-secondary/40 p-3 typo-caption text-foreground/55">
        {t.plugins.companion.model_tier_empty}
      </div>
    );
  }

  // Sort haiku → sonnet → opus so the card reads left-to-right by
  // capability ladder regardless of Athena's emit order.
  const ordered = [...tiers].sort((a, b) => tierRank(a.tier) - tierRank(b.tier));

  return (
    <div
      className="rounded-card border border-indigo-500/30 bg-indigo-500/[0.04] p-4 space-y-3"
      data-testid="companion-model-tier-choice-widget"
    >
      <header className="flex items-baseline gap-2 typo-caption text-indigo-300/85">
        <Cpu className="w-3.5 h-3.5" />
        <span className="font-medium">
          {title || t.plugins.companion.model_tier_title}
        </span>
        {intent && (
          <span className="text-foreground/55 truncate" title={intent}>
            · {intent}
          </span>
        )}
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {ordered.map((entry) => {
          const isReco = entry.tier === recommended;
          const accent = isReco
            ? 'border-emerald-500/35 bg-emerald-500/[0.06]'
            : 'border-foreground/10 bg-secondary/40';
          return (
            <div
              key={entry.tier}
              className={`rounded-card border ${accent} p-3 space-y-1`}
              data-tier={entry.tier}
              data-recommended={isReco ? 'true' : 'false'}
            >
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-foreground/55" />
                <span className="typo-body font-medium text-foreground/95">
                  {tierLabel(entry.tier, t)}
                </span>
                {isReco && (
                  <span className="inline-flex items-center gap-0.5 typo-caption text-emerald-300/85 ml-auto">
                    <Star className="w-3 h-3" />
                    {t.plugins.companion.model_tier_recommended_badge}
                  </span>
                )}
              </div>
              <p className="typo-caption text-foreground/70 leading-snug">
                {entry.rationale}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tierRank(tier: string): number {
  if (tier === 'haiku') return 0;
  if (tier === 'sonnet') return 1;
  if (tier === 'opus') return 2;
  return 3;
}

function tierLabel(
  tier: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (tier === 'haiku') return t.plugins.companion.model_tier_haiku;
  if (tier === 'sonnet') return t.plugins.companion.model_tier_sonnet;
  if (tier === 'opus') return t.plugins.companion.model_tier_opus;
  return tier;
}
