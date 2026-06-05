import { useState } from 'react';
import { Play, Info, Bug } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

interface NodeStatus {
  member_id: string;
  status: string;
  persona_id?: string;
  error?: string;
}

interface PipelineControlsProps {
  teamId: string;
  isRunning: boolean;
  isDryRunActive: boolean;
  nodeStatuses: NodeStatus[];
  onExecute: () => void;
  onDryRun: () => void;
  agentNames?: Record<string, string>;
}

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-gray-500',
  queued: 'bg-amber-500',
  running: 'bg-blue-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
};

function getProgressText(statuses: NodeStatus[]): string {
  if (statuses.length === 0) return 'No agents in pipeline';

  const completed = statuses.filter((s) => s.status === 'completed').length;
  const failed = statuses.filter((s) => s.status === 'failed').length;
  const running = statuses.filter((s) => s.status === 'running').length;
  const total = statuses.length;

  if (failed > 0 && running === 0) {
    return `Pipeline failed at step ${completed + failed} of ${total}`;
  }
  if (completed === total) {
    return 'Pipeline completed';
  }
  if (running > 0) {
    return `Step ${completed + 1} of ${total}`;
  }
  return 'Ready to execute';
}

export default function PipelineControls({
  teamId: _teamId,
  isRunning,
  isDryRunActive,
  nodeStatuses,
  onExecute,
  onDryRun,
  agentNames = {},
}: PipelineControlsProps) {
  const { t } = useTranslation();
  const [hoveredDot, setHoveredDot] = useState<string | null>(null);

  const allCompleted =
    nodeStatuses.length > 0 &&
    nodeStatuses.every((s) => s.status === 'completed');
  const hasFailed =
    nodeStatuses.length > 0 &&
    nodeStatuses.some((s) => s.status === 'failed');

  const progressText = getProgressText(nodeStatuses);

  return (
    <div className="sticky bottom-0 z-20 bg-secondary/70 backdrop-blur-lg border-t border-border/30 px-3 py-2">
      <div className="flex items-center gap-4">
        {/* Execute button */}
        <button
          onClick={onExecute}
          disabled={isRunning || isDryRunActive}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-body font-medium transition-all ${
            isRunning || isDryRunActive
              ? 'bg-primary/10 text-foreground cursor-not-allowed'
              : 'bg-indigo-500 text-foreground hover:bg-indigo-600 active:scale-95'
          }`}
        >
          {isRunning ? (
            <>
              <LoadingSpinner />
              {t.pipeline.running}
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {t.pipeline.execute}
            </>
          )}
        </button>

        {/* Dry Run button */}
        <button
          onClick={onDryRun}
          disabled={isRunning || isDryRunActive}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-body font-medium transition-all ${
            isRunning || isDryRunActive
              ? 'bg-primary/10 text-foreground cursor-not-allowed'
              : 'bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 active:scale-95'
          }`}
        >
          <Bug className="w-4 h-4" />
          {t.pipeline.dry_run}
        </button>

        {/* Node status dots */}
        {nodeStatuses.length > 0 && (
          <div className="flex items-center gap-1.5">
            {nodeStatuses.map((ns) => (
              <div
                key={ns.member_id}
                className="relative"
                onMouseEnter={() => setHoveredDot(ns.member_id)}
                onMouseLeave={() => setHoveredDot(null)}
              >
                <div
                  className={`w-3 h-3 rounded-full transition-colors ${
                    STATUS_COLORS[ns.status] || STATUS_COLORS.idle
                  } ${ns.status === 'running' ? 'animate-pulse' : ''}`}
                />
                {hoveredDot === ns.member_id && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 typo-code font-mono rounded bg-background border border-primary/20 text-foreground whitespace-nowrap shadow-elevation-3 z-50 pointer-events-none">
                    {agentNames[ns.member_id] || 'Agent'}
                    {' -- '}
                    <span className={ns.status === 'failed' ? 'text-red-400' : ns.status === 'completed' ? 'text-emerald-400' : ns.status === 'running' ? 'text-blue-400' : ''}>{ns.status}</span>
                    {ns.error && (
                      <span className="text-red-400 block">{ns.error}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Progress text */}
        <span
          className={`typo-body font-medium ${
            hasFailed
              ? 'text-red-400'
              : allCompleted
                ? 'text-emerald-400'
                : 'text-foreground'
          }`}
        >
          {progressText}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Honest status: pipeline runs until completion */}
        {isRunning && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-body font-medium bg-primary/5 text-foreground border border-primary/10">
            <Info className="w-3 h-3" />
            {t.pipeline.runs_until_completion}
          </span>
        )}
      </div>
    </div>
  );
}
