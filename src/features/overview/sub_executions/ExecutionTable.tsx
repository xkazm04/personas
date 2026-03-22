import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import type { GlobalExecution } from '@/lib/types/types';
import { ExecutionVirtualRow } from './ExecutionVirtualRow';
import type { Persona } from '@/lib/bindings/Persona';

interface ExecutionTableProps {
  executions: GlobalExecution[];
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (exec: GlobalExecution) => void;
  personas?: Persona[];
}

const COL = "text-[11px] text-muted-foreground/70 uppercase tracking-wider font-medium px-4 py-2.5";

export function ExecutionTable({ executions, hasMore, onLoadMore, onSelect, personas }: ExecutionTableProps) {
  const { parentRef, virtualizer } = useVirtualList(executions, 44);

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      {/* Unified flex header — same structure as rows */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-primary/10">
        <div className="flex items-center h-9">
          <div className={`w-[22%] ${COL} text-left`}>Persona</div>
          <div className={`w-[12%] ${COL} text-left`}>Connectors</div>
          <div className={`w-[18%] ${COL} text-left`}>Status</div>
          <div className={`w-[14%] ${COL} text-right`}>Duration</div>
          <div className={`w-[18%] ${COL} text-right`}>Started</div>
          <div className={`w-[16%] ${COL} text-left`}>ID</div>
        </div>
      </div>

      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
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
              personas={personas}
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
