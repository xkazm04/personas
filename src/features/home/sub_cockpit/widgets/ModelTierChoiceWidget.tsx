import { useMemo } from 'react';
import { Hint, ListRow, Rows, Tile } from '@/features/shared/components/kit';
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
 * The three tiers on the capability ladder (Haiku for high-volume routing, Sonnet as the default,
 * Opus where one bad reply is expensive), one row each, the rationale as the row's meta. The
 * recommended tier's mark is the solid success glyph and its row names it on the right; the
 * others are hollow. Informational: it writes no selection (the user picks in the build flow).
 * The intent is not repeated here: the surface shows it once.
 */
export function ModelTierChoiceWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const a = t.athena;
  const recommended = typeof config?.recommended === 'string' ? (config.recommended as TierSlug) : 'sonnet';
  const tiers = useMemo<TierEntry[]>(() => {
    const raw = config?.tiers;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .map((e) => ({
        tier: typeof e.tier === 'string' ? (e.tier as TierSlug) : 'sonnet',
        rationale: typeof e.rationale === 'string' ? e.rationale : '',
      }))
      .filter((e) => e.tier && e.rationale.length > 0);
  }, [config]);

  // Haiku, Sonnet, Opus: the card reads down the capability ladder whatever Athena's emit order.
  const ordered = [...tiers].sort((x, y) => tierRank(x.tier) - tierRank(y.tier));

  return (
    <Tile
      span={span}
      title={title || a.model_tier_title}
      actions={actions}
      footer={footer}
      state={tiers.length === 0 ? 'empty' : undefined}
      empty={{ title: a.model_tier_empty }}
      testId="companion-model-tier-choice-widget"
    >
      <Rows count={ordered.length} empty={{ title: a.model_tier_empty }}>
        {ordered.map((entry) => {
          const isReco = entry.tier === recommended;
          const label = tierLabel(entry.tier, t);
          return (
            <ListRow
              key={entry.tier}
              size="s"
              name={<span data-tier={entry.tier} data-recommended={isReco ? 'true' : 'false'}>{label}</span>}
              mark={isReco
                ? { tone: 'success', glyph: 'solid', label: `${label}, ${a.model_tier_recommended_badge}` }
                : { tone: 'neutral', glyph: 'hollow', label }}
              meta={<Hint content={entry.rationale}><span className="k-ellipsis">{entry.rationale}</span></Hint>}
              figures={isReco ? <span className="k-fig typo-data k-regular k-toned t-success"><span className="k-cap inline-block">{a.model_tier_recommended_badge}</span></span> : undefined}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}

function tierRank(tier: string): number {
  if (tier === 'haiku') return 0;
  if (tier === 'sonnet') return 1;
  if (tier === 'opus') return 2;
  return 3;
}

function tierLabel(tier: string, t: ReturnType<typeof useTranslation>['t']): string {
  if (tier === 'haiku') return t.athena.model_tier_haiku;
  if (tier === 'sonnet') return t.athena.model_tier_sonnet;
  if (tier === 'opus') return t.athena.model_tier_opus;
  return tier;
}
