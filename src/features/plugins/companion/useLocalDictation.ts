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

const TARGET_SAMPLE_RATE = 16000;

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
  const modelRef = useRef<string | null>(modelId);
  modelRef.current = modelId;
  const langRef = useRef<string | undefined>(lang);
  langRef.current = lang;

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

  useEffect(() => () => teardown(), [teardown]);

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
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
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
        setError(err instanceof Error ? err.message : 'mic_denied');
        teardown();
        setListening(false);
      });
  }, [listening, teardown]);

  const finishAndTranscribe = useCallback(() => {
    // Concatenate captured PCM, encode WAV, transcribe. `listening` stays
    // true until the transcript lands so the hold-to-talk consumer reads
    // finalText on the listening→false transition.
    const sampleRate = ctxRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;
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
    const wav = encodeWav(merged, sampleRate);
    const base64 = bytesToBase64(wav);

    companionSttTranscribe(base64, model, langRef.current)
      .then((text) => {
        setFinalText(text.trim());
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        silentCatch('companion_stt_transcribe')(err);
      })
      .finally(() => setListening(false));
  }, [teardown]);

  const stop = useCallback(() => {
    if (!listening) return;
    finishAndTranscribe();
  }, [listening, finishAndTranscribe]);

  const reset = useCallback(() => {
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
