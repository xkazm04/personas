// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { reviewMemoriesWithCli, reflectMemoriesWithCli } from '@/api/overview/memories';

/** invokeWithTimeout's fallback when a caller passes no `timeoutMs`. */
const IPC_DEFAULT_TIMEOUT_MS = 90_000;

/** Rust source with `//` and block comments removed, so prose describing a
 *  timeout can never satisfy the matcher. */
function rustSource(rel: string): string {
  return readFileSync(resolve(__dirname, '../../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function secondsFrom(src: string, re: RegExp, what: string): number {
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${what} in the Rust source; update this pin`);
  return Number(m[1]) * 1000;
}

/** `run_memory_review_pipeline` spawns the CLI with this budget, then (in
 *  auto-apply mode, the default) DELETES the low-scored memories. */
const BACKEND_REVIEW_CLI_MS = secondsFrom(
  rustSource('src-tauri/src/commands/core/memories.rs'),
  /let cli_timeout = std::time::Duration::from_secs\((\d+)\);\s*let full_output = crate::engine::cli_process::run_claude_cli\(/,
  'the memory-review CLI timeout',
);

/** The reflection pass's CLI cap. */
const BACKEND_REFLECT_CLI_MS = secondsFrom(
  rustSource('src-tauri/src/engine/memory_reflection.rs'),
  /const CLI_TIMEOUT_SECS: u64 = (\d+);/,
  'CLI_TIMEOUT_SECS',
);

function lastTimeout(): number {
  const call = invokeWithTimeout.mock.calls.at(-1) as [string, unknown, { timeoutMs?: number } | undefined];
  return call[2]?.timeoutMs ?? IPC_DEFAULT_TIMEOUT_MS;
}

describe('memory CLI passes: the IPC wrapper outlives the backend CLI budget', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue({ reviewed: 0, deleted: 0, updated: 0, details: [] });
  });

  it('reads real backend budgets (not a vacuous pin)', () => {
    expect(BACKEND_REVIEW_CLI_MS).toBeGreaterThan(0);
    expect(BACKEND_REFLECT_CLI_MS).toBeGreaterThan(0);
  });

  it('reviewMemoriesWithCli waits past the review CLI timeout, so an auto-apply delete is never orphaned', async () => {
    await reviewMemoriesWithCli('p1', 7, undefined, true);
    expect(invokeWithTimeout.mock.calls[0]?.[0]).toBe('review_memories_with_cli');
    expect(lastTimeout()).toBeGreaterThan(BACKEND_REVIEW_CLI_MS);
  });

  it('reflectMemoriesWithCli waits past the reflection CLI cap', async () => {
    await reflectMemoriesWithCli('p1');
    expect(invokeWithTimeout.mock.calls[0]?.[0]).toBe('reflect_memories_with_cli');
    expect(lastTimeout()).toBeGreaterThan(BACKEND_REFLECT_CLI_MS);
  });
});
