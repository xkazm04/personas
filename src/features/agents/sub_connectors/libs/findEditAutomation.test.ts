import { describe, it, expect } from 'vitest';
import { findEditAutomation } from './useAutomationSetup';

describe('findEditAutomation', () => {
  it('finds the target in the persona detail when the vault list is empty (fresh session)', () => {
    const a = { id: 'a1', name: 'x' };
    expect(findEditAutomation([a], [], 'a1')).toBe(a);
  });
  it('falls back to the vault list and returns null for no id / unknown id', () => {
    const v = { id: 'v1' };
    expect(findEditAutomation(undefined, [v], 'v1')).toBe(v);
    expect(findEditAutomation([], [], null)).toBeNull();
    expect(findEditAutomation([], [], 'nope')).toBeNull();
  });
});
