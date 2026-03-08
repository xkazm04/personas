import { Pencil, Trash2 } from 'lucide-react';

interface MemoryRowActionsProps {
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export default function MemoryRowActions({ canEdit, onEdit, onDelete }: MemoryRowActionsProps) {
  return (
    <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
      {canEdit && (
        <button
          className="p-1 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
          onClick={onEdit}
          title="Edit memory"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      <button
        className="p-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
        onClick={onDelete}
        title="Delete memory"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}
