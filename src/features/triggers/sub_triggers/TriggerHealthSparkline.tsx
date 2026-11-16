import { useState, useMemo } from 'react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { formatDuration, formatTimestamp } from '@/lib/utils/formatters';

interface TriggerHealthSparklineProps {
  executions: PersonaExecution[];
}

type DotStatus = 'success' | 'failure' | 'pending';

interface DotData {
  id: string;
  status: DotStatus;
  timestamp: string | null;
  durationMs: number | null;
}

function getDotStatus(status: string): DotStatus {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'failure';
  return 'pending';
}

const DOT_COLORS: Record<DotStatus, string> = {
  success: 'bg-status-success',
  failure: 'bg-status-error',
  pending: 'bg-surface-2',
};

const DOT_HOVER_COLORS: Record<DotStatus, string> = {
  success: 'bg-status-success',
  failure: 'bg-status-error',
  pending: 'bg-surface-2',
};

function Dot({ dot }: { dot: DotData }) {
  const [hovered, setHovered] = useState(false);

  const color = hovered ? DOT_HOVER_COLORS[dot.status] : DOT_COLORS[dot.status];

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`w-2 h-2 rounded-full ${color} transition-colors duration-100`}
      />
      {hovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 pointer-events-none">
          <div className="px-2 py-1 rounded-input bg-surface-2 border border-hair shadow-elevation-3 typo-caption whitespace-nowrap">
            <div className="text-ink-1">
              {dot.timestamp ? formatTimestamp(dot.timestamp) : 'No timestamp'}
            </div>
            <div className="text-ink-1">
              {formatDuration(dot.durationMs)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TriggerHealthSparkline({ executions }: TriggerHealthSparklineProps) {
  const dots = useMemo<DotData[]>(() => {
    // Take last 20 executions (most recent first), then reverse so oldest is left
    const recent = executions.slice(0, 20);
    return [...recent].reverse().map((exec) => ({
      id: exec.id,
      status: getDotStatus(exec.status),
      timestamp: exec.started_at,
      durationMs: exec.duration_ms,
    }));
  }, [executions]);

  if (dots.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-card bg-background/30 border border-hair">
      {dots.map((dot) => (
        <Dot key={dot.id} dot={dot} />
      ))}
    </div>
  );
}
