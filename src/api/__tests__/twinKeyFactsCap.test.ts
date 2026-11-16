// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { recordInteraction } from '@/api/twin/twin';

/**
 * The cap, read from the db crate's `KEY_FACTS_JSON_MAX_BYTES` (comments
 * stripped). That constant is documented as a mirror of the wrapper's
 * `TWIN_KEY_FACTS_JSON_MAX_BYTES`; reading it here, instead of typing the
 * number a third time, makes the boundary cases below fail when either side
 * moves alone (a lower Rust cap would let the wrapper admit payloads the
 * backend then rejects).
 */
const CAP_BYTES = (() => {
  const src = readFileSync(resolve(__dirname, '../../..', 'src-tauri/db/src/repos/twin.rs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const m = /pub const KEY_FACTS_JSON_MAX_BYTES: usize = (\d+)(?:\s*\*\s*(\d+))?;/.exec(src);
  if (!m) throw new Error('KEY_FACTS_JSON_MAX_BYTES not found in db/src/repos/twin.rs; update this pin');
  return Number(m[1]) * (m[2] ? Number(m[2]) : 1);
})();

/** A valid JSON string literal whose UTF-8 encoding is exactly `bytes` long. */
function asciiJsonOfBytes(bytes: number): string {
  return JSON.stringify('x'.repeat(bytes - 2));
}

const record = (keyFactsJson?: string) =>
  recordInteraction('twin-1', 'generic', 'in', 'hello', undefined, undefined, keyFactsJson);

function sentKeyFacts(): unknown {
  const call = invokeWithTimeout.mock.calls.at(-1) as [string, Record<string, unknown>];
  return call[1].keyFactsJson;
}

describe('recordInteraction keyFactsJson trust boundary', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue({ id: 'c1' });
  });

  it('passes an absent payload through as undefined', async () => {
    await record(undefined);
    expect(invokeWithTimeout).toHaveBeenCalledTimes(1);
    expect(sentKeyFacts()).toBeUndefined();
  });

  it('accepts a payload of exactly the cap', async () => {
    const value = asciiJsonOfBytes(CAP_BYTES);
    await record(value);
    expect(sentKeyFacts()).toBe(value);
  });

  it('rejects one byte over the cap without calling the backend', () => {
    expect(() => record(asciiJsonOfBytes(CAP_BYTES + 1))).toThrow(new RegExp(`exceeds ${CAP_BYTES} bytes`));
    expect(invokeWithTimeout).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    // Enough euro signs (3 UTF-8 bytes, 1 code unit each) to pass the cap in
    // bytes while staying far under it in code units - at 64 KiB, 21,846 signs:
    // 21,848 code units but 65,540 bytes.
    const value = JSON.stringify('€'.repeat(Math.ceil((CAP_BYTES - 1) / 3)));
    expect(new TextEncoder().encode(value).length).toBeGreaterThan(CAP_BYTES);
    expect(value.length).toBeLessThan(CAP_BYTES);
    expect(() => record(value)).toThrow(new RegExp(`exceeds ${CAP_BYTES} bytes`));
    expect(invokeWithTimeout).not.toHaveBeenCalled();
  });

  it('rejects unparseable JSON without calling the backend', () => {
    expect(() => record('{"facts": [1, 2')).toThrow(/keyFactsJson is not valid JSON/);
    expect(invokeWithTimeout).not.toHaveBeenCalled();
  });
});
