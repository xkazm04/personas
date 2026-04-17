import type { LucideIcon } from 'lucide-react';
import { Search, Inbox, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface EmptyStateProps {
  /** 48px contextual icon */
  icon?: LucideIcon;
  /** Primary title */
  title?: string;
  /** Secondary description */
  description?: string;
  /** Optional CTA button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Rich empty state with contextual icon, title, description, and optional CTA.
 * Used across the template gallery for search results, first-use, and loading states.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: EmptyStateProps) {
  const { t } = useTranslation();
  const displayTitle = title ?? t.templates.empty.no_templates;
  const displayDescription = description ?? t.templates.empty.no_templates_hint;
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 animate-fade-in" role="status">
      <div className="w-12 h-12 rounded-modal bg-secondary/40 border border-primary/15 flex items-center justify-center">
        <Icon className="w-6 h-6 text-foreground" aria-hidden="true" />
      </div>
      <p className="text-base font-medium text-foreground">{displayTitle}</p>
      <p className="text-sm text-foreground text-center max-w-xs leading-relaxed">
        {displayDescription}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Pre-configured empty state for no search results */
export function SearchEmptyState({ onClear }: { onClear?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={Search}
      title={t.templates.empty.no_search_results}
      description={t.templates.empty.no_search_results_hint}
      action={onClear ? { label: t.templates.empty.clear_search, onClick: onClear } : undefined}
    />
  );
}

/** Pre-configured empty state for AI-powered suggestions */
export function AiEmptyState() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={Sparkles}
      title={t.templates.empty.waiting_for_draft}
      description={t.templates.empty.waiting_for_draft_hint}
    />
  );
}
