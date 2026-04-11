import { useState, useEffect } from 'react';
import { BadgeCheck } from 'lucide-react';
import { getCredentialRecipe } from '@/api/vault/credentialRecipes';
import { useTranslation } from '@/i18n/useTranslation';

interface RecipeConfidenceBannerProps {
  /** The user's instruction text — used to look up a matching recipe. */
  instruction: string;
}

/**
 * Shows a subtle confidence banner when a cached recipe exists for the
 * connector being designed. Normalizes the instruction to a connector_name
 * by lowercasing and stripping common suffixes.
 */
export function RecipeConfidenceBanner({ instruction }: RecipeConfidenceBannerProps) {
  const { t } = useTranslation();
  const [match, setMatch] = useState<{ label: string; usageCount: number } | null>(null);

  useEffect(() => {
    if (!instruction.trim()) return;

    let cancelled = false;

    // Normalize instruction → candidate connector_name
    const normalized = instruction
      .trim()
      .toLowerCase()
      .replace(/\s+(credential|api|key|token|setup|oauth)s?$/i, '')
      .replace(/\s+/g, '_');

    getCredentialRecipe(normalized).then((recipe) => {
      if (cancelled || !recipe) return;
      setMatch({ label: recipe.connector_label, usageCount: recipe.usage_count });
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [instruction]);

  if (!match) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-emerald-500/8 border-emerald-500/20 animate-fade-slide-in">
      <BadgeCheck className="w-4 h-4 text-emerald-400 shrink-0" />
      <span className="text-sm text-emerald-300/90">
        <span className="font-medium">{t.vault.design_phases.verified_setup}</span>
        {match.usageCount > 0 && (
          <> &mdash; used {match.usageCount} {match.usageCount === 1 ? 'time' : 'times'}</>
        )}
        <span className="text-emerald-300/60 ml-1.5">{t.vault.design_phases.cached_recipe}</span>
      </span>
    </div>
  );
}
