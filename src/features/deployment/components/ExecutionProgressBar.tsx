import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Activity, Brain, Wrench, FileText, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecutionProgress {
  stage: string;
  percentEstimate: number | null;
  activeTool: string | null;
  message: string;
  toolCallsCompleted: number;
}

interface ProgressEvent {
  execution_id: string;
  progress: ExecutionProgress;
}

interface Props {
  executionId: string | null;
}

// ---------------------------------------------------------------------------
// Stage config
// ---------------------------------------------------------------------------

const STAGE_CONFIG: Record<string, { icon: typeof Activity; label: string; color: string }> = {
  initializing: { icon: Loader2, label: 'Initializing', color: 'text-blue-400' },
  thinking: { icon: Brain, label: 'Thinking', color: 'text-violet-400' },
  tool_calling: { icon: Wrench, label: 'Tool Call', color: 'text-amber-400' },
  tool_result: { icon: FileText, label: 'Processing Result', color: 'text-cyan-400' },
  generating: { icon: Activity, label: 'Generating', color: 'text-indigo-400' },
  completed: { icon: CheckCircle2, label: 'Completed', color: 'text-emerald-400' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-red-400' },
};

const STAGES_ORDER = ['initializing', 'thinking', 'tool_calling', 'generating', 'completed'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutionProgressBar({ executionId }: Props) {
  const [progress, setProgress] = useState<ExecutionProgress | null>(null);

  useEffect(() => {
    if (!executionId) { setProgress(null); return; }

    const unlisten = listen<ProgressEvent>('execution-progress', (event) => {
      if (event.payload.execution_id === executionId) {
        setProgress(event.payload.progress);
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [executionId]);

  if (!executionId || !progress) return null;

  const config = STAGE_CONFIG[progress.stage] ?? STAGE_CONFIG.thinking;
  const Icon = config.icon;
  const isAnimated = !['completed', 'failed'].includes(progress.stage);

  return (
    <div className="space-y-2 p-3 rounded-xl bg-secondary/30 border border-primary/10">
      {/* Stage pipeline */}
      <div className="flex items-center gap-1">
        {STAGES_ORDER.map((stage, idx) => {
          const stageIdx = STAGES_ORDER.indexOf(progress.stage);
          const isPast = idx < stageIdx;
          const isCurrent = stage === progress.stage;

          return (
            <div key={stage} className="flex items-center gap-1 flex-1">
              <div
                className={`h-1.5 flex-1 rounded-full transition-all ${
                  isPast ? 'bg-emerald-500' : isCurrent ? 'bg-indigo-500' : 'bg-secondary/50'
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* Current stage info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${config.color} ${isAnimated ? 'animate-pulse' : ''}`} />
          <span className={`text-sm font-medium ${config.color}`}>
            {config.label}
            {progress.activeTool && (
              <span className="text-muted-foreground/70 font-normal">: {progress.activeTool}</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground/70">
          {progress.toolCallsCompleted > 0 && (
            <span>{progress.toolCallsCompleted} tool calls</span>
          )}
          {progress.percentEstimate != null && (
            <span>{progress.percentEstimate}%</span>
          )}
        </div>
      </div>

      {progress.message && (
        <p className="text-xs text-muted-foreground/60 truncate">{progress.message}</p>
      )}
    </div>
  );
}
