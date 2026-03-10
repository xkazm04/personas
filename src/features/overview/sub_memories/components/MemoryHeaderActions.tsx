import { Plus, Sparkles, Loader2 } from 'lucide-react';

interface MemoryHeaderActionsProps {
  isReviewing: boolean;
  memoriesTotal: number;
  showAddForm: boolean;
  onReview: () => void;
  onToggleAddForm: () => void;
}

export function MemoryHeaderActions({
  isReviewing,
  memoriesTotal,
  showAddForm,
  onReview,
  onToggleAddForm,
}: MemoryHeaderActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onReview}
        disabled={isReviewing || memoriesTotal === 0}
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border transition-all bg-cyan-500/15 text-cyan-300 border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40"
      >
        {isReviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {isReviewing ? 'Reviewing...' : 'Review with AI'}
      </button>
      <button
        onClick={onToggleAddForm}
        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border transition-all ${
          showAddForm
            ? 'bg-violet-500/30 text-violet-200 border-violet-500/40'
            : 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'
        }`}
      >
        <Plus className={`w-3.5 h-3.5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
        Add Memory
      </button>
    </div>
  );
}
