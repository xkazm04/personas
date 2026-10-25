// @vitest-environment node
// `companion_probe_engines` runs every engine probe SEQUENTIALLY
// (`probe_engines` in companion/session/launch.rs), each under its own
// PROBE_TIMEOUT. When every probe hangs, the backend still answers with
// per-engine "installed: false" reasons, but only after the sum of the probe
// caps. A wrapper that gives up at or before that sum turns those reasons into
// a bare "probe failed". The backend figures are read from the Rust source at
// run time so the two cannot drift silently. Lives under __tests__/, which tsc
// skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve([]);
  }),
}));

import { companionProbeEngines } from '@/api/companion';

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async fn ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  return src.slice(start, src.indexOf('\n}\n', start));
}

/** Worst case: every `run_probe` in every engine's probe fn hits PROBE_TIMEOUT. */
function sequentialProbeBudgetMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/companion/session/launch.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = /const PROBE_TIMEOUT: Duration = Duration::from_secs\((\d+)\);/.exec(src);
  expect(m, 'PROBE_TIMEOUT not found').not.toBeNull();
  expect(fnBody(src, 'run_probe')).toMatch(/PROBE_TIMEOUT/);
  const top = fnBody(src, 'probe_engines');
  // Sequential: each engine is awaited inside the loop, not joined.
  expect(top).not.toMatch(/join_all|join!/);
  const engines = [...top.matchAll(/=> (probe_\w+)\(\)\.await/g)].map((x) => x[1]!);
  expect(engines.length).toBeGreaterThan(0);
  const probes = engines.reduce((n, e) => n + (fnBody(src, e).split('run_probe(').length - 1), 0);
  return probes * Number(m![1]) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('companion engine probe IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('waits past every sequential probe cap', async () => {
    const budget = sequentialProbeBudgetMs();
    await companionProbeEngines();
    expect(calls[0]![0]).toBe('companion_probe_engines');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });
});
