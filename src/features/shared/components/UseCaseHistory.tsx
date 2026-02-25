import { useState, useEffect, useCallback } from 'react';
import { RotateCw, CheckCircle2, XCircle, AlertTriangle, Pause, Clock } from 'lucide-react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { listExecutionsForUseCase } from '@/api/executions';
import { formatRelativeTime, formatDuration } from '@/lib/utils/formatters';

const STATUS_ICONS: Record<string, { Icon: typeof CheckCircle2; className: string }> = {
  completed:  { Icon: CheckCircle2,  className: 'text-emerald-400' },
  failed:     { Icon: XCircle,       className: 'text-red-400' },
  cancelled:  { Icon: Pause,         className: 'text-amber-400' },
  incomplete: { Icon: AlertTriangle, className: 'text-orange-400' },
  running:    { Icon: Clock,         className: 'text-primary' },
  queued:     { Icon: Clock,         className: 'text-muted-foreground/60' },
};

interface UseCaseHistoryProps {
  personaId: string;
  useCaseId: string;
  onRerun: (inputData: string) => void;
  refreshKey?: number;
}

export function UseCaseHistory({ personaId, useCaseId, onRerun, refreshKey }: UseCaseHistoryProps) {
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listExecutionsForUseCase(personaId, useCaseId, 10);
      setExecutions(data);
    } catch {
      setExecutions([]);
    } finally {
      setLoading(false);
    }
  }, [personaId, useCaseId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, refreshKey]);

  if (loading) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground/50">
        Loading history...
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground/40">
        No executions yet for this use case.
      </div>
    );
  }

  return (
    <div className="divide-y divide-primary/5">
      {executions.map((exec) => {
        const statusInfo = (STATUS_ICONS[exec.status] ?? STATUS_ICONS.queued)!;
        const StatusIcon = statusInfo.Icon;
        const isExpanded = expandedId === exec.id;

        return (
          <div key={exec.id} className="px-4 py-2">
            <button
              onClick={() => setExpandedId(isExpanded ? null : exec.id)}
              className="w-full flex items-center gap-3 text-left"
            >
              <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusInfo.className}`} />
              <span className="text-sm text-foreground/80 font-medium capitalize w-20 flex-shrink-0">
                {exec.status}
              </span>
              <span className="text-sm text-muted-foreground/60 font-mono w-14 flex-shrink-0">
                {formatDuration(exec.duration_ms)}
              </span>
              <span className="text-sm text-muted-foreground/50 flex-1 truncate">
                {formatRelativeTime(exec.created_at)}
              </span>
              {exec.cost_usd > 0 && (
                <span className="text-sm text-muted-foreground/50 font-mono flex-shrink-0">
                  ${exec.cost_usd.toFixed(4)}
                </span>
              )}
              {exec.input_data && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRerun(exec.input_data!);
                  }}
                  className="p-1 rounded hover:bg-primary/10 text-muted-foreground/40 hover:text-primary/70 transition-colors flex-shrink-0"
                  title="Re-run with this input"
                >
                  <RotateCw className="w-3 h-3" />
                </button>
              )}
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="mt-2 ml-6 space-y-1.5 text-sm">
                {exec.input_data && (
                  <div>
                    <span className="text-muted-foreground/50 font-medium">Input: </span>
                    <code className="text-foreground/60 text-xs break-all">
                      {exec.input_data.length > 200 ? exec.input_data.slice(0, 200) + '...' : exec.input_data}
                    </code>
                  </div>
                )}
                {exec.error_message && (
                  <div>
                    <span className="text-red-400/70 font-medium">Error: </span>
                    <span className="text-red-400/60 text-xs">{exec.error_message}</span>
                  </div>
                )}
                {exec.output_data && (
                  <div>
                    <span className="text-muted-foreground/50 font-medium">Output: </span>
                    <code className="text-foreground/60 text-xs break-all">
                      {exec.output_data.length > 300 ? exec.output_data.slice(0, 300) + '...' : exec.output_data}
                    </code>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
