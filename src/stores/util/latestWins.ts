/**
 * "Latest-wins" stale-response guard. Several slices independently reimplement
 * the same shape: increment a module-scoped counter before firing a fetch,
 * compare the captured token against the live counter after the await
 * resolves, and drop the write if a newer fetch has since superseded it.
 * Without this, two concurrent fetches (StrictMode double-mount, rapid
 * filter/route changes, auto-refresh racing a manual refresh) can race and
 * whichever resolves LAST wins — even when its data is older.
 *
 * Centralizing the counter/compare pair here means the comparison direction
 * (and the "am I still current" question) only needs to be gotten right once.
 *
 * @example
 * ```ts
 * const latestWins = createLatestWins();
 * // ...
 * fetchThing: async () => {
 *   const token = latestWins.next();
 *   set({ loading: true });
 *   try {
 *     const data = await api.fetchThing();
 *     if (!latestWins.isCurrent(token)) return; // a newer fetch is already in-flight
 *     set({ data, loading: false });
 *   } catch (err) {
 *     if (!latestWins.isCurrent(token)) return;
 *     set({ loading: false });
 *   }
 * }
 * ```
 */
export function createLatestWins() {
  let seq = 0;
  return {
    /** Mint a new token for an in-flight request; call once right before firing it. */
    next(): number {
      return ++seq;
    },
    /** True if `token` is still the most recently minted one (no newer request has started). */
    isCurrent(token: number): boolean {
      return token === seq;
    },
  };
}
