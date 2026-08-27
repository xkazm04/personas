import { describe, it, expect } from 'vitest';
import { truncatePath, formatBytes } from '../documentTabHelpers';

describe('truncatePath', () => {
  it('returns short paths untouched', () => {
    expect(truncatePath('C:/a/b.txt', 50)).toBe('C:/a/b.txt');
  });

  it('never returns more characters than the budget', () => {
    for (const len of [51, 52, 53, 60, 120]) {
      const path = 'x'.repeat(len);
      expect(truncatePath(path, 50).length).toBeLessThanOrEqual(50);
    }
  });

  it('keeps the tail of the path and marks the cut', () => {
    const path = '/very/long/prefix/that/gets/cut/away/report-final.pdf';
    const out = truncatePath(path, 20);
    expect(out.startsWith('...')).toBe(true);
    expect(out.endsWith('report-final.pdf')).toBe(true);
    expect(out.length).toBe(20);
  });

  it('degrades to a bare tail when the budget cannot hold the ellipsis', () => {
    expect(truncatePath('abcdefgh', 3)).toBe('fgh');
  });
});

describe('formatBytes', () => {
  it('formats each magnitude', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
