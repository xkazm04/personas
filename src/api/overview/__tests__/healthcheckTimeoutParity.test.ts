// @vitest-environment node
// `test_credential_design_healthcheck` (src-tauri/src/commands/credentials/
// credential_design.rs) runs one Claude CLI prompt inline under its own
// `run_claude_prompt(.., <secs>, ..)` budget before it answers. A wrapper that
// gives up first shows a failed healthcheck while the backend finishes, and a
// retry pays for a second CLI call. The backend figure is read from the Rust
// source at run time so the two cannot drift. Lives under __tests__/, which
// tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({});
  }),
}));

import { testCredentialDesignHealthcheck } from '../healthcheckApi';

function backendBudgetMs(): number {
  const raw = readFileSync(
    resolve(process.cwd(), 'src-tauri/src/commands/credentials/credential_design.rs'),
    'utf8',
  );
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = src.indexOf('async fn test_credential_design_healthcheck(');
  expect(start, 'test_credential_design_healthcheck not found').toBeGreaterThanOrEqual(0);
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const m = /run_claude_prompt\(\s*prompt_text,\s*&cli_args,\s*(\d+),/.exec(body);
  expect(m, 'run_claude_prompt budget not found').not.toBeNull();
  return Number(m![1]) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  if (typeof args[3] === 'number') return args[3];
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('credential design healthcheck IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('outlives the backend CLI budget', async () => {
    await testCredentialDesignHealthcheck('instr', {}, {});
    expect(calls[0]![0]).toBe('test_credential_design_healthcheck');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(backendBudgetMs());
  });
});
