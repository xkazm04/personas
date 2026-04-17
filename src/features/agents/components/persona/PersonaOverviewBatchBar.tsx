import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface PersonaOverviewBatchBarProps {
  count: number;
  onDelete: () => void;
  onClear: () => void;
}

export function PersonaOverviewBatchBar({ count, onDelete, onClear }: PersonaOverviewBatchBarProps) {
  const { t, tx } = useTranslation();
  if (count === 0) return null;
  return (
    <div className="animate-fade-slide-in flex items-center gap-3 px-4 py-2 rounded-modal border border-primary/15 bg-secondary/40 backdrop-blur-sm">
      <span className="text-sm text-foreground/80 font-medium">{tx(t.agents.persona_list.batch_selected, { count })}</span>
      <div className="w-px h-4 bg-primary/15" />
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-card text-md font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        {t.agents.persona_list.batch_delete}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="px-3 py-1.5 rounded-card text-md font-medium text-muted-foreground/70 hover:bg-secondary/60 transition-colors"
      >
        {t.agents.persona_list.batch_clear}
      </button>
    </div>
  );
}
