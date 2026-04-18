import { useMemo, useRef, useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { MonitorPlay } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { artistCompileRenderPlan } from '@/api/artist';
import { silentCatch } from '@/lib/silentCatch';
import { formatTimecode } from '../utils/format';
import type { Composition } from './types';
import type { PlaybackEngine } from './hooks/useTimelinePlayback';
import type { AudioStage } from '@/lib/bindings/AudioStage';
import type { ImageOverlayStage } from '@/lib/bindings/ImageOverlayStage';
import type { RenderPlan } from '@/lib/bindings/RenderPlan';
import type { SourceEntry } from '@/lib/bindings/SourceEntry';
import type { TextOverlayStage } from '@/lib/bindings/TextOverlayStage';
import type { VideoStage } from '@/lib/bindings/VideoStage';
import { approxLoudnormGain, fadeEnvelope } from './renderPlanHelpers';

/** Debounce window for the IPC compile. Short enough to feel instant, long
 *  enough that a drag event storm collapses into one round-trip. */
const COMPILE_DEBOUNCE_MS = 40;

interface CompositionPreviewProps {
  engine: PlaybackEngine;
  playing: boolean;
  composition: Composition;
  totalDuration: number;
}

// ---------------------------------------------------------------------------
// Renderer — consumes a RenderPlan produced by `compile(composition, ...)`.
// See docs/concepts/media-studio-renderplan.md §"Renderer contract" for the
// invariants this component relies on (stages are pre-resolved; no Composition
// walking, no transition folding, no loudnorm math).
// ---------------------------------------------------------------------------

function findSource(plan: RenderPlan, sourceId: number): SourceEntry | undefined {
  return plan.sources.find((s) => s.id === sourceId);
}

function sourcePath(source: SourceEntry | undefined): string | null {
  if (!source) return null;
  if (source.kind === 'color') return null;
  return source.path;
}

export default function CompositionPreview({
  engine,
  playing,
  composition,
  totalDuration,
}: CompositionPreviewProps) {
  const { t } = useTranslation();

  // Compile the Composition into the IR via the Rust canonical compiler.
  // One implementation across preview and export — see ADR in
  // docs/concepts/media-studio-renderplan.md §"Appendix A". The IPC round-
  // trip is sub-millisecond for typical compositions; we debounce so a
  // drag-storm collapses into one call, and we guard against out-of-order
  // responses with a sequence number.
  const compositionJson = useMemo(() => JSON.stringify(composition), [composition]);
  const [plan, setPlan] = useState<RenderPlan | null>(null);
  const compileSeqRef = useRef(0);
  useEffect(() => {
    const seq = ++compileSeqRef.current;
    const handle = window.setTimeout(() => {
      artistCompileRenderPlan(compositionJson)
        .then((next) => {
          if (seq === compileSeqRef.current) setPlan(next);
        })
        // An in-progress edit can briefly violate compile invariants
        // (zero-duration drag, out-of-range trim). Keep the last valid
        // plan on screen until the edit settles.
        .catch(silentCatch('render_plan_compile'));
    }, COMPILE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [compositionJson]);

  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => engine.subscribe(setCurrentTime), [engine]);

  // Proportional font sizing: a 48px font in a 1080p composition renders at
  // `48 × (previewHeight / 1080)` pixels in the preview container, matching
  // what the exported frame will show.
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
    previewHeight > 0 && composition.height > 0 ? previewHeight / composition.height : 0.5;

  // -- Active video stage ----------------------------------------------------
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeVideo: VideoStage | null = useMemo(() => {
    if (!plan) return null;
    return (
      plan.videoTrack.find((s) => currentTime >= s.outputStart && currentTime < s.outputEnd) ?? null
    );
  }, [plan, currentTime]);

  const videoSrc = useMemo(() => {
    if (!plan || !activeVideo) return null;
    const p = sourcePath(findSource(plan, activeVideo.sourceId));
    return p ? convertFileSrc(p) : null;
  }, [plan, activeVideo]);

  // Sync <video>.currentTime into the stage's source window, honoring speed.
  const videoTargetSourceTime = useMemo(() => {
    if (!activeVideo) return 0;
    return activeVideo.sourceIn + (currentTime - activeVideo.outputStart) * activeVideo.speed;
  }, [activeVideo, currentTime]);

  // Opacity from the stage's pre-resolved fades (transition contributions
  // already folded in by the compiler).
  const videoOpacity = useMemo(() => {
    if (!activeVideo) return 1;
    const local = currentTime - activeVideo.outputStart;
    const duration = activeVideo.outputEnd - activeVideo.outputStart;
    return fadeEnvelope(local, duration, activeVideo.fadeIn, activeVideo.fadeOut);
  }, [activeVideo, currentTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeVideo) return;
    const s = activeVideo.speed;

    if (video.playbackRate !== s) video.playbackRate = s;
    if (video.muted !== activeVideo.stripEmbeddedAudio) {
      video.muted = activeVideo.stripEmbeddedAudio;
    }

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
      if (attempt && typeof attempt.then === 'function') attempt.catch(() => {});
    } else {
      video.pause();
    }
  }, [playing, activeVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.style.opacity = String(videoOpacity);
  }, [videoOpacity]);

  // -- Audio: dedicated tracks via <audio> elements + Web Audio gain --------
  //
  // The IR's "embedded" synthetic track is routed natively through <video>
  // (muted toggled via stripEmbeddedAudio above); it does not need its own
  // HTMLAudioElement. Dedicated tracks each get one <audio> element keyed by
  // track id — the tracks index 1:1 with original AudioClips today.
  const dedicatedTracks = useMemo(() => {
    if (!plan) return [];
    return plan.audioTracks.filter((t) => t.id !== 'embedded');
  }, [plan]);

  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<
    Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>
  >(new Map());

  const ensureAudioGraph = (trackId: string, el: HTMLAudioElement) => {
    if (audioNodesRef.current.has(trackId)) return audioNodesRef.current.get(trackId)!;
    if (!audioCtxRef.current) {
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctx();
      } catch {
        return null;
      }
    }
    const ctx = audioCtxRef.current;
    if (!ctx) return null;
    try {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(ctx.destination);
      const nodes = { source, gain };
      audioNodesRef.current.set(trackId, nodes);
      return nodes;
    } catch {
      return null;
    }
  };

  // Drop nodes whose track disappeared.
  useEffect(() => {
    const ids = new Set(dedicatedTracks.map((t) => t.id));
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
  }, [dedicatedTracks]);

  useEffect(() => {
    if (playing && audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, [playing]);

  useEffect(() => {
    if (!plan) return;
    for (const track of dedicatedTracks) {
      const el = audioRefs.current.get(track.id);
      if (!el) continue;

      // A dedicated track has exactly one stage today (1:1 with AudioClip).
      // Scaling this up to multi-stage tracks is a future IR capability; for
      // now we consume the first stage.
      const stage: AudioStage | undefined = track.stages[0];
      if (!stage) continue;

      const nodes = ensureAudioGraph(track.id, el);
      const inRange = currentTime >= stage.outputStart && currentTime < stage.outputEnd;
      const local = currentTime - stage.outputStart;
      const duration = stage.outputEnd - stage.outputStart;
      const targetLocal = stage.sourceIn + local * stage.speed;

      if (el.playbackRate !== stage.speed) el.playbackRate = stage.speed;

      const fade = fadeEnvelope(local, duration, stage.fadeIn, stage.fadeOut);
      const normGain = stage.normalize ? approxLoudnormGain(stage.normalize) : 1;
      const totalGain = Math.max(0, stage.linearGain * fade * normGain * track.gain);

      if (nodes) {
        if (Math.abs(nodes.gain.gain.value - totalGain) > 0.005) {
          nodes.gain.gain.value = totalGain;
        }
        if (el.volume !== 1) el.volume = 1;
      } else {
        const clamped = Math.max(0, Math.min(1, totalGain));
        if (Math.abs(el.volume - clamped) > 0.005) el.volume = clamped;
      }

      if (!inRange) {
        if (!el.paused) el.pause();
        continue;
      }

      const threshold = playing ? 0.3 * stage.speed : 0.03;
      if (Math.abs(el.currentTime - targetLocal) > threshold) {
        try {
          el.currentTime = Math.max(0, targetLocal);
        } catch {
          /* ignore */
        }
      }

      if (playing && el.paused) el.play().catch(() => {});
      else if (!playing && !el.paused) el.pause();
    }
  }, [dedicatedTracks, plan, currentTime, playing]);

  useEffect(() => {
    const ids = new Set(dedicatedTracks.map((t) => t.id));
    for (const [id, el] of audioRefs.current.entries()) {
      if (!ids.has(id)) {
        el.pause();
        audioRefs.current.delete(id);
      }
    }
  }, [dedicatedTracks]);

  // -- Active overlays -------------------------------------------------------
  //
  // The generated OverlayStage binding is a discriminated union shaped as
  // `{kind:'text'} & TextOverlayStage | {kind:'image'} & ImageOverlayStage`,
  // so the narrowed variant types include the `kind` field alongside the
  // inner stage shape.
  type ActiveText = { kind: 'text' } & TextOverlayStage;
  type ActiveImage = { kind: 'image' } & ImageOverlayStage;

  const activeTexts: ActiveText[] = useMemo(() => {
    if (!plan) return [];
    return plan.overlays.filter(
      (o): o is ActiveText =>
        o.kind === 'text' && currentTime >= o.outputStart && currentTime < o.outputEnd,
    );
  }, [plan, currentTime]);

  const activeImages: ActiveImage[] = useMemo(() => {
    if (!plan) return [];
    return plan.overlays.filter(
      (o): o is ActiveImage =>
        o.kind === 'image' && currentTime >= o.outputStart && currentTime < o.outputEnd,
    );
  }, [plan, currentTime]);

  // Resolve paths for <audio>/<img> elements from the plan's source catalog.
  const audioTrackSources = useMemo(() => {
    if (!plan) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const track of dedicatedTracks) {
      const stage = track.stages[0];
      if (!stage) continue;
      const p = sourcePath(findSource(plan, stage.sourceId));
      if (p) map.set(track.id, p);
    }
    return map;
  }, [plan, dedicatedTracks]);

  const imagePathFor = (overlay: ImageOverlayStage): string | null => {
    if (!plan) return null;
    return sourcePath(findSource(plan, overlay.sourceId));
  };

  const progress = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;
  const hasAnyMedia = plan
    ? plan.videoTrack.length > 0 || plan.overlays.length > 0 || dedicatedTracks.length > 0
    : false;

  return (
    <div className="flex flex-col rounded-modal bg-card border border-primary/10 overflow-hidden w-full shadow-elevation-2">
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
            <div className="flex flex-col items-center gap-2 text-foreground">
              <MonitorPlay className="w-10 h-10" />
              <span className="typo-body">
                {activeTexts.length + activeImages.length > 0
                  ? 'Overlay preview'
                  : 'No video at this time'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-foreground">
              <MonitorPlay className="w-10 h-10" />
              <span className="typo-body">{t.media_studio.empty_hint}</span>
            </div>
          )}

          {activeImages.map((overlay) => {
            const local = currentTime - overlay.outputStart;
            const duration = overlay.outputEnd - overlay.outputStart;
            const opacity = fadeEnvelope(local, duration, overlay.fadeIn, overlay.fadeOut);
            const path = imagePathFor(overlay);
            if (!path) return null;
            return (
              <div
                key={overlay.id}
                className="absolute pointer-events-none"
                style={{
                  left: `${overlay.positionX * 100}%`,
                  top: `${overlay.positionY * 100}%`,
                  transform: `translate(-50%, -50%) scale(${overlay.scale})`,
                  opacity,
                }}
              >
                <img
                  src={convertFileSrc(path)}
                  alt=""
                  className="max-w-[40%] max-h-[40%] object-contain drop-shadow-elevation-3"
                  draggable={false}
                />
              </div>
            );
          })}

          {activeTexts.map((overlay) => {
            const local = currentTime - overlay.outputStart;
            const duration = overlay.outputEnd - overlay.outputStart;
            const opacity = fadeEnvelope(local, duration, overlay.fadeIn, overlay.fadeOut);
            return (
              <div
                key={overlay.id}
                className="absolute pointer-events-none select-none"
                style={{
                  left: `${overlay.positionX * 100}%`,
                  top: `${overlay.positionY * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  opacity,
                }}
              >
                <span
                  className="font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                  style={{
                    fontSize: `${Math.max(6, overlay.fontSizePx * fontScale)}px`,
                    color: overlay.colorHex,
                  }}
                >
                  {overlay.text}
                </span>
                {overlay.subtitle && (
                  <p
                    className="text-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] mt-0.5"
                    style={{
                      fontSize: `${Math.max(6, overlay.fontSizePx * fontScale * 0.5)}px`,
                      color: overlay.colorHex,
                      opacity: 0.85,
                    }}
                  >
                    {overlay.subtitle}
                  </p>
                )}
              </div>
            );
          })}

          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {activeVideo && activeVideo.speed !== 1 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-500/80 typo-code text-white tabular-nums">
                {activeVideo.speed.toFixed(2)}×
              </span>
            )}
            <div className="px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm">
              <span className="typo-code text-white/80 tabular-nums">
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
        {dedicatedTracks.map((track) => {
          const path = audioTrackSources.get(track.id);
          if (!path) return null;
          return (
            <audio
              key={track.id}
              ref={(el) => {
                if (el) audioRefs.current.set(track.id, el);
                else audioRefs.current.delete(track.id);
              }}
              src={convertFileSrc(path)}
              preload="metadata"
            />
          );
        })}
      </div>
    </div>
  );
}
