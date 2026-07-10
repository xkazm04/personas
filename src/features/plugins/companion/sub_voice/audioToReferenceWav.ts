/**
 * Convert an uploaded audio file (mp3 / wav / flac / ogg — anything the
 * WebView's `decodeAudioData` understands) into the reference-WAV shape the
 * Pocket TTS sidecar expects: 24 kHz, mono, 16-bit PCM, trimmed to a max
 * duration. Doing this in the webview keeps the Rust side free of audio
 * decoders and means "upload a recording" accepts whatever the user has.
 */

/** Pocket TTS models operate at 24 kHz; the reference is resampled to match. */
const TARGET_SAMPLE_RATE = 24_000;
/** Kyutai truncates prompts at 30s anyway — trimming client-side keeps the
 *  upload payload ~1.4MB and the embedding step fast. */
const MAX_SECONDS = 30;

export class AudioDecodeError extends Error {}

export async function fileToReferenceWav(file: File): Promise<Uint8Array> {
  const raw = await file.arrayBuffer();

  // Decode with a throwaway context (decodeAudioData needs one), then render
  // through an OfflineAudioContext to resample to 24 kHz mono in one pass.
  const probe = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(raw);
  } catch {
    throw new AudioDecodeError(file.name);
  } finally {
    void probe.close();
  }

  const seconds = Math.min(decoded.duration, MAX_SECONDS);
  const frames = Math.max(1, Math.floor(seconds * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();

  return encodeWavPcm16(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
}

/** Minimal RIFF/WAVE writer: mono 16-bit PCM. */
function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** Uint8Array → base64 without blowing the arg-spread stack on large files. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Derive a valid voice id from a filename: stem → [A-Za-z0-9_-] only. */
export function voiceIdFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  return stem.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'my_voice';
}
