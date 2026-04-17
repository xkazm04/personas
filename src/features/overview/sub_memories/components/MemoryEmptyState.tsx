import { Brain } from 'lucide-react';

interface MemoryEmptyStateProps {
  hasFilters: boolean;
}

export function MemoryEmptyState({ hasFilters }: MemoryEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-foreground">
      <div className="w-16 h-16 rounded-modal bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
        <Brain className="w-8 h-8 text-violet-400/40" />
      </div>
      <div className="text-center">
        <p className="typo-heading">No memories yet</p>
        <p className="typo-body text-foreground mt-1 max-w-xs">
          {hasFilters
            ? 'No memories match your filters. Try adjusting your search.'
            : 'When agents run, they can store valuable notes and learnings here.'}
        </p>
      </div>
    </div>
  );
}
