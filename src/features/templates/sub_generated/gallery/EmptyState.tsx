import { FlaskConical, Plus, Play } from 'lucide-react';
import { CreateTemplateModal } from '../generation/CreateTemplateModal';

interface EmptyStateProps {
  handleStartReview: () => void;
  isRunning: boolean;
  isCreateOpen: boolean;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onRefresh: () => void;
  onPersonaCreated?: () => void;
}

export function EmptyState({
  handleStartReview,
  isRunning,
  isCreateOpen,
  onOpenCreate,
  onCloseCreate,
  onRefresh,
  onPersonaCreated,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/80">
      <FlaskConical className="w-12 h-12 opacity-30" />
      <p className="text-sm font-medium">No generated templates yet</p>
      <p className="text-sm text-muted-foreground/80 text-center max-w-xs">
        Generate templates to build a library of reusable persona configurations
      </p>
      <div className="flex gap-3">
        <button
          onClick={onOpenCreate}
          className="px-4 py-2 text-sm rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          New Template
        </button>
        <button
          onClick={handleStartReview}
          disabled={isRunning}
          className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
        >
          <Play className="w-3.5 h-3.5" />
          Generate Templates
        </button>
      </div>
      <CreateTemplateModal
        isOpen={isCreateOpen}
        onClose={onCloseCreate}
        onTemplateCreated={() => {
          onCloseCreate();
          onRefresh();
          onPersonaCreated?.();
        }}
      />
    </div>
  );
}
