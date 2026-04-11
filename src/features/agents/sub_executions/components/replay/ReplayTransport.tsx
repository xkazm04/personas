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
import Button from '@/features/shared/components/buttons/Button';
import { SPEED_OPTIONS } from '../../libs/useReplayState';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="ghost" size="icon-sm" onClick={onJumpToStart} title={e.jump_to_start}>
        <ChevronsLeft className="w-3.5 h-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onStepBackward} title={e.previous_step}>
        <SkipBack className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant={isPlaying ? 'accent' : 'secondary'}
        accentColor={isPlaying ? 'blue' : undefined}
        size="icon-md"
        onClick={onTogglePlay}
        title={e.play_pause}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onStepForward} title={e.next_step}>
        <SkipForward className="w-3.5 h-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onJumpToEnd} title={e.jump_to_end}>
        <ChevronsRight className="w-3.5 h-3.5" />
      </Button>

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
            <Button variant="ghost" size="icon-sm" onClick={onClearFork} title={e.clear_fork_point}>
              <X className="w-3 h-3" />
            </Button>
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
