import { CircleDot } from 'lucide-react';
import type { DryRunNodeData } from '../../libs/debuggerTypes';

interface TimelineItem {
  id: string;
  name: string;
  role: string;
  data: DryRunNodeData | undefined;
  hasBreakpoint: boolean;
}

interface DebuggerStepViewProps {
  timeline: TimelineItem[];
  cycleNodeIds: Set<string>;
  onToggleBreakpoint: (id: string) => void;
  onInspect: (id: string) => void;
}

export default function DebuggerStepView({
  timeline,
  cycleNodeIds,
  onToggleBreakpoint,
  onInspect,
}: DebuggerStepViewProps) {
  return (
    <div className="flex items-center gap-1 ml-2">
      {timeline.map((item) => (
        <button
          key={item.id}
          onClick={() => onToggleBreakpoint(item.id)}
          onDoubleClick={() => {
            if (item.data?.input || item.data?.output) {
              onInspect(item.id);
            }
          }}
          className="relative group/dot"
          title={`${item.name} (${item.role})${item.hasBreakpoint ? ' [BREAKPOINT]' : ''}${cycleNodeIds.has(item.id) ? ' [CYCLE]' : ''}`}
        >
          <div
            className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
              item.data?.status === 'completed'
                ? 'bg-emerald-500 border-emerald-400'
                : item.data?.status === 'running'
                  ? 'bg-blue-500 border-blue-400 animate-pulse'
                  : item.data?.status === 'paused'
                    ? 'bg-amber-500 border-amber-400'
                    : item.data?.status === 'queued'
                      ? 'bg-secondary/60 border-primary/25'
                      : 'bg-secondary/40 border-primary/15'
            }`}
          />
          {item.hasBreakpoint && (
            <CircleDot className="absolute -top-1 -right-1 w-2.5 h-2.5 text-red-400" />
          )}
          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-sm font-mono rounded bg-background border border-primary/20 text-foreground whitespace-nowrap shadow-elevation-3 opacity-0 group-hover/dot:opacity-100 pointer-events-none transition-opacity z-50">
            {item.name}
          </div>
        </button>
      ))}
    </div>
  );
}
