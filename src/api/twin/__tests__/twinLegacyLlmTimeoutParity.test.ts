// The twin commands that run one `TwinCall::legacy` CLI call share
// LEGACY_TIMEOUT (src-tauri/src/engine/twin_setup/llm.rs). compile_wiki,
// audit_wiki and reflect persist their result, so a wrapper that gives up at
// the 90 s IPC default rejects while the write still lands and a retry runs
// the call twice. The Rust figure is read from source so the two cannot drift.
// Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve('x');
  }),
}));

import {
  auditWiki, compileWiki, draftReply, generateBio, materializeTwinStyle, reflectOnTwin, rollTwinStyles,
  simulateAnswer,
} from '@/api/twin/twin';

function rust(path: string): string {
  const raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function legacyBudgetMs(): number {
  const m = /const LEGACY_TIMEOUT: Duration = Duration::from_secs\((\d+)\);/.exec(
    rust('src-tauri/src/engine/twin_setup/llm.rs'),
  );
  expect(m, 'LEGACY_TIMEOUT not found').not.toBeNull();
  return Number(m![1]) * 1000;
}

const CASES: Array<[string, string, () => Promise<unknown>]> = [
  ['twin_generate_bio', 'generate_bio', () => generateBio('n', null, 'k')],
  ['twin_simulate_answer', 'simulate_answer', () => simulateAnswer('t', 'q')],
  ['twin_draft_reply', 'draft_reply', () => draftReply('t', 'email' as never)],
  ['twin_compile_wiki', 'compile_wiki', () => compileWiki('t')],
  ['twin_audit_wiki', 'audit_wiki', () => auditWiki('t')],
  ['twin_reflect', 'reflect', () => reflectOnTwin('t', 's')],
];

describe('twin legacy LLM wrappers outlive the backend CLI deadline', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it.each(CASES)('%s passes a timeout above LEGACY_TIMEOUT', async (cmd, label, run) => {
    const src = rust('src-tauri/src/commands/infrastructure/twin.rs');
    expect(src, `${cmd} must still run under TwinCall::legacy`).toContain(`TwinCall::legacy("${label}")`);
    await run();
    expect(calls[0]![0]).toBe(cmd);
    const opts = calls[0]![2] as { timeoutMs?: number } | undefined;
    expect(opts?.timeoutMs, 'no explicit timeout: the 90 s default applies').toBeDefined();
    expect(opts!.timeoutMs!).toBeGreaterThan(legacyBudgetMs());
  });
});

describe('twin style wrappers outlive the repair retry (two legacy calls)', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it.each([
    ['twin_style_roll', () => rollTwinStyles('t', {} as never, [])],
    ['twin_style_materialize', () => materializeTwinStyle('t', {} as never, [])],
  ] as Array<[string, () => Promise<unknown>]>)('%s timeout exceeds 2 x LEGACY_TIMEOUT', async (cmd, run) => {
    const src = rust('src-tauri/src/commands/infrastructure/twin_style.rs');
    expect(src).toContain('TwinCall::legacy(site)');
    await run();
    expect(calls[0]![0]).toBe(cmd);
    const opts = calls[0]![2] as { timeoutMs?: number } | undefined;
    expect(opts!.timeoutMs!).toBeGreaterThan(2 * legacyBudgetMs());
  });
});
