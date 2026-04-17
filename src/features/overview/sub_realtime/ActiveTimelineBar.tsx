import { memo, useCallback, useMemo, useRef } from 'react';
import {
  Play, Pause, X, Gauge, History,
  ChevronRight, SkipBack,
} from 'lucide-react';
import type { TimeRange, PlaybackSpeed, TimelineReplayState } from '@/hooks/realtime/useTimelineReplay';
import { SPEEDS, formatDate } from './timelinePlayerHelpers';
import { EventDensityMarkers } from './EventDensityMarkers';
import { useTranslation } from '@/i18n/useTranslation';

interface Props extends TimelineReplayState {
  onEnterReplay: (range: TimeRange) => Promise<void>;
  onExitReplay: () => void;
  onTogglePlay: () => void;
  onSetSpeed: (s: PlaybackSpeed) => void;
  onSeek: (fraction: number) => void;
}

export const ActiveTimelineBar = memo(function ActiveTimelineBar({
  playing,
  speed,
  cursorMs,
  totalMs,
  rangeStart,
  rangeEnd,
  totalEventCount,
  emittedCount,
  range,
  historicalEvents,
  onTogglePlay,
  onSetSpeed,
  onSeek,
  onExitReplay,
}: Props) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const fraction = totalMs > 0 ? cursorMs / totalMs : 0;
  const percent = Math.round(fraction * 100);

  const eventTimestamps = useMemo(
    () => historicalEvents.map((e) => new Date(e.created_at).getTime()),
    [historicalEvents],
  );

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      onSeek(x / rect.width);
    },
    [onSeek],
  );

  const handleTrackDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.buttons !== 1) return;
      handleTrackClick(e);
    },
    [handleTrackClick],
  );

  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length]!;
    onSetSpeed(next);
  }, [speed, onSetSpeed]);

  const handleSliderKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 0.01;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        onSeek(Math.max(0, fraction - step));
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        onSeek(Math.min(1, fraction + step));
        break;
      case 'Home':
        e.preventDefault();
        onSeek(0);
        break;
      case 'End':
        e.preventDefault();
        onSeek(1);
        break;
      default:
        break;
    }
  }, [fraction, onSeek]);

  const cursorTime = rangeStart + cursorMs;

  return (
    <div
      className="animate-fade-slide-in flex flex-col bg-gradient-to-r from-background via-secondary/20 to-background border-t border-cyan-500/15"
    >
      {/* Scrubber Track */}
      <div
        ref={trackRef}
        className="relative h-1.5 w-full cursor-pointer group"
        role="slider"
        tabIndex={0}
        aria-label={t.overview.realtime_page.reset_to_start}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        onClick={handleTrackClick}
        onMouseMove={handleTrackDrag}
        onKeyDown={handleSliderKeyDown}
      >
        <div className="absolute inset-0 bg-primary/5" />
        <EventDensityMarkers
          timestamps={eventTimestamps}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
        />
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-500/50 to-purple-500/50 transition-[width] duration-75"
          style={{ width: `${fraction * 100}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.5)] border border-cyan-300/50 transition-[left] duration-75 group-hover:scale-125"
          style={{ left: `calc(${fraction * 100}% - 6px)` }}
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          className="flex items-center justify-center w-7 h-7 rounded-card bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all active:scale-[0.93]"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
        </button>

        <button
          onClick={() => onSeek(0)}
          aria-label={t.overview.realtime_page.reset_to_start}
          className="flex items-center justify-center w-7 h-7 rounded-card bg-primary/5 border border-primary/10 text-foreground hover:text-foreground/70 hover:bg-primary/10 transition-all active:scale-[0.93]"
          title={t.overview.realtime_page.reset_to_start}
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-primary/10" />

        <button
          onClick={cycleSpeed}
          aria-label={t.overview.realtime_page.cycle_speed}
          className="flex items-center gap-1 px-2 py-1 rounded-card bg-purple-500/8 border border-purple-500/15 text-purple-300/80 hover:bg-purple-500/15 transition-all typo-heading font-bold tracking-wide active:scale-[0.97]"
          title={t.overview.realtime_page.cycle_speed}
        >
          <Gauge className="w-3 h-3" />
          <span aria-live="polite">{speed}x</span>
        </button>

        <div className="w-px h-5 bg-primary/10" />

        <div className="flex items-center gap-2 typo-code font-mono text-foreground">
          <span className="text-foreground">{formatDate(cursorTime)}</span>
          <ChevronRight className="w-3 h-3 text-foreground" />
          <span>{formatDate(rangeEnd)}</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-card bg-primary/5 border border-primary/8">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/60" />
          <span className="typo-heading font-bold text-foreground">{emittedCount}</span>
          <span className="typo-body text-foreground">/</span>
          <span className="typo-body text-foreground">{totalEventCount}</span>
          <span className="typo-body text-foreground ml-0.5">events</span>
        </div>

        <div className="flex items-center gap-1 px-2 py-1 rounded-card bg-secondary/30 border border-primary/8 typo-heading text-foreground font-bold tracking-wider">
          <History className="w-3 h-3" />
          {range === '1d' ? '24H' : '7D'}
        </div>

        <button
          onClick={onExitReplay}
          aria-label={t.overview.realtime_page.exit_replay}
          className="flex items-center justify-center w-7 h-7 rounded-card bg-red-500/8 border border-red-500/15 text-red-400/60 hover:text-red-400 hover:bg-red-500/15 transition-all active:scale-[0.93]"
          title={t.overview.realtime_page.exit_replay}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});
