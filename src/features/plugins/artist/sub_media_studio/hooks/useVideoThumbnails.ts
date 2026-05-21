import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { silentCatch } from '@/lib/silentCatch';


/**
 * Module-level cache of video thumbnail strips keyed by filePath. Each entry
 * is an array of data-URLs — each data-URL is a single JPEG frame.
 */
const FRAMES_PER_CLIP = 6;
const THUMB_WIDTH = 160;
const MAX_CACHE_ENTRIES = 25;
const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

function putInCache(filePath: string, frames: string[]) {
  if (cache.has(filePath)) cache.delete(filePath);
  cache.set(filePath, frames);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

async function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onErr);
      reject(new Error('video seek error'));
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onErr, { once: true });
    video.currentTime = t;
  });
}

function teardownVideo(video: HTMLVideoElement): void {
  // Detach src so the element + decoded buffers can be GC'd. Wrapped because
  // some browsers throw on .load() when src has been removed; we don't care.
  try { video.pause(); video.removeAttribute('src'); video.load(); } catch (err) { silentCatch("features/plugins/artist/sub_media_studio/hooks/useVideoThumbnails:catch1")(err); }
}

async function extractFrames(filePath: string, signal?: AbortSignal): Promise<string[]> {
  const src = convertFileSrc(filePath);

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = src;

  // Wrap the entire decode pipeline in try/finally so a metadata load failure,
  // codec error, or cancellation always tears down the HTMLVideoElement —
  // previously the cleanup at the end of the function only ran on the success
  // path, leaving a detached video element with src= still set holding the
  // file open and decoded buffers in memory.
  try {
    await new Promise<void>((resolve, reject) => {
      const onMeta = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); reject(new Error('metadata load failed')); };
      const onAbort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onErr);
        signal?.removeEventListener('abort', onAbort);
      };
      video.addEventListener('loadedmetadata', onMeta, { once: true });
      video.addEventListener('error', onErr, { once: true });
      if (signal) {
        if (signal.aborted) { cleanup(); reject(new DOMException('Aborted', 'AbortError')); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const aspect = video.videoHeight > 0 && video.videoWidth > 0
      ? video.videoHeight / video.videoWidth
      : 9 / 16;

    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round(THUMB_WIDTH * aspect);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');

    const frames: string[] = [];
    // Sample at N+1 evenly spaced points from 0.0..(duration-epsilon),
    // but skip t=0 since many codecs render a black/near-black first frame.
    for (let i = 0; i < FRAMES_PER_CLIP; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const t = ((i + 0.5) / FRAMES_PER_CLIP) * duration;
      try {
        await seekTo(video, Math.min(duration - 0.05, t));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.6));
      } catch (err) { silentCatch("features/plugins/artist/sub_media_studio/hooks/useVideoThumbnails:catch2")(err); }
    }

    return frames;
  } finally {
    teardownVideo(video);
  }
}

/**
 * Extract N evenly-spaced thumbnail frames from a video file. Cached per
 * filePath. Returns null while loading or on error so the UI can fall back
 * to a filmstrip pattern.
 */
export function useVideoThumbnails(filePath: string | null): string[] | null {
  const cached = filePath ? cache.get(filePath) ?? null : null;
  const [frames, setFrames] = useState<string[] | null>(cached);

  useEffect(() => {
    if (!filePath) {
      setFrames(null);
      return;
    }
    const hit = cache.get(filePath);
    if (hit) {
      setFrames(hit);
      return;
    }
    let cancelled = false;
    let promise = inflight.get(filePath);
    if (!promise) {
      // Note: extractFrames accepts an AbortSignal but we don't pass one here.
      // The inflight Map is module-scoped and shared across consumers — if
      // consumer A starts the decode and B mounts during it, B reuses A's
      // promise. If A unmounts and aborts, B would be denied the result. The
      // signal hook stays in the API for a future ref-counted version. The
      // try/finally inside extractFrames already guarantees HTMLVideoElement
      // teardown when the decode completes naturally (success or error path).
      promise = extractFrames(filePath).then((p) => {
        putInCache(filePath, p);
        inflight.delete(filePath);
        return p;
      });
      inflight.set(filePath, promise);
      promise.catch(() => inflight.delete(filePath));
    }
    promise
      .then((p) => { if (!cancelled) setFrames(p); })
      .catch(() => { if (!cancelled) setFrames(null); });
    return () => { cancelled = true; };
  }, [filePath]);

  return frames;
}

export const VIDEO_FRAMES_PER_CLIP = FRAMES_PER_CLIP;
