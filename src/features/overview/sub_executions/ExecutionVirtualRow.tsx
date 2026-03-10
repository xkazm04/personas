import { getStatusEntry, formatDuration, formatRelativeTime, badgeClass } from '@/lib/utils/formatters';
import type { GlobalExecution } from '@/lib/types/types';

interface ExecutionVirtualRowProps {
  exec: GlobalExecution;
  index: number;
  start: number;
  size: number;
  onSelect: (exec: GlobalExecution) => void;
}

export function ExecutionVirtualRow({ exec, index, start, size, onSelect }: ExecutionVirtualRowProps) {
  const status = getStatusEntry(exec.status);
  const hoverAccent =
    exec.status === 'running' || exec.status === 'pending'
      ? 'hover:border-l-blue-400'
      : exec.status === 'completed'
        ? 'hover:border-l-emerald-400'
        : exec.status === 'failed'
          ? 'hover:border-l-red-400'
          : 'hover:border-l-amber-400';

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onSelect(exec)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(exec);
        }
      }}
      style={{
        position: 'absolute',
        top: 0,
        transform: `translateY(${start}px)`,
        width: '100%',
        height: `${size}px`,
      }}
      className={`flex items-center cursor-pointer transition-colors border-b border-primary/[0.06] border-l-2 border-l-transparent hover:bg-white/[0.05] ${hoverAccent} ${index % 2 === 0 ? 'bg-white/[0.015]' : ''}`}
    >
      {/* Persona */}
      <div className="flex items-center gap-2 px-4 w-[25%] min-w-0">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
          style={{ backgroundColor: (exec.persona_color || '#6366f1') + '15' }}
        >
          {exec.persona_icon || '?'}
        </div>
        <span className="text-sm font-medium text-foreground/80 truncate">
          {exec.persona_name || 'Unknown'}
        </span>
      </div>

      {/* Status */}
      <div className="px-4 w-[20%]">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-sm font-medium ${badgeClass(status)}`}>
          {status.pulse && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
            </span>
          )}
          {status.label}
        </span>
      </div>

      {/* Duration */}
      <div className="px-4 w-[15%] text-right">
        <span className="text-sm text-muted-foreground/90 font-mono">
          {formatDuration(exec.duration_ms)}
        </span>
      </div>

      {/* Started */}
      <div className="px-4 w-[20%] text-right">
        <span className="text-sm text-muted-foreground/80">
          {formatRelativeTime(exec.started_at || exec.created_at)}
        </span>
      </div>

      {/* ID */}
      <div className="px-4 w-[20%] min-w-0">
        <span className="text-sm text-muted-foreground/60 font-mono truncate block">
          {exec.id.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}
