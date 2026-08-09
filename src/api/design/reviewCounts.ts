import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

/**
 * The TRUE number of design-review rows — not the length of a page.
 *
 * `listDesignReviews()` returns at most `limit` rows and the backend defaults
 * that to 50, so `reviews.length` is a page size masquerading as a total. Any
 * surface that shows the user "N templates" must ask this instead; pulling the
 * whole table into the webview just to call `.length` on it would trade a
 * wrong number for a perf regression.
 *
 * `testRunId` mirrors `listDesignReviews` so the count always describes the
 * same population the list was drawn from.
 */
export const countDesignReviews = (testRunId?: string) =>
  invoke<number>('count_design_reviews', { testRunId: testRunId ?? null });
