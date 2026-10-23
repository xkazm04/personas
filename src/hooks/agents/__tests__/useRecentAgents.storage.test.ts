/**
 * `trackRecentAgent` runs inside `selectPersona` and `executePersona`. A throw
 * from it aborts a run start after its state was already set, so storage it
 * cannot read or write must never throw out of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'personas:recent-agents';

async function freshModule() {
  vi.resetModules();
  return import('../useRecentAgents');
}

describe('useRecentAgents storage boundary', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('does not throw when the stored value is JSON but not an array', async () => {
    localStorage.setItem(STORAGE_KEY, '{"a":1}');
    const { trackRecentAgent, removeRecentAgent } = await freshModule();

    expect(() => trackRecentAgent('p1')).not.toThrow();
    expect(() => removeRecentAgent('p1')).not.toThrow();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it('drops malformed entries and keeps the valid ones', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'ok', ts: 1 }, { id: 3 }, null, 'x']),
    );
    const { trackRecentAgent } = await freshModule();
    trackRecentAgent('p2');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Array<{ id: string }>;
    expect(stored.map((e) => e.id)).toEqual(['p2', 'ok']);
  });

  it('does not throw when storage refuses the write', async () => {
    const { trackRecentAgent } = await freshModule();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => trackRecentAgent('p3')).not.toThrow();
  });
});
