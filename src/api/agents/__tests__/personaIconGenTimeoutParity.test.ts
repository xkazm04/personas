// @vitest-environment node
// `generate_persona_icon` runs a metered image job inline
// (src-tauri/src/commands/core/persona_icon_gen.rs): one POST, a poll loop
// bounded by POLL_DEADLINE (checked before each POLL_INTERVAL sleep, so one
// more poll starts after it), then the image download, every request on
// SHARED_HTTP's timeout. A wrapper that gives up first reports a failure while
// the backend records the spend and stores the icon, and a retry pays again.
// The backend figures are read from the Rust source at run time so the two
// cannot drift silently. Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve('asset');
  }),
}));

import { generatePersonaIcon } from '@/api/agents/personaIcons';

function rust(path: string): string {
  const raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function secs(src: string, name: string): number {
  const m = new RegExp(`const ${name}: Duration = Duration::from_secs\\((\\d+)\\);`).exec(src);
  expect(m, `${name} not found`).not.toBeNull();
  return Number(m![1]);
}

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async fn ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  return src.slice(start, src.indexOf('\n}\n', start));
}

/** Worst case of one generation, in ms. */
function backendBudgetMs(): number {
  const gen = rust('src-tauri/src/commands/core/persona_icon_gen.rs');
  const http = secs(rust('src-tauri/core/src/http_clients.rs'), 'HTTP_TIMEOUT');
  expect(fnBody(gen, 'generate_persona_icon')).toMatch(/SHARED_HTTP/);
  // The deadline is checked BEFORE the sleep, so one sleep + one poll request
  // can still run after it.
  const poll = fnBody(gen, 'poll_for_image');
  expect(poll.indexOf('POLL_DEADLINE')).toBeLessThan(poll.indexOf('sleep(POLL_INTERVAL)'));
  // Each provider: POST, poll loop, then one download.
  for (const provider of ['leonardo_generate', 'higgsfield_generate']) {
    const body = fnBody(gen, provider);
    expect(body.split('.send()').length - 1).toBe(1);
    expect(body).toMatch(/poll_for_image\(/);
    expect(body).toMatch(/download_image\(/);
  }
  const post = http;
  const pollTail = secs(gen, 'POLL_DEADLINE') + secs(gen, 'POLL_INTERVAL') + http;
  const download = http;
  return (post + pollTail + download) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('persona icon generation IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('waits past the worst-case backend generation', async () => {
    const budget = backendBudgetMs();
    await generatePersonaIcon('cred', 'a fox');
    expect(calls[0]![0]).toBe('generate_persona_icon');
    expect(calls[0]![1]).toEqual({ credentialId: 'cred', prompt: 'a fox' });
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });
});
