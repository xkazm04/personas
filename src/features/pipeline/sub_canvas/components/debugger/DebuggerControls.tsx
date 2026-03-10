import {
  Play,
  Pause,
  SkipForward,
  Square,
  CircleDot,
  ChevronUp,
  Bug,
} from 'lucide-react';

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
  return (
    <>
      {/* Debug badge */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/25">
        <Bug className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-sm font-semibold text-amber-300 uppercase tracking-wider">Dry Run</span>
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-1">
        {!isFinished && !paused ? (
          <button
            onClick={onPause}
            className="p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-300 hover:bg-amber-500/25 transition-colors"
            title="Pause"
          >
            <Pause className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={onPlay}
            disabled={isFinished}
            className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={isStarted ? 'Continue' : 'Start'}
          >
            <Play className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={onStepForward}
          disabled={isFinished}
          className="p-1.5 rounded-lg bg-blue-500/15 border border-blue-500/25 text-blue-300 hover:bg-blue-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Step Forward"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          onClick={onStop}
          className="p-1.5 rounded-lg bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors"
          title="Stop Dry Run"
        >
          <Square className="w-4 h-4" />
        </button>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground/80">
        <span>Step {Math.max(0, stepIndex + 1)} / {totalSteps}</span>
        {isFinished && <span className="text-emerald-400">Complete</span>}
        {paused && isStarted && !isFinished && <span className="text-amber-400">Paused</span>}
      </div>

      {/* Spacer is handled by parent */}

      {/* Collapse toggle for inspector */}
      {inspectedNode && panelCollapsed && (
        <button
          onClick={onExpandInspector}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/5 border border-primary/10 text-muted-foreground/80 hover:text-foreground/80 transition-colors text-sm"
        >
          <ChevronUp className="w-3 h-3" />
          Inspector
        </button>
      )}

      {/* Breakpoint count */}
      {breakpointCount > 0 && (
        <span className="flex items-center gap-1 text-sm font-mono text-red-400/80">
          <CircleDot className="w-3 h-3" />
          {breakpointCount} breakpoint{breakpointCount !== 1 ? 's' : ''}
        </span>
      )}
    </>
  );
}
