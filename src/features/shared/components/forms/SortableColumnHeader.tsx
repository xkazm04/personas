import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc' | null;

interface SortableColumnHeaderProps {
  label: string;
  direction: SortDirection;
  onToggle: () => void;
  align?: 'left' | 'right';
}

/**
 * Column header for sortable columns. Shows an arrow icon on the right
 * indicating current sort state. Clicking cycles through asc → desc → none.
 */
export function SortableColumnHeader({ label, direction, onToggle, align = 'left' }: SortableColumnHeaderProps) {
  const isSorted = direction !== null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1.5 typo-label transition-colors ${align === 'right' ? 'justify-end ml-auto' : ''} ${isSorted ? 'text-primary' : 'text-foreground hover:text-foreground'}`}
    >
      <span>{label}</span>
      {direction === 'asc' ? (
        <ArrowUp className="w-3 h-3" />
      ) : direction === 'desc' ? (
        <ArrowDown className="w-3 h-3" />
      ) : (
        <ArrowUpDown className="w-3 h-3 text-foreground" />
      )}
    </button>
  );
}
