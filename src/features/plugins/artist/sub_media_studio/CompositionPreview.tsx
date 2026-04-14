import { useMemo, useRef, useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { MonitorPlay } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type {
  TimelineItem,
  VideoClip,
  AudioClip,
  TextItem,
  ImageItem,
} from './types';
import type { PlaybackEngine } from './hooks/useTimelinePlayback';

interface CompositionPreviewProps {
  engine: PlaybackEngine;
  playing: boolean;
  videoItems: VideoClip[];
  audioItems: AudioClip[];
  textItems: TextItem[];
  imageItems: ImageItem[];
  totalDuration: number;
}

/**
 * CompositionPreview — the rendered preview pane.
 *
 * Design notes:
 * - Subscribes to `engine` for time updates so it re-renders independently of
 *   the rest of the media studio tree.
 * - Uses native <video> playback (not per-frame `currentTime = X` assignment,
 *   which caused the "video won't play" bug in the previous version). We only
 *   touch `.currentTime` when seeking, switching clips, or when drift exceeds
 *   a small threshold.
 * - Hidden <audio> elements per audio clip — browsers mix natively so we get
 *   multi-track audio without filter graph work.
 */
export default function CompositionPreview({
  engine,
  playing,
  videoItems,
  audioItems,
  textItems,
  imageItems,
  totalDuration,
}: CompositionPreviewProps) {
  const { t } = useTranslation();

  // -- Subscribe to the playback clock -----------------------------------------
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => {
    return engine.subscribe(setCurrentTime);
  }, [engine]);

  // -- Active clip & element refs ----------------------------------------------
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  const activeVideo = useMemo(
    () =>
      videoItems.find(
        (v) => currentTime >= v.startTime && currentTime < v.startTime + v.duration,
      ) ?? null,
    [videoItems, currentTime],
  );

  const videoSrc = useMemo(
    () => (activeVideo ? convertFileSrc(activeVideo.filePath) : null),
    [activeVideo],
  );

  // Map from timeline-time to the video element's local time (seconds in file)
  const clipLocalTime = useMemo(() => {
    if (!activeVideo) return 0;
    return currentTime - activeVideo.startTime + activeVideo.trimStart;
  }, [activeVideo, currentTime]);

  // -- Video element sync ------------------------------------------------------
  //
  // We only touch videoRef.currentTime when:
  //  1. Seeking or paused (user-initiated jump)
  //  2. The active clip changed
  //  3. Drift exceeds 0.3s while playing (shouldn't happen often)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeVideo) return;

    const applySync = () => {
      if (Math.abs(video.currentTime - clipLocalTime) > (playing ? 0.3 : 0.05)) {
        try {
          video.currentTime = clipLocalTime;
        } catch {
          // Media not yet ready — the loadedmetadata effect will retry
        }
      }
    };

    if (video.readyState >= 1) {
      applySync();
    } else {
      const onLoaded = () => {
        applySync();
        video.removeEventListener('loadedmetadata', onLoaded);
      };
      video.addEventListener('loadedmetadata', onLoaded);
      return () => video.removeEventListener('loadedmetadata', onLoaded);
    }
  }, [activeVideo, clipLocalTime, playing]);

  // Play / pause the native element in sync with transport
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeVideo) return;
    if (playing) {
      const attempt = video.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.catch(() => {
          /* autoplay may be blocked; user will hit Play again */
        });
      }
    } else {
      video.pause();
    }
  }, [playing, activeVideo]);

  // -- Audio sync --------------------------------------------------------------
  useEffect(() => {
    // For each audio clip, update the corresponding <audio> element
    audioItems.forEach((clip) => {
      const el = audioRefs.current.get(clip.id);
      if (!el) return;

      const inRange = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration;
      const localTime = currentTime - clip.startTime + clip.trimStart;

      el.volume = Math.max(0, Math.min(1, clip.volume));

      if (!inRange) {
        if (!el.paused) el.pause();
        return;
      }

      if (Math.abs(el.currentTime - localTime) > (playing ? 0.3 : 0.05)) {
        try {
          el.currentTime = localTime;
        } catch {
          /* ignore */
        }
      }

      if (playing && el.paused) {
        el.play().catch(() => {});
      } else if (!playing && !el.paused) {
        el.pause();
      }
    });
  }, [audioItems, currentTime, playing]);

  // Stop any audio elements whose clip was removed
  useEffect(() => {
    const ids = new Set(audioItems.map((a) => a.id));
    for (const [id, el] of audioRefs.current.entries()) {
      if (!ids.has(id)) {
        el.pause();
        audioRefs.current.delete(id);
      }
    }
  }, [audioItems]);

  // -- Overlays ----------------------------------------------------------------
  const activeTexts = useMemo(
    () =>
      textItems.filter((it) => currentTime >= it.startTime && currentTime < it.startTime + it.duration),
    [textItems, currentTime],
  );

  const activeImages = useMemo(
    () =>
      imageItems.filter((it) => currentTime >= it.startTime && currentTime < it.startTime + it.duration),
    [imageItems, currentTime],
  );

  const progress = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;
  const hasAnyMedia =
    videoItems.length > 0 || imageItems.length > 0 || textItems.length > 0;

  return (
    <div className="flex flex-col rounded-xl bg-card border border-primary/10 overflow-hidden w-full shadow-md">
      {/* 16:9 aspect container */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden">
          {/* Video layer */}
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain"
              controls={false}
              muted={false}
              playsInline
            />
          ) : hasAnyMedia ? (
            <div className="flex flex-col items-center gap-2 text-foreground/30">
              <MonitorPlay className="w-10 h-10" />
              <span className="typo-body text-sm">
                {activeTexts.length + activeImages.length > 0
                  ? 'Overlay preview'
                  : 'No video at this time'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-foreground/20">
              <MonitorPlay className="w-10 h-10" />
              <span className="typo-body text-sm">{t.media_studio.empty_hint}</span>
            </div>
          )}

          {/* Active image overlays */}
          {activeImages.map((item) => (
            <div
              key={item.id}
              className="absolute pointer-events-none"
              style={{
                left: `${item.positionX * 100}%`,
                top: `${item.positionY * 100}%`,
                transform: `translate(-50%, -50%) scale(${item.scale})`,
              }}
            >
              <img
                src={convertFileSrc(item.filePath)}
                alt={item.label}
                className="max-w-[40%] max-h-[40%] object-contain drop-shadow-lg"
                draggable={false}
              />
            </div>
          ))}

          {/* Active text overlays */}
          {activeTexts.map((item) => (
            <div
              key={item.id}
              className="absolute pointer-events-none select-none"
              style={{
                left: `${item.positionX * 100}%`,
                top: `${item.positionY * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <span
                className="font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                style={{
                  fontSize: `${item.fontSize * 0.5}px`,
                  color: item.color,
                }}
              >
                {item.label}
              </span>
              {item.text && (
                <p
                  className="text-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] mt-0.5"
                  style={{
                    fontSize: `${Math.max(10, item.fontSize * 0.25)}px`,
                    color: item.color,
                    opacity: 0.85,
                  }}
                >
                  {item.text}
                </p>
              )}
            </div>
          ))}

          {/* Timecode overlay */}
          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm">
            <span className="text-[10px] font-mono text-white/80 tabular-nums">
              {formatTimecode(currentTime)}
            </span>
          </div>
        </div>
      </div>

      {/* Mini scrubber bar */}
      <div className="h-1 bg-secondary/20">
        <div
          className="h-full bg-gradient-to-r from-rose-500/60 to-rose-400/40"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Hidden audio elements — browser handles mixing */}
      <div className="sr-only" aria-hidden>
        {audioItems.map((clip) => (
          <audio
            key={clip.id}
            ref={(el) => {
              if (el) audioRefs.current.set(clip.id, el);
              else audioRefs.current.delete(clip.id);
            }}
            src={convertFileSrc(clip.filePath)}
            preload="metadata"
          />
        ))}
      </div>
    </div>
  );
}

function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

// Selection prop removed — preview renders the composition, not the selected clip.
// Fields we still need for InspectorPanel etc remain available via the types.
export type { TimelineItem };
