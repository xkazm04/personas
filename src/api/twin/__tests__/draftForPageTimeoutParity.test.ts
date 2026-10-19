// `twin_draft_for_page` (src-tauri/src/commands/infrastructure/twin.rs) runs
// one CLI call under `TwinCall::legacy`, whose hard deadline is LEGACY_TIMEOUT
// (src-tauri/src/engine/twin_setup/llm.rs). A wrapper that gives up first puts
// the Browser twin lane into "failed" while the model is still writing, and a
// Regenerate then starts a second paid call. The Rust figures are read from
// source at run time so the two cannot drift. Lives under __tests__/, which
// tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({ draft: 'x', toneChannel: 'browser', kbGrounded: false });
  }),
}));

import { draftForPage } from '@/api/twin/twin';

function rust(path: string): string {
  const raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function backendBudgetMs(): number {
  const cmd = rust('src-tauri/src/commands/infrastructure/twin.rs');
  const start = cmd.indexOf('async fn twin_draft_for_page(');
  expect(start, 'twin_draft_for_page not found').toBeGreaterThanOrEqual(0);
  const body = cmd.slice(start, cmd.indexOf('\n}\n', start));
  // The budget below is the legacy call's; a different TwinCall needs a new figure.
  expect(body).toMatch(/TwinCall::legacy\("draft_for_page"\)/);
  const llm = rust('src-tauri/src/engine/twin_setup/llm.rs');
  const m = /const LEGACY_TIMEOUT: Duration = Duration::from_secs\((\d+)\);/.exec(llm);
  expect(m, 'LEGACY_TIMEOUT not found').not.toBeNull();
  return Number(m![1]) * 1000;
}

describe('draftForPage IPC timeout outlives the backend draft call', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('passes a timeout above the legacy CLI deadline', async () => {
    await draftForPage('twin-1', {} as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('twin_draft_for_page');
    const opts = calls[0]![2] as { timeoutMs?: number } | undefined;
    expect(opts?.timeoutMs, 'no explicit timeout: the 90 s default applies').toBeDefined();
    expect(opts!.timeoutMs!).toBeGreaterThan(backendBudgetMs());
  });
});
