import { Play, Pause, Square, SkipBack, SkipForward, Keyboard, Repeat } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';

interface PlaybackControlsProps {
  currentTime: number;
  totalDuration: number;
  playing: boolean;
  looping: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onToggleLoop: () => void;
}

/** Format seconds to MM:SS.s */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export default function PlaybackControls({
  currentTime,
  totalDuration,
  playing,
  looping,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onToggleLoop,
}: PlaybackControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-t border-primary/15 bg-card/70">
      {/* Transport controls */}
      <div className="flex items-center gap-0.5 bg-secondary/30 rounded-lg border border-primary/10 p-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onSeek(Math.max(0, currentTime - 5))}
        >
          <SkipBack className="w-3.5 h-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onStop}
          title={t.media_studio.stop}
        >
          <Square className="w-3.5 h-3.5" />
        </Button>

        {/* Play / Pause — larger, accented */}
        {playing ? (
          <button
            onClick={onPause}
            title={t.media_studio.pause}
            className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center hover:bg-rose-500/30 transition-colors"
          >
            <Pause className="w-4 h-4 text-rose-400" />
          </button>
        ) : (
          <button
            onClick={onPlay}
            title={t.media_studio.play}
            className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center hover:bg-rose-500/30 transition-colors"
          >
            <Play className="w-4 h-4 text-rose-400 ml-0.5" />
          </button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onSeek(Math.min(totalDuration, currentTime + 5))}
        >
          <SkipForward className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Loop toggle */}
      <button
        onClick={onToggleLoop}
        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
          looping
            ? 'bg-rose-500/20 border border-rose-500/30 text-rose-400'
            : 'text-muted-foreground/40 hover:text-foreground/60 border border-transparent'
        }`}
        title="Loop"
      >
        <Repeat className="w-3.5 h-3.5" />
      </button>

      {/* Time display */}
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-secondary/20 border border-primary/10">
        <span className="text-sm font-mono text-rose-400 tabular-nums font-semibold">
          {formatTime(currentTime)}
        </span>
        <span className="text-xs text-muted-foreground/40">/</span>
        <span className="text-sm font-mono text-muted-foreground/60 tabular-nums">
          {formatTime(totalDuration)}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Keyboard shortcut hint */}
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground/30">
        <Keyboard className="w-3 h-3" />
        <span>Space / Del / Arrows</span>
      </div>
    </div>
  );
}
