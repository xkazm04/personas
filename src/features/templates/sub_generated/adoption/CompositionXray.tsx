import { useEffect, useMemo } from 'react';
import { Layers } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface CompositionXrayProps {
  /** The template's raw design result (v3 payload shape). */
  designResult: Record<string, unknown>;
}

/**
 * Composition x-ray — makes the two-layer architecture visible during
 * template adoption: this template is a mentality shell composed over
 * catalog recipes (`use_cases[].recipe_ref`), the same capability
 * vocabulary the Foundry composes by hand. Renders nothing for legacy
 * inline-UC payloads, so it can mount unconditionally.
 */
export function CompositionXray({ designResult }: CompositionXrayProps) {
  const { t, tx } = useTranslation();
  const { definitions, fetchRecipes } = usePipelineStore(
    useShallow((s) => ({ definitions: s.recipes, fetchRecipes: s.fetchRecipes })),
  );

  const refIds = useMemo(() => {
    const ucs = (designResult.use_cases ?? []) as Array<Record<string, unknown>>;
    return ucs
      .map((uc) => (uc.recipe_ref as Record<string, unknown> | undefined)?.id)
      .filter((id): id is string => typeof id === 'string');
  }, [designResult]);

  useEffect(() => {
    if (refIds.length > 0 && definitions.length === 0) {
      fetchRecipes().catch(silentCatch('CompositionXray.fetchRecipes'));
    }
  }, [refIds.length, definitions.length, fetchRecipes]);

  const chips = useMemo(() => {
    const byId = new Map(definitions.map((d) => [d.id, d.name]));
    return refIds.map((id) => byId.get(id) ?? null).filter((n): n is string => !!n);
  }, [refIds, definitions]);

  if (refIds.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 flex-wrap px-4 py-2 border-b border-card-border/50 bg-secondary/20 shrink-0"
      data-testid="composition-xray"
    >
      <Tooltip content={t.foundry.xray_tooltip}>
        <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-wider text-foreground shrink-0">
          <Layers className="w-3 h-3" />
          {tx(t.foundry.xray_label, { count: refIds.length })}
        </span>
      </Tooltip>
      {chips.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/40 typo-caption text-foreground/90"
        >
          {name}
        </span>
      ))}
    </div>
  );
}
