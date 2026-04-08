import { Bot, RotateCcw } from 'lucide-react';

interface PersonaOverviewEmptyStateProps {
  onResetFilters: () => void;
}

/**
 * Shown when filters/search reduce the table to zero rows. Always offers a
 * one-click reset so users never get stuck in a "where did everything go"
 * dead-end after stacking too many filters.
 */
export function PersonaOverviewEmptyState({ onResetFilters }: PersonaOverviewEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-secondary/30 border border-primary/10 flex items-center justify-center mb-3">
        <Bot className="w-6 h-6 text-muted-foreground/40" />
      </div>
      <p className="typo-heading text-foreground/80">No personas match these filters</p>
      <p className="typo-body text-muted-foreground/60 mt-1 max-w-sm">
        Try adjusting your search or filter chips, or reset the view to see all personas.
      </p>
      <button
        type="button"
        onClick={onResetFilters}
        className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-md font-medium border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Clear all filters
      </button>
    </div>
  );
}
