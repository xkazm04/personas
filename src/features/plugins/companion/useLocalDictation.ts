/**
 * On-device dictation via the local whisper.cpp engine.
 *
 * Drop-in counterpart to {@link useDictation} (same {@link DictationState}
 * surface) that keeps audio on the machine: it captures the mic with
 * `getUserMedia`, records raw PCM through an `AudioContext` pinned to 16 kHz
 * mono, encodes a WAV, and sends it to `companion_stt_transcribe` for local
 * inference. Nothing leaves the device.
 *
 * Batch, not streaming: whisper.cpp transcribes the whole clip at once, so
 * there is no live `interimText`. To preserve the hold-to-talk contract
 * (the consumer reads `finalText` when `listening` flips false), we keep
 * `listening` true through the transcription round-trip — `stop()` ends mic
 * capture but `listening` only clears once `finalText` is populated (a
 * "busy/transcribing" phase). The caller's UI reads this as Athena thinking.
 *
 * Engine readiness (binary installed, model downloaded) is NOT reflected in
 * `supported` — that only gates on `getUserMedia` existing. A missing binary
 * or model surfaces as `error` after the first attempt; the Voice tab is
 * where install/download status is shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { companionSttTranscribe } from '@/api/companion';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import type { DictationState } from './useDictation';

/**
 * whisper.cpp's required input contract: **16 kHz, mono, 16-bit PCM**.
 *
 * The Rust validator (`validate_wav_format`, src-tauri/src/companion/stt/mod.rs)
 * hard-rejects any WAV whose header sample rate is not exactly 16000, so every
 * clip we encode and ship over `companion_stt_transcribe` MUST be 16 kHz mono.
 *
 * We *request* this rate via `new AudioContext({ sampleRate: 16000 })`, but the
 * option is only honored on Chromium/WebView2 (Windows). WebKit-based webviews
 * (WKWebView on macOS, WebKitGTK on Linux) historically IGNORE it and run the
 * context at the hardware rate (44.1/48 kHz). {@link resampleTo16k} reconciles
 * that mismatch on the client before {@link encodeWav}, so the contract holds
 * on every platform instead of silently breaking on WebKit.
 */
const TARGET_SAMPLE_RATE = 16000;

/**
 * Resample mono Float32 PCM from `fromRate` to {@link TARGET_SAMPLE_RATE}
 * (16 kHz) via linear interpolation. Handles both decimation (48 kHz → 16 kHz)
 * and upsampling; plain linear interpolation is sufficient for whisper, which
 * band-limits its own input. Returns the buffer unchanged when it is already
 * at the target rate (the Chromium/WebView2 fast path is a no-op).
 */
function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_SAMPLE_RATE || input.length === 0) return input;
  const ratio = TARGET_SAMPLE_RATE / fromRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  const lastIdx = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio; // position in the source-rate timeline
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, lastIdx);
    const frac = srcPos - i0;
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  }
  return out;
}

/** Encode mono Float32 PCM samples as a 16-bit PCM WAV (little-endian). */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface AudioContextCtor {
  new (opts?: { sampleRate?: number }): AudioContext;
}

export function useLocalDictation({ lang }: { lang?: string } = {}): DictationState {
  const modelId = useSystemStore((s) => s.companionSttModelId);

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' &&
    !!((window as unknown as { AudioContext?: AudioContextCtor }).AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext);

  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  // getUserMedia shows an async permission prompt; `start` only flips
  // `listening` true once it resolves. If the user releases (or the component
  // unmounts) DURING that prompt, `stop`/teardown can't see an in-flight start
  // and the late resolution strands the UI in "listening". `pendingStartRef`
  // marks the in-flight window; `abortStartRef` is raised to cancel it.
  const pendingStartRef = useRef(false);
  const abortStartRef = useRef(false);
  const modelRef = useRef<string | null>(modelId);
  modelRef.current = modelId;
  const langRef = useRef<string | undefined>(lang);
  langRef.current = lang;
  // Monotonic transcription id. Each `finishAndTranscribe` claims the next id;
  // a result only applies if it is still the latest. Guards the case where a
  // `reset()` (or a newer turn) happens while an earlier transcription is still
  // resolving — a slow stale result must not clobber the current finalText.
  const transcribeIdRef = useRef(0);

  const teardown = useCallback(() => {
    try {
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch (err) {
      silentCatch('useLocalDictation.teardown.disconnect')(err);
    }
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(silentCatch('useLocalDictation.teardown.ctxClose'));
    }
  }, []);

  // On unmount, also abort any in-flight start so a getUserMedia that resolves
  // after teardown releases its stream instead of leaking a live mic.
  useEffect(() => () => { abortStartRef.current = true; teardown(); }, [teardown]);

  const start = useCallback(() => {
    if (listening) return;
    if (!modelRef.current) {
      setError('no_model_selected');
      return;
    }
    setError(null);
    setFinalText('');
    chunksRef.current = [];
    const Ctor =
      (window as unknown as { AudioContext?: AudioContextCtor }).AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) {
      setError('audio_unsupported');
      return;
    }
    pendingStartRef.current = true;
    abortStartRef.current = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        pendingStartRef.current = false;
        // Released / unmounted while the permission prompt was up — don't enter
        // listening; just release the freshly-acquired mic so it isn't left on.
        if (abortStartRef.current) {
          abortStartRef.current = false;
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          chunksRef.current.push(new Float32Array(input));
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        setListening(true);
      })
      .catch((err: unknown) => {
        pendingStartRef.current = false;
        abortStartRef.current = false;
        setError(err instanceof Error ? err.message : 'mic_denied');
        teardown();
        setListening(false);
      });
  }, [listening, teardown]);

  const finishAndTranscribe = useCallback(() => {
    // Concatenate captured PCM, encode WAV, transcribe. `listening` stays
    // true until the transcript lands so the hold-to-talk consumer reads
    // finalText on the listening→false transition.
    // The context may NOT actually be 16 kHz (WebKit ignores the requested
    // rate), so capture whatever it ran at and resample below.
    const captureRate = ctxRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    teardown();

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const model = modelRef.current;
    if (total === 0 || !model) {
      setListening(false);
      return;
    }
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    // Pin to the 16 kHz contract before encoding: resample if the platform gave
    // us a different rate (no-op on Chromium/WebView2), then stamp 16000 in the
    // WAV header so the Rust validator accepts it on every webview.
    const samples16k = resampleTo16k(merged, captureRate);
    const wav = encodeWav(samples16k, TARGET_SAMPLE_RATE);
    const base64 = bytesToBase64(wav);

    const reqId = ++transcribeIdRef.current;
    companionSttTranscribe(base64, model, langRef.current)
      .then((text) => {
        // Discard a stale result that resolved after a reset / newer turn.
        if (transcribeIdRef.current !== reqId) return;
        setFinalText(text.trim());
      })
      .catch((err: unknown) => {
        if (transcribeIdRef.current === reqId) {
          setError(err instanceof Error ? err.message : String(err));
        }
        silentCatch('companion_stt_transcribe')(err);
      })
      .finally(() => setListening(false));
  }, [teardown]);

  const stop = useCallback(() => {
    // Released before the mic permission resolved — abort the pending start so
    // the late getUserMedia resolution doesn't strand us in "listening".
    if (pendingStartRef.current) {
      abortStartRef.current = true;
      return;
    }
    if (!listening) return;
    finishAndTranscribe();
  }, [listening, finishAndTranscribe]);

  const reset = useCallback(() => {
    // Bump the id so any transcription still in flight is treated as stale and
    // can't repopulate the text we're clearing here.
    transcribeIdRef.current++;
    setFinalText('');
    setError(null);
  }, []);

  return {
    supported,
    listening,
    finalText,
    // Whisper is batch — no live interim transcript.
    interimText: '',
    error,
    start,
    stop,
    reset,
  };
}
