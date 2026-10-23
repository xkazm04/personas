import { Sparkles } from 'lucide-react';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import type { EmptyArtMotif } from '@/features/shared/components/display/emptyArt/EmptyArt';
import { useTranslation } from '@/i18n/useTranslation';

interface EmptyStateProps {
  /** Illustration motif; defaults to the templates art */
  art?: EmptyArtMotif;
  /** `lg` for the gallery's own first-run state */
  size?: 'sm' | 'md' | 'lg';
  /** Primary title */
  title?: string;
  /** Secondary description */
  description?: string;
  /** Optional CTA button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Optional second, lower-emphasis CTA beside the primary one */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Rich empty state with contextual icon, title, description, and optional CTA.
 * Used across the template gallery for search results, first-use, and loading states.
 */
export function EmptyState({
  art = 'templates',
  size,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div role="status">
      <ScenarioEmptyState
        art={art}
        size={size}
        title={title ?? t.templates.empty.no_templates}
        description={description ?? t.templates.empty.no_templates_hint}
        action={action}
        secondaryAction={secondaryAction ? { ...secondaryAction, icon: Sparkles } : undefined}
      />
    </div>
  );
}

/**
 * Pre-configured empty state for no search results. A zero-hit search is a
 * failed search, not a successful blank page: when the caller can undo the
 * query or hand it to AI search, both doors are offered here.
 */
export function SearchEmptyState({ onClear, onAiSearch }: { onClear?: () => void; onAiSearch?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      art="search"
      size="sm"
      title={t.templates.empty.no_search_results}
      description={t.templates.empty.no_search_results_hint}
      action={onClear ? { label: t.templates.empty.clear_search, onClick: onClear } : undefined}
      secondaryAction={onAiSearch ? { label: t.templates.search.try_ai_search, onClick: onAiSearch } : undefined}
    />
  );
}

/** Pre-configured empty state for AI-powered suggestions */
export function AiEmptyState() {
  const { t } = useTranslation();
  return (
    <EmptyState
      art="templates"
      title={t.templates.empty.waiting_for_draft}
      description={t.templates.empty.waiting_for_draft_hint}
    />
  );
}
