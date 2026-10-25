// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { recordInteraction } from '@/api/twin/twin';

/** The wrapper's trust-boundary cap (`TWIN_KEY_FACTS_JSON_MAX_BYTES`). */
const CAP_BYTES = 64 * 1024;

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
    expect(() => record(asciiJsonOfBytes(CAP_BYTES + 1))).toThrow(/exceeds 65536 bytes/);
    expect(invokeWithTimeout).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    // 21,846 euro signs: 21,848 code units (under the cap) but 65,540 bytes (over it).
    const value = JSON.stringify('€'.repeat(21_846));
    expect(value.length).toBeLessThan(CAP_BYTES);
    expect(() => record(value)).toThrow(/exceeds 65536 bytes/);
    expect(invokeWithTimeout).not.toHaveBeenCalled();
  });

  it('rejects unparseable JSON without calling the backend', () => {
    expect(() => record('{"facts": [1, 2')).toThrow(/keyFactsJson is not valid JSON/);
    expect(invokeWithTimeout).not.toHaveBeenCalled();
  });
});
