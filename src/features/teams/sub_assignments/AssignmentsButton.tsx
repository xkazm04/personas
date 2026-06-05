import { ListChecks } from 'lucide-react';

interface AssignmentsButtonProps {
  count: number;
  isOpen: boolean;
  hasAwaitingReview: boolean;
  onClick: () => void;
}

/** Floating toolbar badge that opens the AssignmentsPanel.
 *  Mirrors TeamMemoryBadge in placement + styling so the two badges read
 *  as a coherent toolbar at the bottom-left of the canvas. */
export default function AssignmentsButton({
  count,
  isOpen,
  hasAwaitingReview,
  onClick,
}: AssignmentsButtonProps) {
  if (isOpen) return null;
  return (
    <button
      className="animate-fade-slide-in absolute bottom-3 left-20 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal bg-secondary/90 backdrop-blur-lg border border-primary/15 shadow-elevation-3 hover:border-orange-500/30 transition-colors"
      onClick={onClick}
    >
      <div className="relative">
        <ListChecks className="w-4 h-4 text-orange-400" />
        {hasAwaitingReview && (
          <div className="animate-fade-in absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-500" />
        )}
      </div>
      <span className="typo-body font-medium text-foreground">{count}</span>
    </button>
  );
}
