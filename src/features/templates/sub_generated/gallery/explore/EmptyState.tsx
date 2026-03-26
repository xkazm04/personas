import type { LucideIcon } from 'lucide-react';
import { Search, Inbox, Sparkles } from 'lucide-react';

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
  title = 'No generated templates yet',
  description = 'Use the Synthesize Team button in the header or the Claude Code skill to generate templates.',
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 animate-fade-in" role="status">
      <div className="w-12 h-12 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
        <Icon className="w-6 h-6 text-muted-foreground/60" aria-hidden="true" />
      </div>
      <p className="text-base font-medium text-foreground/80">{title}</p>
      <p className="text-sm text-muted-foreground/60 text-center max-w-xs leading-relaxed">
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Pre-configured empty state for no search results */
export function SearchEmptyState({ onClear }: { onClear?: () => void }) {
  return (
    <EmptyState
      icon={Search}
      title="No matching templates"
      description="Try adjusting your search terms or filters to find what you're looking for."
      action={onClear ? { label: 'Clear search', onClick: onClear } : undefined}
    />
  );
}

/** Pre-configured empty state for AI-powered suggestions */
export function AiEmptyState() {
  return (
    <EmptyState
      icon={Sparkles}
      title="Waiting for persona draft"
      description="The AI is generating a draft based on your selections. This usually takes a few seconds."
    />
  );
}
