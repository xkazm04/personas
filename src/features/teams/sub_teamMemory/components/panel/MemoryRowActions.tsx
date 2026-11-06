import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
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
          <Button variant="accent" tone="agent" size="icon-sm" onClick={onEdit} aria-label={pt.edit_memory}>
            <Pencil className="w-3 h-3" />
          </Button>
        </Tooltip>
      )}
      <Tooltip content={pt.delete_memory}>
        <Button variant="danger" size="icon-sm" onClick={onDelete} aria-label={pt.delete_memory}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </Tooltip>
    </div>
  );
}
