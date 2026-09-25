/**
 * A failed portfolio read must be visually distinct from an empty scope.
 *
 * useDirector reads with Promise.allSettled, writes only fulfilled values and
 * flips `ready` in a `finally` - so a rejected read landed on exactly the
 * state a fresh install lands on (ready, no portfolio, inScope 0), and the tab
 * painted the coaching empty glyph plus an "Add to scope" CTA over a dead
 * backend.
 */
import { describe, it, expect } from 'vitest';
import { resolveDirectorSurface, type DirectorReadState } from '../directorSurface';

const state = (over: Partial<DirectorReadState> = {}): DirectorReadState => ({
  ready: true,
  portfolioError: false,
  hasPortfolio: false,
  inScope: 0,
  ...over,
});

describe('resolveDirectorSurface', () => {
  it('waits while the first read is in flight', () => {
    expect(resolveDirectorSurface(state({ ready: false, portfolioError: true }))).toBe('loading');
  });

  it('a rejected portfolio read is an error, never the empty hero', () => {
    expect(resolveDirectorSurface(state({ portfolioError: true }))).toBe('portfolio-error');
  });

  it('a fulfilled read with nobody in scope is the real first run', () => {
    expect(resolveDirectorSurface(state({ hasPortfolio: true, inScope: 0 }))).toBe('empty-scope');
  });

  it('renders the scorecard once there is a roster', () => {
    expect(resolveDirectorSurface(state({ hasPortfolio: true, inScope: 4 }))).toBe('scorecard');
  });

  it('keeps a stale portfolio on screen when a later read fails', () => {
    // A refresh that fails should not throw away a roster already in hand -
    // the banner in the tab reports the failed read while the data stands.
    expect(resolveDirectorSurface(state({ portfolioError: true, hasPortfolio: true, inScope: 4 })))
      .toBe('scorecard');
  });

  it('the failure and the empty state are never the same verdict', () => {
    const failed = resolveDirectorSurface(state({ portfolioError: true }));
    const empty = resolveDirectorSurface(state({ hasPortfolio: true, inScope: 0 }));
    expect(failed).not.toBe(empty);
  });
});
