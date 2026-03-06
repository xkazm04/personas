import { memo, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, X, Gauge, Calendar, History,
  Loader2, ChevronRight, SkipBack,
} from 'lucide-react';
import type { TimeRange, PlaybackSpeed, TimelineReplayState } from '@/hooks/realtime/useTimelineReplay';

// ── Types ──────────────────────────────────────────────────────────

interface Props extends TimelineReplayState {
  onEnterReplay: (range: TimeRange) => Promise<void>;
  onExitReplay: () => void;
  onTogglePlay: () => void;
  onSetSpeed: (s: PlaybackSpeed) => void;
  onSeek: (fraction: number) => void;
}

// ── Constants ──────────────────────────────────────────────────────

const SPEEDS: PlaybackSpeed[] = [2, 4, 8, 16, 32, 64];
const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '1d', label: '24h' },
  { value: '7d', label: '7 days' },
];

// ── Helpers ────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${month}/${day} ${formatTimestamp(ms)}`;
}

// ── Inactive State (Replay Entry) ──────────────────────────────────

const ReplayEntryBar = memo(function ReplayEntryBar({
  loading,
  onEnterReplay,
}: {
  loading: boolean;
  onEnterReplay: (range: TimeRange) => Promise<void>;
}) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2.5 bg-gradient-to-r from-background/90 via-secondary/30 to-background/90 border-t border-primary/10">
      <History className="w-3.5 h-3.5 text-muted-foreground/50" />
      <span className="text-sm text-muted-foreground/60 font-medium tracking-wide">
        REPLAY
      </span>
      <div className="w-px h-4 bg-primary/10" />
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          disabled={loading}
          onClick={() => onEnterReplay(opt.value)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-xl bg-primary/5 border border-primary/10 text-muted-foreground/70 hover:text-foreground/80 hover:bg-primary/10 hover:border-primary/20 transition-all active:scale-[0.97] disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Calendar className="w-3 h-3" />
          )}
          Last {opt.label}
        </button>
      ))}
    </div>
  );
});

// ── Active Timeline Bar ────────────────────────────────────────────

const ActiveTimelineBar = memo(function ActiveTimelineBar({
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
      if (e.buttons !== 1) return; // only left button
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
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex flex-col bg-gradient-to-r from-background via-secondary/20 to-background border-t border-cyan-500/15"
    >
      {/* ── Scrubber Track ── */}
      <div
        ref={trackRef}
        className="relative h-1.5 w-full cursor-pointer group"
        role="slider"
        tabIndex={0}
        aria-label="Timeline position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        onClick={handleTrackClick}
        onMouseMove={handleTrackDrag}
        onKeyDown={handleSliderKeyDown}
      >
        {/* Track background */}
        <div className="absolute inset-0 bg-primary/5" />

        {/* Event density markers */}
        <EventDensityMarkers
          timestamps={eventTimestamps}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
        />

        {/* Progress fill */}
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-500/50 to-purple-500/50 transition-[width] duration-75"
          style={{ width: `${fraction * 100}%` }}
        />

        {/* Playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.5)] border border-cyan-300/50 transition-[left] duration-75 group-hover:scale-125"
          style={{ left: `calc(${fraction * 100}% - 6px)` }}
        />
      </div>

      {/* ── Controls row ── */}
      <div className="flex items-center gap-2 px-4 py-2">
        {/* Play/Pause */}
        <button
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all active:scale-[0.93]"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
        </button>

        {/* Reset */}
        <button
          onClick={() => onSeek(0)}
          aria-label="Reset timeline"
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/5 border border-primary/10 text-muted-foreground/50 hover:text-foreground/70 hover:bg-primary/10 transition-all active:scale-[0.93]"
          title="Reset to start"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-primary/10" />

        {/* Speed selector */}
        <button
          onClick={cycleSpeed}
          aria-label="Cycle playback speed"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-500/8 border border-purple-500/15 text-purple-300/80 hover:bg-purple-500/15 transition-all text-sm font-bold tracking-wide active:scale-[0.97]"
          title="Cycle playback speed"
        >
          <Gauge className="w-3 h-3" />
          <span aria-live="polite">{speed}x</span>
        </button>

        <div className="w-px h-5 bg-primary/10" />

        {/* Time indicator */}
        <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground/60">
          <span className="text-foreground/70">{formatDate(cursorTime)}</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
          <span>{formatDate(rangeEnd)}</span>
        </div>

        <div className="flex-1" />

        {/* Event counter */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/5 border border-primary/8">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/60" />
          <span className="text-sm font-bold text-foreground/60">
            {emittedCount}
          </span>
          <span className="text-sm text-muted-foreground/40">/</span>
          <span className="text-sm text-muted-foreground/50">
            {totalEventCount}
          </span>
          <span className="text-sm text-muted-foreground/40 ml-0.5">events</span>
        </div>

        {/* Range badge */}
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/8 text-sm text-muted-foreground/50 font-bold tracking-wider">
          <History className="w-3 h-3" />
          {range === '1d' ? '24H' : '7D'}
        </div>

        {/* Exit replay */}
        <button
          onClick={onExitReplay}
          aria-label="Exit replay"
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400/60 hover:text-red-400 hover:bg-red-500/15 transition-all active:scale-[0.93]"
          title="Exit replay"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
});

// ── Constants (density) ─────────────────────────────────────────────

const DENSITY_BINS = 60;
const MIN_OPACITY = 0.1;
const MAX_OPACITY = 0.4;

// ── Event Density Markers (visual hint of where events cluster) ────

const EventDensityMarkers = memo(function EventDensityMarkers({
  timestamps,
  rangeStart,
  rangeEnd,
}: {
  timestamps: number[];
  rangeStart: number;
  rangeEnd: number;
}) {
  const bins = useMemo(() => {
    const span = rangeEnd - rangeStart;
    if (span <= 0 || timestamps.length === 0) return null;

    const counts = new Uint32Array(DENSITY_BINS);
    const binWidth = span / DENSITY_BINS;
    for (const ts of timestamps) {
      const idx = Math.min(Math.floor((ts - rangeStart) / binWidth), DENSITY_BINS - 1);
      if (idx >= 0) counts[idx] = (counts[idx] ?? 0) + 1;
    }

    let max = 0;
    for (let i = 0; i < DENSITY_BINS; i++) {
      if (counts[i]! > max) max = counts[i]!;
    }
    if (max === 0) return null;

    const opacities = new Float32Array(DENSITY_BINS);
    for (let i = 0; i < DENSITY_BINS; i++) {
      opacities[i] = counts[i]! > 0
        ? MIN_OPACITY + (counts[i]! / max) * (MAX_OPACITY - MIN_OPACITY)
        : 0;
    }
    return opacities;
  }, [timestamps, rangeStart, rangeEnd]);

  if (!bins) return null;

  return (
    <div className="absolute inset-0 flex" aria-hidden="true">
      {Array.from(bins, (opacity, i) => (
        <div
          key={i}
          className="flex-1 bg-cyan-400"
          style={{ opacity }}
        />
      ))}
    </div>
  );
});

// ── Main Export ────────────────────────────────────────────────────

export default function TimelinePlayer(props: Props) {
  return (
    <AnimatePresence mode="wait">
      {props.active ? (
        <ActiveTimelineBar key="active" {...props} />
      ) : (
        <ReplayEntryBar
          key="entry"
          loading={props.loading}
          onEnterReplay={props.onEnterReplay}
        />
      )}
    </AnimatePresence>
  );
}
