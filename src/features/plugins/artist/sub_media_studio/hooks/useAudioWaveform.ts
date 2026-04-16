import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Module-level cache of waveform peaks keyed by filePath. Each entry is a
 * Float32Array of normalized peak magnitudes (0..1) at a fixed bucket count.
 * Decoding audio is expensive so we keep these around across lane renders.
 */
const PEAKS_BUCKETS = 200;
const MAX_CACHE_ENTRIES = 40;
const cache = new Map<string, Float32Array>();
const inflight = new Map<string, Promise<Float32Array>>();

function putInCache(filePath: string, peaks: Float32Array) {
  if (cache.has(filePath)) cache.delete(filePath);
  cache.set(filePath, peaks);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// Lazily create a single shared AudioContext — decoding only.
let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  try {
    const Ctx = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new Ctx();
    return sharedCtx;
  } catch {
    return null;
  }
}

async function extractPeaks(filePath: string): Promise<Float32Array> {
  const ctx = getCtx();
  if (!ctx) throw new Error('no AudioContext');

  const src = convertFileSrc(filePath);
  const response = await fetch(src);
  const buffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(buffer);

  // Downmix to mono by averaging channels then bucket into PEAKS_BUCKETS slots
  // taking the peak absolute value per slot.
  const channelCount = audioBuffer.numberOfChannels;
  const samples = audioBuffer.length;
  const samplesPerBucket = Math.max(1, Math.floor(samples / PEAKS_BUCKETS));
  const peaks = new Float32Array(PEAKS_BUCKETS);

  // Pull channel data once to minimize per-sample call overhead
  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let maxSeen = 0.000001;
  for (let i = 0; i < PEAKS_BUCKETS; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(samples, start + samplesPerBucket);
    let peak = 0;
    for (let j = start; j < end; j++) {
      let v = 0;
      for (let c = 0; c < channelCount; c++) {
        const ch = channels[c];
        if (ch) v += ch[j] ?? 0;
      }
      v = Math.abs(v / channelCount);
      if (v > peak) peak = v;
    }
    peaks[i] = peak;
    if (peak > maxSeen) maxSeen = peak;
  }

  // Normalize so the tallest bar maxes at 1 — compensates for quiet clips
  for (let i = 0; i < PEAKS_BUCKETS; i++) {
    peaks[i] = (peaks[i] ?? 0) / maxSeen;
  }
  return peaks;
}

/**
 * Decode an audio file and return normalized peak magnitudes for waveform
 * rendering. Results are cached by filePath; returns null while loading or
 * on any error so the UI can fall back to a synthetic waveform.
 */
export function useAudioWaveform(filePath: string | null): Float32Array | null {
  const cached = filePath ? cache.get(filePath) ?? null : null;
  const [peaks, setPeaks] = useState<Float32Array | null>(cached);

  useEffect(() => {
    if (!filePath) {
      setPeaks(null);
      return;
    }
    const hit = cache.get(filePath);
    if (hit) {
      setPeaks(hit);
      return;
    }

    let cancelled = false;
    let promise = inflight.get(filePath);
    if (!promise) {
      promise = extractPeaks(filePath).then((p) => {
        putInCache(filePath, p);
        inflight.delete(filePath);
        return p;
      });
      inflight.set(filePath, promise);
      promise.catch(() => inflight.delete(filePath));
    }
    promise
      .then((p) => { if (!cancelled) setPeaks(p); })
      .catch(() => { if (!cancelled) setPeaks(null); });
    return () => { cancelled = true; };
  }, [filePath]);

  return peaks;
}

export const WAVEFORM_BUCKETS = PEAKS_BUCKETS;
