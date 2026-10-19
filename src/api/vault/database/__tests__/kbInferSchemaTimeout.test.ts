import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { kbInferSchema } from '@/api/vault/database/vectorKb';

/** invokeWithTimeout's fallback when a caller passes no `timeoutMs`. */
const IPC_DEFAULT_TIMEOUT_MS = 90_000;

/** Rust source with comments removed, so prose describing a budget can never
 *  satisfy the matcher. */
function rustSource(rel: string): string {
  return readFileSync(resolve(__dirname, '../../../../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function numberFrom(src: string, re: RegExp, what: string): number {
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${what} in the Rust source; update this pin`);
  return Number(m[1]);
}

const extractSrc = rustSource('src-tauri/src/engine/kb_extract.rs');
const inferStart = extractSrc.indexOf('pub async fn infer_schema(');
const inferBody = extractSrc.slice(inferStart, extractSrc.indexOf('\npub ', inferStart + 1));

/** The `timeout_secs` schema inference hands the CLI runner. */
const INFER_TIMEOUT_SECS = numberFrom(
  inferBody,
  /run_claude_prompt_text_inner\([^;]*?,\s*(\d+)\s*,?\s*\)/,
  'the infer_schema CLI timeout',
);

/** A silence lease, not a wall clock: the runner stops a talking call at
 *  `timeout_secs * LEASE_CEILING_FACTOR`. */
const LEASE_CEILING_FACTOR = numberFrom(
  rustSource('src-tauri/src/commands/design/n8n_transform/cli_runner.rs'),
  /const LEASE_CEILING_FACTOR: u32 = (\d+);/,
  'LEASE_CEILING_FACTOR',
);

/** `with_escalation` runs a rejected output once more on the escalation route. */
const LEGS = inferBody.includes('with_escalation(') ? 2 : 1;

const BACKEND_WALL_CEILING_MS = INFER_TIMEOUT_SECS * LEASE_CEILING_FACTOR * LEGS * 1000;

describe('kbInferSchema: the IPC wrapper outlives the backend inference call', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue({ entities: [] });
  });

  it('reads real backend budgets (not a vacuous pin)', () => {
    expect(inferStart).toBeGreaterThan(-1);
    expect(INFER_TIMEOUT_SECS).toBeGreaterThan(0);
    expect(LEASE_CEILING_FACTOR).toBeGreaterThan(0);
    expect(LEGS).toBe(2);
  });

  it('waits past both legs of the escalated call at their hard ceiling', async () => {
    await kbInferSchema('kb-1');
    const call = invokeWithTimeout.mock.calls[0] as [string, unknown, { timeoutMs?: number } | undefined];
    expect(call[0]).toBe('kb_infer_schema');
    expect(call[2]?.timeoutMs ?? IPC_DEFAULT_TIMEOUT_MS).toBeGreaterThan(BACKEND_WALL_CEILING_MS);
  });
});
