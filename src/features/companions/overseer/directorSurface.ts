/**
 * Which Director surface the current read state earns.
 *
 * `useDirector` fetches with `Promise.allSettled` and only writes fulfilled
 * values, then flips `ready` in a `finally` - so a rejected portfolio read
 * used to arrive at exactly the state a brand-new install arrives at: ready,
 * portfolio null, inScope 0. The tab branched that into the coaching empty
 * glyph and an "Add to scope" CTA, so a down backend looked like an empty
 * roster and the operator starred agents into a hole instead of retrying.
 *
 * A failed read is not a first run. The two must be distinguishable before
 * anything renders, which is what this classifier exists to make gateable.
 */
export type DirectorSurface =
  /** The first read has not settled yet. */
  | 'loading'
  /** The portfolio read REJECTED - show the error and a retry, never the hero. */
  | 'portfolio-error'
  /** The portfolio read SUCCEEDED and nobody is in scope - the real first run. */
  | 'empty-scope'
  /** There is a portfolio with agents in it. */
  | 'scorecard';

export interface DirectorReadState {
  ready: boolean;
  /** True when the most recent getDirectorPortfolio call rejected. */
  portfolioError: boolean;
  /** Whether a portfolio object is in hand (from this read or a prior one). */
  hasPortfolio: boolean;
  inScope: number;
}

export function resolveDirectorSurface(state: DirectorReadState): DirectorSurface {
  if (!state.ready) return 'loading';
  // The error outranks emptiness: with no portfolio in hand there is no
  // evidence of an empty roster, only evidence that the read failed.
  if (state.portfolioError && !state.hasPortfolio) return 'portfolio-error';
  if (!state.hasPortfolio || state.inScope === 0) return 'empty-scope';
  return 'scorecard';
}
