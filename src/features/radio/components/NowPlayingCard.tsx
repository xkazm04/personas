import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { NowPlaying } from '@/lib/bindings/NowPlaying';
import type { PlayStatus } from '@/lib/bindings/PlayStatus';
import type { StreamMetadata } from '@/lib/bindings/StreamMetadata';
import EqualizerBars from './EqualizerBars';

interface NowPlayingCardProps {
  nowPlaying: NowPlaying;
  status: PlayStatus;
  isYoutube: boolean;
  progress: { currentSec: number; durationSec: number } | null;
  currentTrackIndex: number | null;
  streamMetadata: StreamMetadata | null;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, Math.floor(sec % 60));
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Expanded "now playing" card anchored above the footer title segment.
 * Click-outside / Escape close. Centered on the title's centre, 360px
 * wide. For `youtubeTracks` stations the full tracklist renders with
 * the current track highlighted; for `stream` stations the description
 * and source link take its place.
 */
export default function NowPlayingCard({
  nowPlaying,
  status,
  isYoutube,
  progress,
  currentTrackIndex,
  streamMetadata,
  onTogglePlay,
  onPrev,
  onNext,
  onClose,
}: NowPlayingCardProps) {
  const isPlaying = status === 'playing' || status === 'buffering';
  const isBuffering = status === 'buffering';

  // YouTube provides a 320×180 thumbnail at the mqdefault URL for every
  // public video. We reset the failed flag on track change so a working
  // next track gets a fresh attempt — the first thumbnail load might
  // have failed but the next videoId could be fine.
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => {
    setThumbFailed(false);
  }, [nowPlaying.track?.videoId]);
  const thumbUrl =
    nowPlaying.track && !thumbFailed
      ? `https://i.ytimg.com/vi/${nowPlaying.track.videoId}/mqdefault.jpg`
      : null;
  const { t, tx } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const accent = nowPlaying.station.accentColor;
  const tracks =
    nowPlaying.station.source.kind === 'youtubeTracks'
      ? nowPlaying.station.source.tracks
      : [];

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t.radio.now_playing}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[360px] rounded-modal border border-primary/10 bg-background shadow-elevation-3 overflow-hidden"
    >
      <div
        className="px-4 py-3 flex items-center justify-between gap-3"
        style={{ background: `linear-gradient(135deg, ${accent}25, transparent 70%)` }}
      >
        <div className="min-w-0">
          <p className="typo-caption text-foreground/55 uppercase tracking-wide">
            {t.radio.now_playing}
          </p>
          <p className="typo-body font-medium text-foreground truncate">
            {nowPlaying.station.name}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-interactive flex items-center justify-center text-foreground/70 hover:bg-secondary/40 transition-colors shrink-0"
          aria-label={t.radio.collapse}
          title={t.radio.collapse}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 border-t border-primary/8">
        <div className="flex items-center gap-3 min-w-0">
          {thumbUrl && (
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              className="w-20 aspect-video rounded-input object-cover shrink-0 bg-secondary/30"
              onError={() => setThumbFailed(true)}
            />
          )}
          <div className="min-w-0 flex-1">
            {nowPlaying.track ? (
              <>
                <p className="typo-body font-medium text-foreground truncate">
                  {nowPlaying.track.title}
                </p>
                <p className="typo-caption text-foreground/70 truncate">
                  {nowPlaying.track.artist}
                </p>
              </>
            ) : streamMetadata ? (
              <>
                <p className="typo-body font-medium text-foreground truncate">
                  {streamMetadata.title}
                </p>
                <p className="typo-caption text-foreground/70 truncate">
                  {streamMetadata.artist}
                </p>
              </>
            ) : (
              <p className="typo-body text-foreground/80 leading-relaxed">
                {nowPlaying.station.description}
              </p>
            )}
          </div>
        </div>

        {isYoutube && progress && progress.durationSec > 0 && (
          <div>
            <div className="h-1 rounded-full bg-foreground/10 overflow-hidden">
              <div
                className="h-full transition-[width] duration-1000 ease-linear"
                style={{
                  width: `${Math.min(100, (progress.currentSec / progress.durationSec) * 100)}%`,
                  background: accent,
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1 typo-caption text-foreground/55 tabular-nums">
              <span>{formatTime(progress.currentSec)}</span>
              <span>{formatTime(progress.durationSec)}</span>
            </div>
          </div>
        )}

        {!isYoutube && <EqualizerBars accentColor={accent} isPlaying={isPlaying} />}

        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={!isYoutube}
            className="w-8 h-8 rounded-interactive flex items-center justify-center text-foreground/80 hover:bg-secondary/40 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            aria-label={t.radio.prev_track}
            title={isYoutube ? t.radio.prev_track : t.radio.prev_track_disabled}
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-foreground transition-transform hover:scale-105 ${
              isBuffering ? 'animate-pulse' : ''
            }`}
            style={{ background: accent }}
            aria-label={isPlaying ? t.radio.pause : t.radio.play}
            title={isBuffering ? t.radio.buffering : isPlaying ? t.radio.pause : t.radio.play}
          >
            {isBuffering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 translate-x-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!isYoutube}
            className="w-8 h-8 rounded-interactive flex items-center justify-center text-foreground/80 hover:bg-secondary/40 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            aria-label={t.radio.next_track}
            title={isYoutube ? t.radio.next_track : t.radio.next_track_disabled}
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isYoutube && tracks.length > 0 && (
        <div className="border-t border-primary/8">
          <div className="px-4 py-1.5 typo-caption text-foreground/55 uppercase tracking-wide bg-secondary/10">
            {tx(t.radio.tracklist_label, { count: tracks.length })}
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {tracks.map((tr, idx) => {
              const active = idx === currentTrackIndex;
              return (
                <li
                  key={`${tr.videoId}-${idx}`}
                  className={`px-4 py-1.5 flex items-center gap-2 typo-caption ${
                    active ? 'bg-secondary/30 text-foreground' : 'text-foreground/75'
                  }`}
                >
                  <span
                    className="w-5 text-right tabular-nums shrink-0"
                    style={{ color: active ? accent : undefined }}
                  >
                    {idx + 1}
                  </span>
                  <span className="truncate min-w-0 flex-1">
                    <span className="font-medium">{tr.artist}</span>
                    <span className="text-foreground/55"> — {tr.title}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {nowPlaying.station.sourceUrl && (
        <div className="border-t border-primary/8 px-4 py-2">
          <a
            href={nowPlaying.station.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 typo-caption text-foreground/65 hover:text-foreground/90 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {nowPlaying.station.sourceLabel ?? t.radio.open_source}
          </a>
        </div>
      )}
    </div>
  );
}
