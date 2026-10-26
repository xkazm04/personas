// @vitest-environment node
// Dictation (whisper) and speech synthesis (Kokoro / Pocket) run a local
// sidecar INLINE and resolve only when it exits. Each sidecar wait carries its
// own hard cap in the Rust source (WHISPER_TIMEOUT, KOKORO_TIMEOUT,
// POCKET_SIDECAR_TIMEOUT, POCKET_TIMEOUT). If the IPC wrapper gives up first
// (the 90 s default), the UI reports a failed dictation / silent reply while the
// backend finishes and its transcript or audio is thrown away; the next attempt
// then queues behind the still-running sidecar's semaphore. The backend figures
// are read from the Rust source at run time so the two cannot drift silently.
// Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve(undefined);
  }),
}));

import { companionSttTranscribe, companionTts } from '@/api/companion';

function rustSource(rel: string): string {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/companion', rel), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** `const <name>: Duration = Duration::from_secs(<n>)` in `rel`, in ms. */
function rustTimeoutMs(rel: string, name: string): number {
  const src = rustSource(rel);
  const m = new RegExp(`const ${name}: Duration = Duration::from_secs\\((\\d+)\\)`).exec(src);
  expect(m, `${name} not found in ${rel}`).not.toBeNull();
  // The constant must actually bound a wait, or it is not the budget.
  expect(src).toMatch(new RegExp(`(?:timeout\\(${name},|\\.timeout\\(${name}\\))`));
  return Number(m![1]) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('companion voice IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('dictation waits past the whisper sidecar cap', async () => {
    const budget = rustTimeoutMs('stt/whisper.rs', 'WHISPER_TIMEOUT');
    await companionSttTranscribe('UklGRg==', 'base.en');
    expect(calls[0]![0]).toBe('companion_stt_transcribe');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });

  it('speech synthesis waits past the slowest engine cap', async () => {
    const budget = Math.max(
      rustTimeoutMs('tts/kokoro.rs', 'KOKORO_TIMEOUT'),
      rustTimeoutMs('tts/pocket.rs', 'POCKET_SIDECAR_TIMEOUT'),
      rustTimeoutMs('tts/pocket.rs', 'POCKET_TIMEOUT'),
    );
    for (const engine of ['kokoro', 'pocket_tts'] as const) {
      calls.length = 0;
      await companionTts('hello', null, 'af_heart', undefined, engine);
      expect(calls[0]![0]).toBe('companion_tts');
      expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
    }
  });
});
