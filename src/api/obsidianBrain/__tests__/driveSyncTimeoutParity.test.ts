// @vitest-environment node
// `obsidian_drive_push_sync` / `obsidian_drive_pull_sync` run inline and make
// sequential Google calls per file (push_to_drive / pull_from_drive in
// src-tauri/src/commands/obsidian_brain/drive.rs). Each call has its own
// deadline (build_drive_client) but the sync as a whole grows with the vault,
// so the backend budget has no constant to mirror. The wrapper therefore has to wait as long as the ceiling tauriInvoke
// gives other blocking mutations, not the 90 s default. Both facts are read
// from source at run time: if the backend gains a deadline or goes parallel,
// this test names the number to revisit. Lives under __tests__/, which tsc
// skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({ uploaded: 0, downloaded: 0, deleted: 0, skipped: 0, errors: [] });
  }),
}));

import { obsidianDrivePullSync, obsidianDrivePushSync } from '@/api/obsidianBrain';

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`fn ${name}\\(`));
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  return src.slice(start, src.indexOf('\n}\n', start));
}

/** The ceiling tauriInvoke.ts gives blocking mutations (LONG_MUTATION_TIMEOUT_MS). */
function longMutationCeilingMs(): number {
  const src = stripComments(readFileSync(resolve(process.cwd(), 'src/lib/tauriInvoke.ts'), 'utf8'));
  const m = /const LONG_MUTATION_TIMEOUT_MS = (\d+) \* 60_000;/.exec(src);
  expect(m, 'LONG_MUTATION_TIMEOUT_MS not found').not.toBeNull();
  return Number(m![1]) * 60_000;
}

function assertBackendIsSequentialWithPerCallDeadline(): void {
  const src = stripComments(
    readFileSync(resolve(process.cwd(), 'src-tauri/src/commands/obsidian_brain/drive.rs'), 'utf8'),
  );
  // A per-call deadline on the Drive client (a stalled call fails, never hangs) ...
  expect(fnBody(src, 'build_drive_client')).toMatch(/\.timeout\(/);
  // ... and every file is awaited one after another, never joined.
  for (const fn of ['push_to_drive', 'pull_from_drive']) {
    const body = fnBody(src, fn);
    expect(body).toMatch(/for \w+ in /);
    expect(body).not.toMatch(/join_all|buffer_unordered|join!/);
    expect(body).toMatch(/save_manifest\(/);
  }
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('Obsidian Drive sync IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it.each([
    ['obsidian_drive_push_sync', () => obsidianDrivePushSync()],
    ['obsidian_drive_pull_sync', () => obsidianDrivePullSync(['Personas'])],
  ] as const)('%s waits for the blocking-mutation ceiling', async (cmd, call) => {
    assertBackendIsSequentialWithPerCallDeadline();
    await call();
    expect(calls[0]![0]).toBe(cmd);
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThanOrEqual(longMutationCeilingMs());
  });

  it('still short-circuits an empty folder list without an IPC call', async () => {
    await obsidianDrivePushSync([]);
    await obsidianDrivePullSync([]);
    expect(calls).toHaveLength(0);
  });
});
