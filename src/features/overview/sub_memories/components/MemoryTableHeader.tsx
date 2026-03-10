import { ChevronDown, ChevronUp } from 'lucide-react';

export type SortColumn = 'importance' | 'created_at';
export type SortDirection = 'asc' | 'desc';
export interface SortState { column: SortColumn; direction: SortDirection }

interface MemoryTableHeaderProps {
  sort: SortState;
  onToggleSort: (column: SortColumn) => void;
}

export function MemoryTableHeader({ sort, onToggleSort }: MemoryTableHeaderProps) {
  return (
    <div className="hidden md:flex items-center gap-4 px-6 py-2 bg-secondary/30 border-b border-primary/10 sticky top-0 z-10">
      <span className="w-[140px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Agent</span>
      <span className="flex-1 text-sm font-mono uppercase text-muted-foreground/80">Title</span>
      <span className="w-[70px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Category</span>
      <button
        onClick={() => onToggleSort('importance')}
        className={`w-[60px] flex items-center gap-0.5 text-sm font-mono uppercase flex-shrink-0 transition-colors rounded-lg px-1.5 py-0.5 hover:bg-secondary/30 ${sort.column === 'importance' ? 'text-foreground/90 font-semibold border-b-2 border-primary/40' : 'text-muted-foreground/80 hover:text-muted-foreground'}`}
      >
        Priority
        {sort.column === 'importance' ? (
          sort.direction === 'asc' ? <ChevronUp className="w-3 h-3 transition-transform duration-200" /> : <ChevronDown className="w-3 h-3 transition-transform duration-200" />
        ) : (
          <ChevronDown className="w-3 h-3 opacity-30 transition-transform duration-200" />
        )}
      </button>
      <span className="w-[120px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Tags</span>
      <button
        onClick={() => onToggleSort('created_at')}
        className={`w-[60px] flex items-center justify-end gap-0.5 text-sm font-mono uppercase flex-shrink-0 transition-colors rounded-lg px-1.5 py-0.5 hover:bg-secondary/30 ${sort.column === 'created_at' ? 'text-foreground/90 font-semibold border-b-2 border-primary/40' : 'text-muted-foreground/80 hover:text-muted-foreground'}`}
      >
        Created
        {sort.column === 'created_at' ? (
          sort.direction === 'asc' ? <ChevronUp className="w-3 h-3 transition-transform duration-200" /> : <ChevronDown className="w-3 h-3 transition-transform duration-200" />
        ) : (
          <ChevronDown className="w-3 h-3 opacity-30 transition-transform duration-200" />
        )}
      </button>
      <span className="w-[32px] flex-shrink-0" />
      <span className="w-[14px] flex-shrink-0" />
    </div>
  );
}
