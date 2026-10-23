// The whisper model download and the three one-click sidecar installers run
// their downloads INLINE and resolve only when the files are on disk. Each
// download leg has its own reqwest `DOWNLOAD_TIMEOUT` (20 min), and the Kokoro /
// Pocket installers run two legs back to back. If the IPC wrapper gives up
// first (the 90 s default), the UI flips the row to "failed" and re-enables the
// install button while the backend keeps downloading; a second click then hits
// the backend's in-flight guard ("already in progress"). The backend figures
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

import {
  companionSttDownloadModel,
  companionSttInstallEngine,
  companionTtsKokoroDownload,
  companionTtsPocketDownload,
} from '@/api/companion';

function rustSource(rel: string): string {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/companion', rel), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The backend's whole budget: per-leg `DOWNLOAD_TIMEOUT` x the number of
 *  download legs the entry function runs before it resolves. */
function backendBudgetMs(rel: string, entryFn: string, legCall: string): number {
  const src = rustSource(rel);
  const m = /const DOWNLOAD_TIMEOUT: (?:std::time::)?Duration = (?:std::time::)?Duration::from_secs\(([\d\s*]+)\)/.exec(src);
  expect(m, `DOWNLOAD_TIMEOUT not found in ${rel}`).not.toBeNull();
  const secs = m![1]!.split('*').reduce((acc, n) => acc * Number(n.trim()), 1);
  // The client the legs use must actually carry that timeout.
  expect(src).toMatch(/\.timeout\(DOWNLOAD_TIMEOUT\)/);
  const start = src.indexOf(`async fn ${entryFn}(`);
  expect(start, `${entryFn} not found in ${rel}`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);
  const legs = body.split(`${legCall}(`).length - 1;
  expect(legs, `no ${legCall} legs in ${entryFn}`).toBeGreaterThan(0);
  return legs * secs * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('companion sidecar download IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('whisper model download waits past the download leg', async () => {
    const budget = backendBudgetMs('stt/downloader.rs', 'download_model', 'stream_to_file');
    await companionSttDownloadModel('base.en');
    expect(calls[0]![0]).toBe('companion_stt_download_model');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });

  it('whisper engine install waits past its download leg', async () => {
    const budget = backendBudgetMs('stt/installer.rs', 'install_inner', 'download_to_file');
    await companionSttInstallEngine();
    expect(calls[0]![0]).toBe('companion_stt_install_engine');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });

  it('kokoro install waits past both download legs', async () => {
    const budget = backendBudgetMs('tts/kokoro_installer.rs', 'install_inner', 'download_to_file');
    await companionTtsKokoroDownload();
    expect(calls[0]![0]).toBe('companion_tts_kokoro_download');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });

  it('pocket install waits past both download legs', async () => {
    const budget = backendBudgetMs('tts/pocket_installer.rs', 'install_inner', 'download_to_file');
    await companionTtsPocketDownload();
    expect(calls[0]![0]).toBe('companion_tts_pocket_download');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });
});
