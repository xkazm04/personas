import { useMemo, useRef, useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { MonitorPlay } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type {
  VideoClip,
  AudioClip,
  TextItem,
  ImageItem,
} from './types';
import type { PlaybackEngine } from './hooks/useTimelinePlayback';

// Target integrated loudness for loudnorm preview — must match the
// ffmpeg filter `loudnorm=I=-16` used at export time.
const TARGET_LUFS = -16;
/** Clamp the preview gain so a very quiet clip can't blow out the user. */
const MAX_NORMALIZE_GAIN = 6; // +15.5 dB

interface CompositionPreviewProps {
  engine: PlaybackEngine;
  playing: boolean;
  videoItems: VideoClip[];
  audioItems: AudioClip[];
  textItems: TextItem[];
  imageItems: ImageItem[];
  totalDuration: number;
  /** Composition frame height — drives proportional text sizing. */
  compositionHeight: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeSpeed(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.0625, Math.min(16, n));
}

function fadeOpacity(
  local: number,
  outputDuration: number,
  fadeIn: number | undefined,
  fadeOut: number | undefined,
): number {
  let o = 1;
  if (fadeIn && fadeIn > 0.001 && local < fadeIn) {
    o = Math.max(0, local / fadeIn);
  }
  if (fadeOut && fadeOut > 0.001 && local > outputDuration - fadeOut) {
    o = Math.min(o, Math.max(0, (outputDuration - local) / fadeOut));
  }
  return Math.max(0, Math.min(1, o));
}

/**
 * Derive the effective fade-in/fade-out for a video clip by folding in the
 * contribution of adjacent `transition` fields. This MUST match the rule in
 * `build_ffmpeg_args` (Rust export) so preview and export agree.
 *
 *  - A non-cut transition on clip[i] adds `transitionDuration` to its
 *    effective fade-out.
 *  - A non-cut transition on clip[i-1] adds `transitionDuration` to clip[i]'s
 *    effective fade-in.
 */
function effectiveVideoFades(
  clip: VideoClip,
  index: number,
  videoItems: VideoClip[],
): { fadeIn: number; fadeOut: number } {
  const baseIn = clip.fadeIn ?? 0;
  const baseOut = clip.fadeOut ?? 0;
  const prev = index > 0 ? videoItems[index - 1] : null;
  const transitionFromPrev =
    prev && prev.transition && prev.transition !== 'cut' && (prev.transitionDuration ?? 0) > 0
      ? prev.transitionDuration ?? 0
      : 0;
  const transitionOut =
    clip.transition && clip.transition !== 'cut' && (clip.transitionDuration ?? 0) > 0
      ? clip.transitionDuration ?? 0
      : 0;
  return {
    fadeIn: Math.min(clip.duration, baseIn + transitionFromPrev),
    fadeOut: Math.min(clip.duration, baseOut + transitionOut),
  };
}

/**
 * Compute the dB gain for loudnorm preview. `measured` is the integrated
 * LUFS from ffmpeg's dry run; `target` is the loudnorm I= parameter.
 *
 *   gain_dB = target - measured
 *   gain_linear = 10 ^ (gain_dB / 20)
 */
function loudnormGain(measured: number | undefined, target: number): number {
  if (measured === undefined || !Number.isFinite(measured)) return 1;
  const gainDb = target - measured;
  const linear = Math.pow(10, gainDb / 20);
  return Math.max(0.01, Math.min(MAX_NORMALIZE_GAIN, linear));
}

/**
 * CompositionPreview — rendered preview with live effect application.
 *
 * Preview ↔ Export parity matrix:
 *
 * | Effect                | Preview mechanism                     | Export mechanism         |
 * | --------------------- | ------------------------------------- | ------------------------ |
 * | Speed                 | HTMLMediaElement.playbackRate + seek  | trim + setpts / atempo   |
 * | Fade in / fade out    | opacity (per tick)                    | fade / afade filter      |
 * | Transition (fade/xfd) | effective fade_in/out folded in       | same rule in Rust        |
 * | Strip audio           | video.muted = true                    | filter path skipped      |
 * | Normalize             | measured LUFS → GainNode (true gain)  | loudnorm filter          |
 * | Clip volume           | GainNode                              | volume filter            |
 */
export default function CompositionPreview({
  engine,
  playing,
  videoItems,
  audioItems,
  textItems,
  imageItems,
  totalDuration,
  compositionHeight,
}: CompositionPreviewProps) {
  const { t } = useTranslation();

  // Local subscription to the playback clock — isolated from the studio tree.
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => engine.subscribe(setCurrentTime), [engine]);

  // Preview container ref + observed height so text overlays can be sized
  // in the same proportion as they will be in the exported frame:
  //   pxInPreview = (fontSize / compositionHeight) × containerHeight
  // This means a 48pt font in a 1080p composition renders at the same
  // relative size in a 400px preview as it will at 1080px in the MP4.
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewHeight, setPreviewHeight] = useState(0);
  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h > 0) setPreviewHeight(h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fontScale =
    previewHeight > 0 && compositionHeight > 0 ? previewHeight / compositionHeight : 0.5;

  // -- Active clip lookup ----------------------------------------------------
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Web Audio graph: one context, one { source, gain } per audio clip.
  // Wired lazily on first interaction (browser autoplay policy). When the
  // normalize flag is off we still route through the GainNode at unity gain
  // so we don't have to flip audio routing mid-playback.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<
    Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>
  >(new Map());

  const ensureAudioGraph = (clipId: string, el: HTMLAudioElement) => {
    if (audioNodesRef.current.has(clipId)) return audioNodesRef.current.get(clipId)!;
    if (!audioCtxRef.current) {
      try {
        const Ctx = window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctx();
      } catch {
        return null as unknown as { source: MediaElementAudioSourceNode; gain: GainNode };
      }
    }
    const ctx = audioCtxRef.current;
    if (!ctx) return null as unknown as { source: MediaElementAudioSourceNode; gain: GainNode };
    try {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(ctx.destination);
      const nodes = { source, gain };
      audioNodesRef.current.set(clipId, nodes);
      return nodes;
    } catch {
      // `createMediaElementSource` throws if the element has already been
      // connected in another context / tab. In that case fall back to
      // `el.volume` for attenuation.
      return null as unknown as { source: MediaElementAudioSourceNode; gain: GainNode };
    }
  };

  // Drop any nodes whose clip was removed
  useEffect(() => {
    const ids = new Set(audioItems.map((a) => a.id));
    for (const [id, nodes] of audioNodesRef.current.entries()) {
      if (!ids.has(id)) {
        try {
          nodes.source.disconnect();
          nodes.gain.disconnect();
        } catch {
          /* ignore */
        }
        audioNodesRef.current.delete(id);
      }
    }
  }, [audioItems]);

  // Resume audio context on user gesture (play click propagates here)
  useEffect(() => {
    if (playing && audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, [playing]);

  const activeVideoIndex = useMemo(
    () =>
      videoItems.findIndex(
        (v) => currentTime >= v.startTime && currentTime < v.startTime + v.duration,
      ),
    [videoItems, currentTime],
  );
  const activeVideo = activeVideoIndex >= 0 ? videoItems[activeVideoIndex] : null;

  const videoSrc = useMemo(
    () => (activeVideo ? convertFileSrc(activeVideo.filePath) : null),
    [activeVideo],
  );

  // Source-time target for the active video element (honors speed)
  const videoTargetSourceTime = useMemo(() => {
    if (!activeVideo) return 0;
    const s = safeSpeed(activeVideo.speed);
    return (currentTime - activeVideo.startTime) * s + activeVideo.trimStart;
  }, [activeVideo, currentTime]);

  // Opacity for the active video clip — INCLUDES transition contribution
  const videoOpacity = useMemo(() => {
    if (!activeVideo || activeVideoIndex < 0) return 1;
    const { fadeIn, fadeOut } = effectiveVideoFades(activeVideo, activeVideoIndex, videoItems);
    const local = currentTime - activeVideo.startTime;
    return fadeOpacity(local, activeVideo.duration, fadeIn, fadeOut);
  }, [activeVideo, activeVideoIndex, videoItems, currentTime]);

  // -- Live video sync -------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeVideo) return;
    const s = safeSpeed(activeVideo.speed);

    if (video.playbackRate !== s) video.playbackRate = s;
    if (video.muted !== !!activeVideo.stripAudio) video.muted = !!activeVideo.stripAudio;

    const applySync = () => {
      const target = videoTargetSourceTime;
      const threshold = playing ? 0.3 * s : 0.03;
      if (Math.abs(video.currentTime - target) > threshold) {
        try {
          video.currentTime = Math.max(0, target);
        } catch {
          /* media not ready — retry on loadedmetadata */
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
  }, [activeVideo, videoTargetSourceTime, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeVideo) return;
    if (playing) {
      const attempt = video.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.catch(() => {});
      }
    } else {
      video.pause();
    }
  }, [playing, activeVideo]);

  // Apply opacity imperatively (no React commit per tick for a style prop)
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.style.opacity = String(videoOpacity);
  }, [videoOpacity]);

  // -- Live audio sync -------------------------------------------------------
  useEffect(() => {
    audioItems.forEach((clip) => {
      const el = audioRefs.current.get(clip.id);
      if (!el) return;

      const nodes = ensureAudioGraph(clip.id, el);
      const s = safeSpeed(clip.speed);
      const inRange =
        currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration;
      const local = currentTime - clip.startTime;
      const targetLocal = local * s + clip.trimStart;

      if (el.playbackRate !== s) el.playbackRate = s;

      // Gain = base_volume × fade × (normalize? loudnormGain : 1)
      const fade = fadeOpacity(local, clip.duration, clip.fadeIn, clip.fadeOut);
      const normGain = clip.normalize ? loudnormGain(clip.measuredLufs, TARGET_LUFS) : 1;
      const totalGain = Math.max(0, (clip.volume ?? 1) * fade * normGain);

      if (nodes) {
        if (Math.abs(nodes.gain.gain.value - totalGain) > 0.005) {
          nodes.gain.gain.value = totalGain;
        }
        // Element volume stays at 1 when routed through Web Audio
        if (el.volume !== 1) el.volume = 1;
      } else {
        // Fallback path: no Web Audio graph — volume is attenuation-only
        const clamped = Math.max(0, Math.min(1, totalGain));
        if (Math.abs(el.volume - clamped) > 0.005) el.volume = clamped;
      }

      if (!inRange) {
        if (!el.paused) el.pause();
        return;
      }

      const threshold = playing ? 0.3 * s : 0.03;
      if (Math.abs(el.currentTime - targetLocal) > threshold) {
        try {
          el.currentTime = Math.max(0, targetLocal);
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

  // Clean up audio refs when clips disappear
  useEffect(() => {
    const ids = new Set(audioItems.map((a) => a.id));
    for (const [id, el] of audioRefs.current.entries()) {
      if (!ids.has(id)) {
        el.pause();
        audioRefs.current.delete(id);
      }
    }
  }, [audioItems]);

  // -- Active overlays -------------------------------------------------------
  const activeTexts = useMemo(
    () =>
      textItems.filter(
        (it) => currentTime >= it.startTime && currentTime < it.startTime + it.duration,
      ),
    [textItems, currentTime],
  );
  const activeImages = useMemo(
    () =>
      imageItems.filter(
        (it) => currentTime >= it.startTime && currentTime < it.startTime + it.duration,
      ),
    [imageItems, currentTime],
  );

  const progress = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;
  const hasAnyMedia =
    videoItems.length > 0 || imageItems.length > 0 || textItems.length > 0;

  return (
    <div className="flex flex-col rounded-xl bg-card border border-primary/10 overflow-hidden w-full shadow-md">
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <div
          ref={previewContainerRef}
          className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden"
        >
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain transition-none"
              controls={false}
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

          {activeImages.map((item) => {
            const local = currentTime - item.startTime;
            const opacity = fadeOpacity(local, item.duration, item.fadeIn, item.fadeOut);
            return (
              <div
                key={item.id}
                className="absolute pointer-events-none"
                style={{
                  left: `${item.positionX * 100}%`,
                  top: `${item.positionY * 100}%`,
                  transform: `translate(-50%, -50%) scale(${item.scale})`,
                  opacity,
                }}
              >
                <img
                  src={convertFileSrc(item.filePath)}
                  alt={item.label}
                  className="max-w-[40%] max-h-[40%] object-contain drop-shadow-lg"
                  draggable={false}
                />
              </div>
            );
          })}

          {activeTexts.map((item) => {
            const local = currentTime - item.startTime;
            const opacity = fadeOpacity(local, item.duration, item.fadeIn, item.fadeOut);
            return (
              <div
                key={item.id}
                className="absolute pointer-events-none select-none"
                style={{
                  left: `${item.positionX * 100}%`,
                  top: `${item.positionY * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  opacity,
                }}
              >
                <span
                  className="font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                  style={{
                    fontSize: `${Math.max(6, item.fontSize * fontScale)}px`,
                    color: item.color,
                  }}
                >
                  {item.label}
                </span>
                {item.text && (
                  <p
                    className="text-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] mt-0.5"
                    style={{
                      fontSize: `${Math.max(6, item.fontSize * fontScale * 0.5)}px`,
                      color: item.color,
                      opacity: 0.85,
                    }}
                  >
                    {item.text}
                  </p>
                )}
              </div>
            );
          })}

          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {activeVideo && safeSpeed(activeVideo.speed) !== 1 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-500/80 text-[9px] font-mono text-white tabular-nums">
                {safeSpeed(activeVideo.speed).toFixed(2)}×
              </span>
            )}
            <div className="px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm">
              <span className="text-[10px] font-mono text-white/80 tabular-nums">
                {formatTimecode(currentTime)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="h-1 bg-secondary/20">
        <div
          className="h-full bg-gradient-to-r from-rose-500/60 to-rose-400/40"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

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
