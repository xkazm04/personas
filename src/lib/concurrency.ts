// Shared bounded-concurrency fan-out helper.
//
// WHY THIS EXISTS: opening the Passport wall or the Mastermind canvas at 30+
// projects used to fire an unbounded `Promise.all` per project — one round of
// listSkills/probeRepoEvidence calls (usePassportData) and a second,
// independently-written copy of the exact same limiter for
// skills/evidence/sentry fan-out (sceneStore). Two copies of a concurrency
// primitive is itself a bug surface (a fix to one silently doesn't apply to
// the other) — this is the single canonical implementation. Every per-project
// (or otherwise fleet-scaled) fan-out in the app should route through this
// instead of inventing another `Promise.all(items.map(...))`.
//
// Bounds the in-flight count to `limit` workers pulling from a shared cursor;
// results preserve input order regardless of completion order. A rejection
// from any `fn` call propagates immediately via `Promise.all` (this is a
// worker-pool, not a settle-all — callers that must tolerate partial failure
// should catch inside `fn` per item, same as existing call sites already do).
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  // `Number.isFinite` guard added 2026-08-16. A `NaN` limit made
  // `Math.max(1, Math.min(NaN, n))` produce `NaN`, and
  // `Array.from({ length: NaN })` is EMPTY — so this resolved successfully
  // having called `fn` zero times. A silent, successful no-op is the worst
  // available failure for a fan-out: the caller gets a resolved promise and an
  // array of holes, and nothing anywhere reports that the work did not happen.
  //
  // Latent in this repo today; the same silent-zero-lane failure is live in
  // three sibling repos through a different door. Fixed at the primitive rather
  // than at the call sites, per "prefer fixing the default over counting the
  // callers" — this covers every present and future caller.
  const width = Number.isFinite(limit) ? Math.max(1, Math.min(limit, items.length)) : 1;
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    }),
  );
  return results;
}
