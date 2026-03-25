import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  GitFork,
  X,
} from 'lucide-react';
import { SPEED_OPTIONS } from '../../libs/useReplayState';

interface ReplayTransportProps {
  isPlaying: boolean;
  speed: number;
  forkPoint: number | null;
  onTogglePlay: () => void;
  onStepBackward: () => void;
  onStepForward: () => void;
  onJumpToStart: () => void;
  onJumpToEnd: () => void;
  onSetSpeed: (s: number) => void;
  onClearFork: () => void;
  onFork: () => void;
}

/** Playback transport bar (play/pause, step, speed, fork). */
export function ReplayTransport({
  isPlaying,
  speed,
  forkPoint,
  onTogglePlay,
  onStepBackward,
  onStepForward,
  onJumpToStart,
  onJumpToEnd,
  onSetSpeed,
  onClearFork,
  onFork,
}: ReplayTransportProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onJumpToStart} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors" title="Jump to start (Home)">
        <ChevronsLeft className="w-3.5 h-3.5" />
      </button>
      <button onClick={onStepBackward} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors" title="Previous step (Shift+Left)">
        <SkipBack className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onTogglePlay}
        className={`p-2 rounded-xl border transition-all ${
          isPlaying
            ? 'bg-blue-500/15 border-blue-500/25 text-blue-400'
            : 'bg-primary/10 border-primary/20 text-foreground/80 hover:bg-primary/15'
        }`}
        title="Play/Pause (Space)"
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button onClick={onStepForward} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors" title="Next step (Shift+Right)">
        <SkipForward className="w-3.5 h-3.5" />
      </button>
      <button onClick={onJumpToEnd} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors" title="Jump to end (End)">
        <ChevronsRight className="w-3.5 h-3.5" />
      </button>

      {/* Speed selector */}
      <div className="ml-3 flex items-center gap-0.5 bg-secondary/30 rounded-lg border border-primary/10 p-0.5">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSetSpeed(s)}
            className={`px-2 py-0.5 typo-code rounded-lg transition-colors ${
              speed === s
                ? 'bg-primary/15 text-foreground/90 border border-primary/20'
                : 'text-muted-foreground/50 hover:text-muted-foreground/80 border border-transparent'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Fork button */}
      {forkPoint != null && (
          <div
            className="animate-fade-slide-in ml-auto flex items-center gap-2"
          >
            <button
              onClick={onClearFork}
              className="p-1 rounded-lg hover:bg-secondary/50 text-muted-foreground/40 hover:text-muted-foreground"
              title="Clear fork point"
            >
              <X className="w-3 h-3" />
            </button>
            <button
              onClick={onFork}
              className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
            >
              <GitFork className="w-3 h-3" />
              Fork after step {forkPoint + 1}
            </button>
          </div>
        )}
    </div>
  );
}
