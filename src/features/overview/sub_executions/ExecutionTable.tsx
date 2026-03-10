import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import type { GlobalExecution } from '@/lib/types/types';
import { ExecutionVirtualRow } from './ExecutionVirtualRow';

interface ExecutionTableProps {
  executions: GlobalExecution[];
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (exec: GlobalExecution) => void;
}

export function ExecutionTable({ executions, hasMore, onLoadMore, onSelect }: ExecutionTableProps) {
  const { parentRef, virtualizer } = useVirtualList(executions, 44);

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
          <tr className="border-b border-primary/10">
            <th className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Persona</th>
            <th className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Status</th>
            <th className="text-right text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Duration</th>
            <th className="text-right text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Started</th>
            <th className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">ID</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ height: `${virtualizer.getTotalSize()}px` }} aria-hidden>
            <td colSpan={5} className="p-0" />
          </tr>
        </tbody>
      </table>

      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', marginTop: `-${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const exec = executions[virtualRow.index]!;
          return (
            <ExecutionVirtualRow
              key={exec.id}
              exec={exec}
              index={virtualRow.index}
              start={virtualRow.start}
              size={virtualRow.size}
              onSelect={onSelect}
            />
          );
        })}
      </div>

      {hasMore && (
        <div className="pt-3 pb-2 text-center">
          <button
            onClick={onLoadMore}
            className="px-4 py-2 text-sm font-medium text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 rounded-xl border border-primary/15 transition-all"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
}
