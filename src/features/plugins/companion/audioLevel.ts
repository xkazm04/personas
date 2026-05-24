/**
 * Shared Web Audio analyser tap for Athena's TTS playback.
 *
 * Every `<audio>` element that flows through {@link play} (in
 * `voicePlayback.ts`) is wired into a single `AnalyserNode`, so UI can
 * react to the live speech level — today, the floating orb's glow pulses
 * with Athena's voice. Centralizing here is the dependency that unblocked
 * the audio-reactive glow parked in `athena-orb-overlay-plan.md` §2.6.
 *
 * Design notes:
 *  - **Imperative subscription.** Consumers get a 0..1 level in a `rAF`
 *    callback and update the DOM directly; we never push 60fps through
 *    React state.
 *  - **Best-effort / non-breaking.** If Web Audio is unavailable or
 *    `createMediaElementSource` throws, the element still plays through its
 *    normal output — the tap just goes dark. `attachPlayback` never throws.
 *  - **Idle when silent.** The `rAF` loop only runs while ≥1 element is
 *    playing, then decays the level to 0 and stops.
 *
 * The AudioContext + chime (`chime.ts`) establish that Web Audio works in
 * this WebView, and playback always follows a user gesture, so the context
 * resumes cleanly.
 */

import { silentCatch } from '@/lib/silentCatch';

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
// Typed with the concrete ArrayBuffer backing so `getByteFrequencyData`'s
// `Uint8Array<ArrayBuffer>` parameter accepts it (lib.dom narrows this).
let freq: Uint8Array<ArrayBuffer> | null = null;
const connected = new WeakSet<HTMLAudioElement>();

let activeCount = 0;
let rafId: number | null = null;
let level = 0;
const listeners = new Set<(level: number) => void>();

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

function ensureGraph(): boolean {
  if (analyser) return true;
  const Ctor = audioCtor();
  if (!Ctor) return false;
  try {
    ctx = new Ctor();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    freq = new Uint8Array(analyser.frequencyBinCount);
    analyser.connect(ctx.destination);
    return true;
  } catch {
    ctx = null;
    analyser = null;
    freq = null;
    return false;
  }
}

/**
 * Route an audio element through the shared analyser. Best-effort: silent
 * no-op if Web Audio is unavailable or the element can't be tapped.
 */
export function attachPlayback(audio: HTMLAudioElement): void {
  if (!ensureGraph() || !ctx || !analyser) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

  let src: MediaElementAudioSourceNode | null = null;
  if (!connected.has(audio)) {
    try {
      src = ctx.createMediaElementSource(audio);
      src.connect(analyser);
      connected.add(audio);
    } catch {
      // Element already captured by another graph, or creation failed —
      // playback still works through its existing wiring; skip the tap.
      return;
    }
  }

  activeCount += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeCount = Math.max(0, activeCount - 1);
    try {
      src?.disconnect();
    } catch (err) {
      // Already disconnected (double-fire of ended/pause) — harmless.
      silentCatch('companion_audio_level_disconnect')(err);
    }
  };
  audio.addEventListener('ended', release, { once: true });
  audio.addEventListener('error', release, { once: true });
  audio.addEventListener('pause', release, { once: true });

  startLoop();
}

function computeLevel(): number {
  if (!analyser || !freq) return 0;
  analyser.getByteFrequencyData(freq);
  // Speech energy concentrates in the low-mid band; average those bins and
  // skip the noisy top end. Normalize 0..1, then apply a gentle curve so
  // quiet speech still lifts the glow noticeably.
  const bins = Math.min(freq.length, 48);
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += freq[i] ?? 0;
  const avg = sum / bins / 255;
  return Math.min(1, Math.pow(avg, 0.7) * 1.4);
}

function startLoop(): void {
  if (rafId != null) return;
  const tick = () => {
    const target = activeCount > 0 ? computeLevel() : 0;
    // Fast attack, slower release — feels like a voice, not a strobe.
    level += (target - level) * (target > level ? 0.5 : 0.15);
    if (activeCount === 0 && level <= 0.01) {
      level = 0;
      for (const cb of listeners) cb(0);
      rafId = null;
      return;
    }
    for (const cb of listeners) cb(level);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

/**
 * Subscribe to the live playback level (0..1). The callback fires once per
 * animation frame while audio is playing, and a final `0` when it stops.
 * Returns an unsubscribe fn.
 */
export function subscribeAudioLevel(cb: (level: number) => void): () => void {
  listeners.add(cb);
  cb(level);
  return () => {
    listeners.delete(cb);
  };
}
