import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { ActivitySequence } from '@/features/shared/components/display/ActivitySequence';
import { readV3Fields, type ActivityKind } from '@/lib/personas/recipeV3';
import { CharterConnectorTypes } from './CharterConnectorTypes';

interface CharterRecipeBlocksProps {
  charter: PersonaResponsibility;
}

/**
 * The Recipe v3 blocks on a charter: the shape of the work, the connector types
 * it needs and what they resolved to, its dependencies, and which registry
 * recipe it came from.
 *
 * Every block is independently optional and the whole card renders `null` when
 * none of the fields is present. That is the honest degradation for a pre-v3
 * charter, which has none of them: a fabricated empty diagram would claim this
 * charter has a shape nobody wrote. See `readV3Fields` for why each field is
 * validated rather than asserted (the `spec` column is a DB JSON blob whose
 * runtime shape is decided by whatever wrote the row).
 */
export function CharterRecipeBlocks({ charter }: CharterRecipeBlocksProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;

  const v3 = useMemo(() => readV3Fields(charter.spec), [charter.spec]);

  const kindLabels: Record<ActivityKind, string> = {
    observe: c.activity_kind_observe,
    decide: c.activity_kind_decide,
    act: c.activity_kind_act,
    deliver: c.activity_kind_deliver,
  };

  const hasConnectors = Boolean(v3.connectorTypes?.length || v3.connectorBindings?.length);
  if (!v3.recipeRef && !v3.activities && !hasConnectors && !v3.dependencies) return null;

  return (
    <SectionCard
      title={c.recipe_card_title}
      action={
        v3.recipeRef ? (
          <StatusBadge size="sm" accent="slate" pill className="font-mono">
            <span data-testid="resp-recipe-ref">{`${v3.recipeRef.slug}@${v3.recipeRef.version}`}</span>
          </StatusBadge>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4" data-testid="resp-recipe-blocks">
        {v3.activities && (
          <section className="flex flex-col gap-2">
            <span className="typo-label text-foreground">{c.recipe_shape_label}</span>
            <p className="typo-caption text-foreground">{c.recipe_shape_hint}</p>
            <ActivitySequence activities={v3.activities} kindLabels={kindLabels} />
          </section>
        )}

        <CharterConnectorTypes
          types={v3.connectorTypes}
          bindings={v3.connectorBindings}
          connectors={charter.connectors}
        />

        {v3.dependencies && (
          <section className="flex flex-col gap-2">
            <span className="typo-label text-foreground">{c.recipe_dependencies_label}</span>
            <div className="flex items-center gap-1.5 flex-wrap" data-testid="resp-recipe-dependencies">
              {v3.dependencies.map((dep) => (
                <StatusBadge key={dep} size="sm" accent="slate" className="font-mono">{dep}</StatusBadge>
              ))}
            </div>
          </section>
        )}
      </div>
    </SectionCard>
  );
}
