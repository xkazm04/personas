import { Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface AddCapabilityRowProps {
  onClick: () => void;
}

/**
 * Compact "add a capability" control for the Use Cases header — a slim dashed
 * `＋ Recipe` pill that opens Templates → Recipes. Slimmed (2026-06-18) from the
 * former full-width sigil row so it sits on a single slim header row alongside
 * the capability tag strip + Run Now button.
 *
 * Clicking triggers the caller's onClick — typically navigation to
 * Templates → Recipes (mirrors the legacy EmptyTile `recipe` variant).
 */
export function AddCapabilityRow({ onClick }: AddCapabilityRowProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium border border-dashed border-foreground/30 text-foreground hover:border-primary/55 hover:text-primary transition-colors cursor-pointer"
    >
      <Plus className="w-3.5 h-3.5" />
      {t.agents.use_cases.recipe}
    </button>
  );
}
