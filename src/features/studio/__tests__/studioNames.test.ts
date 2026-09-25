import { describe, expect, it, vi } from 'vitest';

// The name check itself is the backend's (webbuild_check_name, tested in Rust
// against the scaffold's own rule); this pins how the form reads its verdict.
const webbuildCheckName = vi.fn();
vi.mock('@/api/webbuild', () => ({ webbuildCheckName: (n: string) => webbuildCheckName(n) }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => vi.fn() }));

const { freeName, problemOf } = await import('../studioNames');

describe('reading the name verdict', () => {
  it('maps the backend verdict to a form problem', () => {
    expect(problemOf(null)).toBeNull();
    expect(problemOf({ slug: null, taken: false, suggestion: null })).toBe('unsafe');
    expect(problemOf({ slug: 'portfolio', taken: true, suggestion: 'portfolio-2' })).toBe('taken');
    expect(problemOf({ slug: 'bakery', taken: false, suggestion: null })).toBeNull();
  });

  it('gives a starter the backend suggestion when its name is taken', async () => {
    webbuildCheckName.mockResolvedValueOnce({ slug: 'portfolio', taken: true, suggestion: 'portfolio-3' });
    expect(await freeName('portfolio')).toBe('portfolio-3');
    webbuildCheckName.mockResolvedValueOnce({ slug: 'blog', taken: false, suggestion: null });
    expect(await freeName('blog')).toBe('blog');
    webbuildCheckName.mockRejectedValueOnce(new Error('ipc'));
    expect(await freeName('blog')).toBe('blog');
  });
});
