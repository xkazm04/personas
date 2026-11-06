import { useTranslation } from '@/i18n/useTranslation';
import { Pencil, Trash2 } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
        <Tooltip content={pt.edit_memory}>
          <button
            type="button"
            className="p-1 rounded-card bg-role-agent/10 text-role-agent hover:bg-role-agent/20 transition-colors"
            onClick={onEdit}
            aria-label={pt.edit_memory}
          >
            <Pencil className="w-3 h-3" />
          </button>
        </Tooltip>
      )}
      <Tooltip content={pt.delete_memory}>
        <button
          type="button"
          className="p-1 rounded-card bg-status-error/10 text-status-error hover:bg-status-error/20 transition-colors"
          onClick={onDelete}
          aria-label={pt.delete_memory}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </Tooltip>
    </div>
  );
}
