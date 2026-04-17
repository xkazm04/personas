import { useTranslation } from '@/i18n/useTranslation';
import { Pencil, Trash2 } from 'lucide-react';

interface MemoryRowActionsProps {
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export default function MemoryRowActions({ canEdit, onEdit, onDelete }: MemoryRowActionsProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  return (
    <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
      {canEdit && (
        <button
          className="p-1 rounded-card bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
          onClick={onEdit}
          title={pt.edit_memory}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      <button
        className="p-1 rounded-card bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
        onClick={onDelete}
        title={pt.delete_memory}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}
