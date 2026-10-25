// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { unitFor } from '../ui/format';

describe('unitFor', () => {
  it('makes a counted unit singular for exactly one, and only then', () => {
    expect(unitFor('states', 1)).toBe('state');
    expect(unitFor('states', -1)).toBe('state');
    expect(unitFor('states', 2)).toBe('states');
    expect(unitFor('states', 0)).toBe('states');
    expect(unitFor('states', undefined)).toBe('states');
    expect(unitFor('entries', 1)).toBe('entry');
    expect(unitFor('matches', 1)).toBe('match');
    expect(unitFor('classes', 1)).toBe('class');
  });

  it('leaves symbols, short units and words that are not plural as they are', () => {
    for (const u of ['ms', 'px', '%', '/s', 'callbacks/s', 'KB', 'fps', 'status', 'pass', 'analysis', 'Score', '']) expect(unitFor(u, 1)).toBe(u);
  });
});
