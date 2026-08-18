---
layer: application
subject: usage-analytics
technique: batching-and-quota
stack: react
---

# Batching and quota — per-session counters in the webview

How this repo implements session-summary batching, and where its flush path
falls short of the technique's shutdown and loss-accounting standards.

## The accumulator

`src/lib/analytics/index.ts` keeps the whole in-session state as one flat
count map:

```ts
// index.ts:31
const sessionCounts: Record<string, number> = {};
function bump(key: string): void {
  sessionCounts[key] = (sessionCounts[key] ?? 0) + 1;
}
```

Keys are drawn from closed vocabularies — bare section ids for sections,
`<dimKey>:<value>` for tabs (`src/lib/analytics/summary.ts:21`,
`tabCountKey`, dimension-prefixed so two dimensions sharing a value never
merge counts). Cardinality is therefore bounded by the catalog, not by user
behavior — the technique's "bounded by construction" rule. Increment is a
synchronous map write in the navigation subscriber; the network is never
touched per interaction. Per-visit `feature` events do also flow to the sink
per navigation (a breadcrumb-grade stream), but the quota-bearing artifact is
the single `session_summary`, which the module docstring states as the design
goal: one flush "to keep transport quota predictable".

## The flush

```ts
// index.ts:47
function flushSessionSummary(): void {
  if (Object.keys(sessionCounts).length === 0) return;
  getAnalyticsSink().session(buildSessionSummary(sessionCounts));
}
// index.ts:149
window.addEventListener('beforeunload', flushSessionSummary);
```

One summary per session, built by the pure `buildSessionSummary` diff and
handed to the pluggable sink. The unsubscribe returned by `initAnalytics`
removes the listener (`index.ts:154`) — creation naming its reaper.

## Where it deviates from the technique (measured)

- **One listener, and it is the fallback one.** The flush rides solely on
  `beforeunload`. The repo's own `src/lib/throttledStorage.ts:41-43` registers
  both `pagehide` and `beforeunload` with a comment naming `pagehide` as the
  recommended hook for this shell and `beforeunload` as the desktop fallback —
  but that module has zero call sites, so the app registers `pagehide`
  nowhere (legacy composition, docs/concepts/golden-paths/usage-analytics.md
  §7 D3). The technique's rule — the unload listener is the last chance, not
  the mechanism — is inverted here: the listener is the only drain.
- **No checkpoint, so abrupt death loses the session silently.** There is no
  periodic persistence of `sessionCounts` and no recovered-session flush on
  next launch. A crashed session's summary is indistinguishable from a
  session in which nothing was visited — and the summary is the only artifact
  carrying `sectionsIgnored`/`tabsIgnored`, so the loss lands on exactly the
  question the layer exists to answer.
- **No loss accounting.** Nothing counts sessions started versus summaries
  flushed, so the loss rate is unknown rather than declared. The technique's
  fix is a durable local pair of counters outside the telemetry path — it
  cannot be telemetry, because the detector would share the failure.
- **No maximum accumulation window.** A session alive for days accumulates
  without an intermediate flush; fine at today's session lengths, but the
  bound is absent rather than chosen.

None of these are call-site mistakes; the sink interface itself
(`src/lib/analytics/sink.ts:70`, `session(summary): void`) is fire-and-forget
and cannot express begin/observe/checkpoint — the legacy composition's §8
names this as the missing capability. The conforming shape would add periodic
checkpointing of the count map to local storage, a next-launch flush of any
orphaned checkpoint marked as recovered, and both shutdown hooks — with the
listener demoted back to an optimization.
