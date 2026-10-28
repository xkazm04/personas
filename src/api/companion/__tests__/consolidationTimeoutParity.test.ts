// @vitest-environment node
// Athena's brain passes run one Claude call inline under an absolute backstop
// (`call_claude_text(.., backstop)` in companion/brain/oneshot.rs). If the IPC
// wrapper gives up first, the UI reports a failure while the backend goes on
// to write its proposals / reflection, and a retry runs a second pass. The
// backend figures are read from the Rust source at run time so the two cannot
// drift silently. Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve('');
  }),
}));

import { companionRunConsolidation, companionRunReflection } from '@/api/companion';
import { companionComposeBriefing } from '../briefing';

function backstopSecs(file: string, constName: string): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/companion/brain', file), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = new RegExp(`const ${constName}: Duration = Duration::from_secs\\((\\d+)\\)`).exec(src);
  expect(m, `${constName} not found in ${file}`).not.toBeNull();
  // The constant must be the one the Claude call actually receives.
  expect(src).toMatch(new RegExp(`call_claude_text\\([^;]*${constName}`));
  return Number(m![1]);
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('companion brain IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('consolidation waits past the backend backstop', async () => {
    const secs = backstopSecs('consolidation.rs', 'CONSOLIDATION_TIMEOUT');
    await companionRunConsolidation();
    expect(calls[0]![0]).toBe('companion_run_consolidation');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(secs * 1000);
  });

  it('reflection waits past the backend backstop', async () => {
    const secs = backstopSecs('reflection.rs', 'REFLECTION_TIMEOUT');
    await companionRunReflection();
    expect(calls[0]![0]).toBe('companion_run_reflection');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(secs * 1000);
  });

  it('briefing waits past the backend backstop', async () => {
    const secs = backstopSecs('briefing.rs', 'BRIEFING_TIMEOUT');
    await companionComposeBriefing({} as Parameters<typeof companionComposeBriefing>[0]);
    expect(calls[0]![0]).toBe('companion_compose_briefing');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(secs * 1000);
  });
});
