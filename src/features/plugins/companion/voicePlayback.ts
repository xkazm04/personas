import { companionTts, type TtsSettings } from '@/api/companion';

/**
 * Voice-playback helpers for Athena's spoken summaries.
 *
 * Two-step pipeline:
 *   1. `synthesize()` — calls the backend TTS proxy (ElevenLabs) with the
 *      stashed text + the user's chosen voice config, decodes the base64
 *      bytes into a Blob, and returns an object URL suitable for an
 *      `<audio>` element's `src` (or `new Audio(url).play()`).
 *   2. `play()` — drives an Audio element to completion. We deliberately
 *      use a fresh element per play (rather than reusing one global) so
 *      browsers don't reject `play()` calls on rapid successive triggers
 *      due to their "media element already playing" guard.
 *
 * Audio URLs are cached on the playback record (see companionStore) so
 * that "Replay" doesn't re-hit ElevenLabs. Caller is responsible for
 * `URL.revokeObjectURL` when discarding (currently we let the page
 * unload do it — these blobs are ~50KB).
 */
export async function synthesize(
  text: string,
  credentialId: string,
  voiceId: string,
  settings?: TtsSettings,
): Promise<string> {
  const audio = await companionTts(text, credentialId, voiceId, settings);
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
