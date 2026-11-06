import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  GitFork,
  FastForward,
  X,
} from 'lucide-react';
import { SPEED_OPTIONS } from '../libs/useReplayState';
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
  /**
   * Where a skip would land, or `null` when the playhead is not standing in a
   * recorded silence. The control is disabled on `null` rather than hidden:
   * a button that appears and vanishes as playback crosses a gap is harder to
   * hit than one that is always in the same place.
   */
  silenceSkipTarget: number | null;
  autoSkipSilence: boolean;
  onSkipSilence: () => void;
  onToggleAutoSkip: () => void;
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
  silenceSkipTarget,
  autoSkipSilence,
  onSkipSilence,
  onToggleAutoSkip,
}: ReplayTransportControlsProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<ChevronsLeft className="w-3.5 h-3.5" />}
        onClick={onJumpToStart}
        title={e.jump_to_start}
        className="text-ink-1 hover:text-ink-1 hover:bg-surface-2"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<SkipBack className="w-3.5 h-3.5" />}
        onClick={onStepBackward}
        title={e.previous_step}
        className="text-ink-1 hover:text-ink-1 hover:bg-surface-2"
      />
      <Button
        variant={isPlaying ? 'accent' : 'secondary'}
        size="icon-md"
        icon={isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        onClick={onTogglePlay}
        title={e.play_pause}
        className={isPlaying
          ? 'bg-status-info/15 border-status-info/25 text-status-info'
          : 'bg-surface-1 border-hair text-ink-1 hover:bg-primary/15'
        }
      />
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<SkipForward className="w-3.5 h-3.5" />}
        onClick={onStepForward}
        title={e.next_step}
        className="text-ink-1 hover:text-ink-1 hover:bg-surface-2"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<ChevronsRight className="w-3.5 h-3.5" />}
        onClick={onJumpToEnd}
        title={e.jump_to_end}
        className="text-ink-1 hover:text-ink-1 hover:bg-surface-2"
      />

      {/* SKIP SILENCE. Half of recorded runs spend at least 18% of their wall
          clock logging nothing, and the worst spend 89%; the scrubber has
          hatched those stretches for a while, but transport could only step
          tool boundaries, so 8x still crawled through them. The first button
          leaves the silence the playhead is in; the second makes playback do
          it on its own. */}
      <div className="ml-3 flex items-center gap-0.5 rounded-card border border-hair bg-surface-1 p-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          icon={<FastForward className="w-3.5 h-3.5" />}
          onClick={onSkipSilence}
          disabled={silenceSkipTarget == null}
          title={e.skip_silence}
          data-testid="replay-skip-silence"
          className="text-ink-1 hover:text-ink-1 hover:bg-surface-2"
        />
        <Button
          variant={autoSkipSilence ? 'secondary' : 'ghost'}
          size="xs"
          onClick={onToggleAutoSkip}
          aria-pressed={autoSkipSilence}
          title={e.skip_silence_auto}
          data-testid="replay-auto-skip-silence"
          className={autoSkipSilence
            ? 'bg-primary/15 text-ink-1 border border-hair'
            : 'text-ink-1 border border-transparent hover:text-ink-3'
          }
        >
          {e.skip_silence_auto_short}
        </Button>
      </div>

      {/* Speed selector */}
      <div className="ml-3 flex items-center gap-0.5 bg-surface-1 rounded-card border border-hair p-0.5">
        {SPEED_OPTIONS.map((s) => (
          <Button
            key={s}
            variant={speed === s ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => onSetSpeed(s)}
            className={`font-mono ${
              speed === s
                ? 'bg-primary/15 text-ink-1 border border-hair'
                : 'text-ink-1 hover:text-ink-3 border border-transparent'
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
              className="text-ink-1 hover:text-ink-3 hover:bg-surface-2"
            />
            <Button
              variant="accent"
              size="sm"
              icon={<GitFork className="w-3 h-3" />}
              onClick={onFork}
              className="bg-status-warning/15 text-status-warning border-status-warning/25 hover:bg-status-warning/25"
            >
              {tx(e.fork_after_step, { step: forkPoint })}
            </Button>
          </div>
        )}
    </div>
  );
}
