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
import { SPEED_OPTIONS } from './ReplayHelpers';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

interface ReplayTransportControlsProps {
  isPlaying: boolean;
  speed: number;
  forkPoint: number | null;
  onTogglePlay: () => void;
  onStepBackward: () => void;
  onStepForward: () => void;
  onJumpToStart: () => void;
  onJumpToEnd: () => void;
  onSetSpeed: (speed: number) => void;
  onClearFork: () => void;
  onFork: () => void;
}

export function ReplayTransportControls({
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
}: ReplayTransportControlsProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<ChevronsLeft className="w-3.5 h-3.5" />}
        onClick={onJumpToStart}
        title={e.jump_to_start}
        className="text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/50"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<SkipBack className="w-3.5 h-3.5" />}
        onClick={onStepBackward}
        title={e.previous_step}
        className="text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/50"
      />
      <Button
        variant={isPlaying ? 'accent' : 'secondary'}
        size="icon-md"
        icon={isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        onClick={onTogglePlay}
        title={e.play_pause}
        className={isPlaying
          ? 'bg-blue-500/15 border-blue-500/25 text-blue-400'
          : 'bg-primary/10 border-primary/20 text-foreground/80 hover:bg-primary/15'
        }
      />
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<SkipForward className="w-3.5 h-3.5" />}
        onClick={onStepForward}
        title={e.next_step}
        className="text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/50"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<ChevronsRight className="w-3.5 h-3.5" />}
        onClick={onJumpToEnd}
        title={e.jump_to_end}
        className="text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/50"
      />

      {/* Speed selector */}
      <div className="ml-3 flex items-center gap-0.5 bg-secondary/30 rounded-lg border border-primary/10 p-0.5">
        {SPEED_OPTIONS.map((s) => (
          <Button
            key={s}
            variant={speed === s ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => onSetSpeed(s)}
            className={`font-mono ${
              speed === s
                ? 'bg-primary/15 text-foreground/90 border border-primary/20'
                : 'text-muted-foreground/50 hover:text-muted-foreground/80 border border-transparent'
            }`}
          >
            {s}x
          </Button>
        ))}
      </div>

      {/* Fork button */}
      {forkPoint != null && (
          <div
            className="animate-fade-slide-in ml-auto flex items-center gap-2"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              icon={<X className="w-3 h-3" />}
              onClick={onClearFork}
              title={e.clear_fork_point}
              className="text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/50"
            />
            <Button
              variant="accent"
              size="sm"
              icon={<GitFork className="w-3 h-3" />}
              onClick={onFork}
              className="bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/25"
            >
              Fork after step {forkPoint + 1}
            </Button>
          </div>
        )}
    </div>
  );
}
