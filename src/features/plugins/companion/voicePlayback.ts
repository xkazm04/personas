import { companionTts, type TtsEngineId, type TtsSettings } from '@/api/companion';
import { attachPlayback } from './audioLevel';

/**
 * Voice-playback helpers for Athena's spoken summaries.
 *
 * Two-step pipeline:
 *   1. `synthesize()` — calls the backend TTS dispatcher with the chosen
 *      engine + voice + tuning, decodes the base64 bytes into a Blob,
 *      and returns an object URL suitable for an `<audio>` element's
 *      `src` (or `new Audio(url).play()`).
 *   2. `play()` — drives an Audio element to completion. We deliberately
 *      use a fresh element per play (rather than reusing one global) so
 *      browsers don't reject `play()` calls on rapid successive triggers
 *      due to their "media element already playing" guard.
 *
 * Audio URLs are cached on the playback record (see companionStore) so
 * that "Replay" doesn't re-hit the engine. Caller is responsible for
 * `URL.revokeObjectURL` when discarding (currently we let the page
 * unload do it — ElevenLabs MP3 is ~50KB; Piper WAV is ~150-300KB).
 */
export async function synthesize(
  text: string,
  credentialId: string | null,
  voiceId: string,
  settings?: TtsSettings,
  engine: TtsEngineId = 'elevenlabs',
): Promise<string> {
  const audio = await companionTts(text, credentialId, voiceId, settings, engine);
  const bytes = base64ToBytes(audio.audioBase64);
  // Cast to BlobPart: TS's lib.dom.d.ts in this project narrows BlobPart's
  // buffer to ArrayBuffer (not SharedArrayBuffer), which Uint8Array's
  // generic ArrayBufferLike doesn't satisfy. The runtime accepts both.
  const blob = new Blob([bytes as BlobPart], { type: audio.mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Play an audio URL through a transient `<audio>` element. Resolves when
 * the clip finishes, rejects on playback error.
 *
 * This intentionally returns the active element so callers can pause it
 * (e.g., when the user closes the panel mid-speech).
 */
export function play(url: string): { audio: HTMLAudioElement; done: Promise<void> } {
  const audio = new Audio(url);
  audio.preload = 'auto';
  // Route through the shared analyser so UI (the orb's glow) can react to
  // the live speech level. Best-effort — never blocks or breaks playback.
  attachPlayback(audio);
  const done = new Promise<void>((resolve, reject) => {
    audio.addEventListener('ended', () => resolve(), { once: true });
    audio.addEventListener(
      'error',
      () => reject(new Error('audio playback failed')),
      { once: true },
    );
    audio.play().catch(reject);
  });
  return { audio, done };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
