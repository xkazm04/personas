import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  extra?: ReactNode;
}

export function SectionHeader({ title, actionLabel, onAction, extra }: Props) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="typo-section-title">{title}</h2>
      <div className="flex items-center gap-2">
        {extra}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
