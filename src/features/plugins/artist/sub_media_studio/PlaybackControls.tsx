import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, SkipBack, SkipForward, Keyboard, Repeat } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { PlaybackEngine } from './hooks/useTimelinePlayback';

interface PlaybackControlsProps {
  engine: PlaybackEngine;
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
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * PlaybackControls subscribes to `engine` for the timecode readout — the
 * parent does not pass `currentTime` as a prop, so this component re-renders
 * only when the time we display changes, not the whole tree.
 */
export default function PlaybackControls({
  engine,
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
  const [displayTime, setDisplayTime] = useState(0);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    return engine.subscribe((time) => {
      // Throttle readout updates to ~10fps — the precision is tenths of a
      // second anyway and this keeps React work off the hot path.
      const now = performance.now();
      if (now - lastUpdateRef.current >= 90) {
        lastUpdateRef.current = now;
        setDisplayTime(time);
      }
    });
  }, [engine]);

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-t border-primary/15 bg-card/70">
      <div className="flex items-center gap-0.5 bg-secondary/30 rounded-lg border border-primary/10 p-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onSeek(Math.max(0, engine.getTime() - 5))}
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
          onClick={() => onSeek(Math.min(totalDuration, engine.getTime() + 5))}
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
          {formatTime(displayTime)}
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
