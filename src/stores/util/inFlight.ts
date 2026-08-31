/**
 * In-flight request deduplication keyed by request identity
 * (registry technique `client-state/async-race-guards`, second guard).
 *
 * For SHAREABLE requests — concurrent callers who want the same answer (three
 * widgets mounting at once, StrictMode double-mount, an event handler
 * registered N times). A caller finding its key in flight JOINS the existing
 * promise instead of firing a duplicate; the entry is removed when the flight
 * settles — success AND failure alike (a registry that only clears on success
 * caches the failure forever, and every later caller joins a flight that
 * already lost).
 *
 * The key must include EVERY argument that changes the answer; an
 * under-specified key deterministically serves one question's answer to a
 * different question, which is worse than the duplicate request it saves.
 *
 * `mode: 'replace'` is for callers who KNOW the world changed since any
 * current flight departed (a refresh after a mutation, an event announcing
 * new rows): it starts a fresh flight and repoints the key, leaving the
 * superseded flight to finish into whatever latest-wins token guards the
 * write site. Join semantics would hand such a caller a stale answer.
 *
 * Bounded by construction — the map holds only unsettled work.
 */
export function createInFlightRegistry() {
  const flights = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>, mode: 'join' | 'replace' = 'join'): Promise<T> {
      if (mode === 'join') {
        const existing = flights.get(key);
        if (existing) return existing as Promise<T>;
      }
      const flight = fn().finally(() => {
        // Only the entry we own: a 'replace' may have repointed the key to a
        // newer flight, whose bookkeeping is its own to remove.
        if (flights.get(key) === flight) flights.delete(key);
      });
      flights.set(key, flight);
      return flight;
    },
    /** True while `key` has an unsettled flight. Tests + diagnostics. */
    inFlight(key: string): boolean {
      return flights.has(key);
    },
  };
}
