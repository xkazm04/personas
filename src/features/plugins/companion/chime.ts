/**
 * Subtle two-note chime played when Athena finishes a reply. Synthesized
 * with Web Audio so we don't ship an audio asset; ~300ms total at low
 * gain so it acknowledges without intruding.
 *
 * AudioContext is lazily created and reused. Browsers require a prior
 * user gesture before an AudioContext can play, but by the time a chat
 * turn completes the user has already clicked at least one thing
 * (panel open, send), so the context is allowed to start.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function playTone(
  audio: AudioContext,
  freq: number,
  startAt: number,
  durationSec: number,
  peakGain: number,
) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Quick attack, gentle release — a soft "ding", not a click or thud.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

/**
 * Play the "reply received" chime. Best-effort: silently no-ops if the
 * browser blocks audio (e.g., no prior user gesture, OS muted, etc.).
 */
export function playReplyChime() {
  const audio = getCtx();
  if (!audio) return;
  // If the context was suspended (tab inactive, etc.), try to resume.
  if (audio.state === 'suspended') {
    audio.resume().catch(() => {});
  }
  const now = audio.currentTime;
  // Two ascending notes, ~80ms apart. A4 (440Hz) → E5 (659Hz) — major
  // sixth, neutral and pleasant.
  playTone(audio, 440, now, 0.18, 0.04);
  playTone(audio, 659.25, now + 0.08, 0.22, 0.04);
}
