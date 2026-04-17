import { Brain } from 'lucide-react';

interface TeamMemoryBadgeProps {
  count: number;
  isOpen: boolean;
  isPulsing: boolean;
  onClick: () => void;
}

export default function TeamMemoryBadge({ count, isOpen, isPulsing, onClick }: TeamMemoryBadgeProps) {
  return (
    <>
      {!isOpen && (
        <button
          className="animate-fade-slide-in absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal bg-secondary/90 backdrop-blur-lg border border-primary/15 shadow-elevation-3 hover:border-violet-500/30 transition-colors"
          onClick={onClick}
        >
          <div className="relative">
            <Brain className="w-4 h-4 text-violet-400" />
            {isPulsing && (
              <div
                className="animate-fade-in absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-violet-500"
              />
            )}
          </div>
          <span className="typo-body font-medium text-foreground">{count}</span>
        </button>
      )}
    </>
  );
}
