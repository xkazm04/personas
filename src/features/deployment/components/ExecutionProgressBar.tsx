import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Activity, Brain, Wrench, FileText, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

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

const STAGE_ICONS: Record<string, { icon: typeof Activity; labelKey: string; color: string }> = {
  initializing: { icon: Loader2, labelKey: 'stage_initializing', color: 'text-blue-400' },
  thinking: { icon: Brain, labelKey: 'stage_thinking', color: 'text-violet-400' },
  tool_calling: { icon: Wrench, labelKey: 'stage_tool_calling', color: 'text-amber-400' },
  tool_result: { icon: FileText, labelKey: 'stage_processing_result', color: 'text-cyan-400' },
  generating: { icon: Activity, labelKey: 'stage_generating', color: 'text-indigo-400' },
  completed: { icon: CheckCircle2, labelKey: 'stage_completed', color: 'text-emerald-400' },
  failed: { icon: XCircle, labelKey: 'stage_failed', color: 'text-red-400' },
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

  const { t, tx } = useTranslation();
  const dt = t.deployment.dashboard;

  if (!executionId || !progress) return null;

  const stageEntry = STAGE_ICONS[progress.stage] ?? STAGE_ICONS.thinking!;
  const Icon = stageEntry!.icon;
  const stageLabel = (dt as Record<string, string>)[stageEntry!.labelKey] ?? progress.stage;
  const stageColor = stageEntry!.color;
  const isAnimated = !['completed', 'failed'].includes(progress.stage);

  return (
    <div className="space-y-2 p-3 rounded-modal bg-secondary/30 border border-primary/10">
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
          <Icon className={`w-4 h-4 ${stageColor} ${isAnimated ? 'animate-pulse' : ''}`} />
          <span className={`typo-body font-medium ${stageColor}`}>
            {stageLabel}
            {progress.activeTool && (
              <span className="text-foreground font-normal">: {progress.activeTool}</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3 typo-caption text-foreground">
          {progress.toolCallsCompleted > 0 && (
            <span>{tx(dt.tool_calls, { count: progress.toolCallsCompleted })}</span>
          )}
          {progress.percentEstimate != null && (
            <span>{progress.percentEstimate}%</span>
          )}
        </div>
      </div>

      {progress.message && (
        <p className="typo-caption text-foreground truncate">{progress.message}</p>
      )}
    </div>
  );
}
