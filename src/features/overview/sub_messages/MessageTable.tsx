import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { GRID_TEMPLATE_COLUMNS, priorityConfig, defaultPriority } from './messageListConstants';
import type { PersonaMessage } from '@/lib/types/types';

interface MessageTableProps {
  filteredMessages: PersonaMessage[];
  onRowClick: (msg: PersonaMessage) => void;
  remaining: number;
  onLoadMore: () => void;
}

export function MessageTable({ filteredMessages, onRowClick, remaining, onLoadMore }: MessageTableProps) {
  const { parentRef, virtualizer } = useVirtualList(filteredMessages, 40);

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div role="grid" aria-rowcount={filteredMessages.length} aria-colcount={5} className="w-full">
        <div
          role="row"
          className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-primary/10 grid"
          style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
        >
          <div role="columnheader" className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Persona</div>
          <div role="columnheader" className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Title</div>
          <div role="columnheader" className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Priority</div>
          <div role="columnheader" className="text-center text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Status</div>
          <div role="columnheader" className="text-right text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Created</div>
        </div>

        <div role="rowgroup" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const message = filteredMessages[virtualRow.index]!;
            const priority = priorityConfig[message.priority] ?? defaultPriority;
            return (
              <div
                key={message.id}
                role="row"
                tabIndex={0}
                onClick={() => onRowClick(message)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick(message);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
                }}
                className="grid items-center hover:bg-white/[0.03] cursor-pointer transition-colors border-b border-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
              >
                <div role="gridcell" className="flex items-center gap-2 px-4 min-w-0">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
                    style={{ backgroundColor: (message.persona_color || '#6366f1') + '15' }}
                  >
                    {message.persona_icon || '?'}
                  </div>
                  <span className="text-sm text-muted-foreground/80 truncate">
                    {message.persona_name || 'Unknown'}
                  </span>
                </div>

                <div role="gridcell" className="px-4 min-w-0">
                  <span className={`text-sm truncate block ${message.is_read ? 'text-foreground/80' : 'text-foreground/90 font-medium'}`}>
                    {message.title || message.content.slice(0, 80)}
                  </span>
                </div>

                <div role="gridcell" className="px-4">
                  <span className={`inline-flex px-2 py-0.5 rounded-lg text-sm font-medium border ${priority.bgColor} ${priority.color} ${priority.borderColor}`}>
                    {priority.label}
                  </span>
                </div>

                <div role="gridcell" className="px-4 flex justify-center">
                  {!message.is_read ? (
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" title="Unread" aria-label="Unread message" />
                  ) : (
                    <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" title="Read" aria-hidden="true" />
                  )}
                </div>

                <div role="gridcell" className="px-4 text-right">
                  <span className="text-sm text-muted-foreground/80">
                    {formatRelativeTime(message.created_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Load More */}
      {remaining > 0 && (
        <div className="p-4">
          <button
            onClick={onLoadMore}
            className="w-full py-2.5 text-sm text-muted-foreground/80 hover:text-muted-foreground bg-secondary/20 hover:bg-secondary/40 rounded-xl border border-primary/15 transition-all"
          >
            Load More ({remaining} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
