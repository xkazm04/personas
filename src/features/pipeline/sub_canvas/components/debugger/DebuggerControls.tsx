import {
  Play,
  Pause,
  SkipForward,
  Square,
  CircleDot,
  ChevronUp,
  Bug,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface DebuggerControlsProps {
  paused: boolean;
  isFinished: boolean;
  isStarted: boolean;
  stepIndex: number;
  totalSteps: number;
  breakpointCount: number;
  inspectedNode: string | null;
  panelCollapsed: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStepForward: () => void;
  onStop: () => void;
  onExpandInspector: () => void;
}

export default function DebuggerControls({
  paused,
  isFinished,
  isStarted,
  stepIndex,
  totalSteps,
  breakpointCount,
  inspectedNode,
  panelCollapsed,
  onPlay,
  onPause,
  onStepForward,
  onStop,
  onExpandInspector,
}: DebuggerControlsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Debug badge */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-card bg-amber-500/15 border border-amber-500/25">
        <Bug className="w-3.5 h-3.5 text-amber-400" />
        <span className="typo-heading font-semibold text-amber-300 uppercase tracking-wider">{t.pipeline.dry_run_label}</span>
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-1">
        {!isFinished && !paused ? (
          <button
            onClick={onPause}
            className="p-1.5 rounded-card bg-amber-500/15 border border-amber-500/25 text-amber-300 hover:bg-amber-500/25 transition-colors"
            title={t.pipeline.pause}
          >
            <Pause className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={onPlay}
            disabled={isFinished}
            className="p-1.5 rounded-card bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={isStarted ? t.pipeline.continue_label : t.pipeline.start}
          >
            <Play className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={onStepForward}
          disabled={isFinished}
          className="p-1.5 rounded-card bg-blue-500/15 border border-blue-500/25 text-blue-300 hover:bg-blue-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={t.pipeline.step_forward}
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          onClick={onStop}
          className="p-1.5 rounded-card bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors"
          title={t.pipeline.stop_dry_run}
        >
          <Square className="w-4 h-4" />
        </button>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-2 typo-code font-mono text-foreground">
        <span>Step {Math.max(0, stepIndex + 1)} / {totalSteps}</span>
        {isFinished && <span className="text-emerald-400">{t.pipeline.complete_label}</span>}
        {paused && isStarted && !isFinished && <span className="text-amber-400">{t.pipeline.paused}</span>}
      </div>

      {/* Spacer is handled by parent */}

      {/* Collapse toggle for inspector */}
      {inspectedNode && panelCollapsed && (
        <button
          onClick={onExpandInspector}
          className="flex items-center gap-1 px-2 py-1 rounded-card bg-primary/5 border border-primary/10 text-foreground hover:text-foreground/80 transition-colors typo-body"
        >
          <ChevronUp className="w-3 h-3" />
          {t.pipeline.inspector}
        </button>
      )}

      {/* Breakpoint count */}
      {breakpointCount > 0 && (
        <span className="flex items-center gap-1 typo-code font-mono text-red-400/80">
          <CircleDot className="w-3 h-3" />
          {breakpointCount} breakpoint{breakpointCount !== 1 ? 's' : ''}
        </span>
      )}
    </>
  );
}
