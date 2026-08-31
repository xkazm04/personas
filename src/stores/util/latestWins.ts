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
    /** Peek at the current generation WITHOUT minting. For observers that are
     *  not requests themselves but must go inert when the slot's owner
     *  re-fetches (e.g. a scoped merge racing a full family reload). */
    current(): number {
      return seq;
    },
  };
}

/**
 * Per-key latest-wins — one independent token slot per key, for writes scoped
 * finer than a whole store family (a per-project merge, a per-row refresh).
 * Same mint/compare contract as {@link createLatestWins}; the key is the slot.
 * Keys accumulate one number each and are never evicted — bounded by the
 * population of real entities (projects), not by request volume.
 */
export function createKeyedLatestWins<K = string>() {
  const seqs = new Map<K, number>();
  return {
    /** Mint a new token for `key`; call synchronously before firing the request. */
    next(key: K): number {
      const n = (seqs.get(key) ?? 0) + 1;
      seqs.set(key, n);
      return n;
    },
    /** True if `token` is still `key`'s most recently minted one. */
    isCurrent(key: K, token: number): boolean {
      return seqs.get(key) === token;
    },
  };
}
