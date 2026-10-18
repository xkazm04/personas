import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { adjustAdoptionDraft } from '@/api/templates/templateAdopt';

/** invokeWithTimeout's fallback when a caller passes no `timeoutMs`. */
const IPC_DEFAULT_TIMEOUT_MS = 90_000;

/** Rust source with `//` and block comments removed, so prose describing a
 *  budget can never satisfy the matcher. */
function rustSource(rel: string): string {
  return readFileSync(resolve(__dirname, '../../../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function numberFrom(src: string, re: RegExp, what: string): number {
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${what} in the Rust source; update this pin`);
  return Number(m[1]);
}

const adoptSrc = rustSource('src-tauri/src/commands/design/template_adopt.rs');
const adjustStart = adoptSrc.indexOf('pub async fn adjust_adoption_draft(');
const adjustBody = adoptSrc.slice(adjustStart, adoptSrc.indexOf('\n#[tauri::command]', adjustStart + 1));

/** The `timeout_secs` the adjustment pass hands the CLI runner. */
const ADJUST_TIMEOUT_SECS = numberFrom(
  adjustBody,
  /run_claude_prompt_text_inner\([^;]*?,\s*(\d+)\s*\)/,
  'the adjust_adoption_draft CLI timeout',
);

/** `timeout_secs` is a silence lease, not a wall clock: a call that keeps
 *  producing lines may run up to `timeout_secs * LEASE_CEILING_FACTOR`. */
const LEASE_CEILING_FACTOR = numberFrom(
  rustSource('src-tauri/src/commands/design/n8n_transform/cli_runner.rs'),
  /const LEASE_CEILING_FACTOR: u32 = (\d+);/,
  'LEASE_CEILING_FACTOR',
);

const BACKEND_WALL_CEILING_MS = ADJUST_TIMEOUT_SECS * LEASE_CEILING_FACTOR * 1000;

function lastTimeout(): number {
  const call = invokeWithTimeout.mock.calls.at(-1) as [string, unknown, { timeoutMs?: number } | undefined];
  return call[2]?.timeoutMs ?? IPC_DEFAULT_TIMEOUT_MS;
}

describe('adjustAdoptionDraft: the IPC wrapper outlives the backend adjustment pass', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue({ adjusted: false, divergence: '', model: null, note: null, elapsedMs: 0 });
  });

  it('reads real backend budgets (not a vacuous pin)', () => {
    expect(adjustStart).toBeGreaterThan(-1);
    expect(ADJUST_TIMEOUT_SECS).toBeGreaterThan(0);
    expect(LEASE_CEILING_FACTOR).toBeGreaterThan(0);
  });

  it('waits past the CLI runner hard ceiling, so the in-place agent_ir rewrite is never orphaned', async () => {
    await adjustAdoptionDraft('s1');
    expect(invokeWithTimeout.mock.calls[0]?.[0]).toBe('adjust_adoption_draft');
    expect(lastTimeout()).toBeGreaterThan(BACKEND_WALL_CEILING_MS);
  });
});
