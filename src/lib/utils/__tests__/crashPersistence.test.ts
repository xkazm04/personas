import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  persistCrash,
  readCrashLogs,
  CRASH_STORAGE_KEY,
} from '../crashPersistence';

vi.mock('@/api/system/system', () => ({
  reportFrontendCrash: vi.fn(() => Promise.resolve()),
}));

describe('crash persistence survives its own storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Regression guard: a corrupted blob used to throw out of the JSON.parse and
  // into the outer catch, so the crash was dropped AND the bad value was never
  // rewritten -- disabling local crash persistence permanently. Pins the fixed
  // behaviour (the bad value is replaced) and forbids the old (nothing written).
  it('replaces a corrupted blob instead of being disabled by it', () => {
    localStorage.setItem(CRASH_STORAGE_KEY, '{not json at all');

    persistCrash('BoundaryA', new Error('boom'));

    const stored: unknown = JSON.parse(localStorage.getItem(CRASH_STORAGE_KEY) ?? 'null');
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);
    expect((stored as Array<{ component: string }>)[0]!.component).toBe('BoundaryA');
  });

  it('discards a non-array stored value rather than unshifting onto it', () => {
    localStorage.setItem(CRASH_STORAGE_KEY, '{"not":"an array"}');

    persistCrash('BoundaryB', new Error('boom'));

    const stored = JSON.parse(localStorage.getItem(CRASH_STORAGE_KEY) ?? 'null') as unknown;
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);
  });

  it('keeps persisting after a corrupted read', () => {
    localStorage.setItem(CRASH_STORAGE_KEY, 'garbage');
    persistCrash('First', new Error('a'));
    persistCrash('Second', new Error('b'));

    const stored = JSON.parse(localStorage.getItem(CRASH_STORAGE_KEY) ?? '[]') as Array<{
      component: string;
    }>;
    expect(stored.map((e) => e.component)).toEqual(['Second', 'First']);
  });

  // Regression guard: readCrashLogs' recovery path called removeItem
  // unguarded, so when localStorage was unavailable outright BOTH the read and
  // the wipe threw and the error escaped a function contracted to return a list.
  it('returns an empty list when localStorage is unavailable entirely', () => {
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

    expect(() => readCrashLogs()).not.toThrow();
    expect(readCrashLogs()).toEqual([]);
  });
});
