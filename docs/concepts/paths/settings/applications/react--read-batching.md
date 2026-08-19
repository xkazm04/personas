---
layer: application
subject: settings
technique: read-batching
stack: react
---

# Read batching — the microtask coalescer over Tauri IPC

How this repo instantiates [read-batching](../techniques/read-batching.md):
the boot fan-out crossing is a Tauri `invoke` (~1–5 ms of serialization even
for cache-hot SQLite, per the comment in `src/api/system/settings.ts`), and a
settings panel mounts many `useAppSetting` hooks at once — historically a
waterfall of serial single-key IPC calls fired from the same render.

## The coalescing variant, verbatim

This repo chose the technique's *coalesce instead of caching* variant. In
`src/hooks/utility/data/useSettings.ts`, every single-key read requested in
the same microtask is collected into a module-scoped pending map and flushed
as one bulk invoke:

```ts
let pendingByKey = new Map<string, PendingRead[]>();
let scheduled = false;

export function getAppSettingCoalesced(key: string): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const arr = pendingByKey.get(key);
    if (arr) arr.push({ resolve, reject });
    else pendingByKey.set(key, [{ resolve, reject }]);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flushBatch);
    }
  });
}
```

`flushBatch` swaps the map, issues a single `getAppSettingsBulk(keys)`, and
resolves every waiter from the shared result. The header comment states the
scaling contract exactly as the technique frames it: IPC cost scales with
"the *number of distinct ticks* rather than the number of subscribed keys".
Note the failure fan-out — a rejected bulk call rejects *every* pending
caller ("so none silently hangs"), the coalescer's version of
failure-not-empty-success.

Callers never see the machinery: `useAppSetting` (in
`src/hooks/utility/data/useAppSetting.ts`) calls `getAppSettingCoalesced`
exactly where it previously called the single-key API — the batched path is
the easy path, which is what makes the fix structural rather than a review
comment.

## The bulk endpoint underneath

`get_app_settings_bulk` is one SQL round trip
(`SELECT key, value FROM app_settings WHERE key IN (...)`, capped at 256
keys server-side by `GET_BATCH_MAX_KEYS` in
`src-tauri/db/src/repos/core/settings.rs`). The Rust side dedupes repeated
keys, returns `None` for absent *and* unknown keys (matching the single-key
reader's contract for typo'd references, with a `tracing::warn!`
breadcrumb), so every requested key gets an entry and the caller can
distinguish absent from empty.

## Invalidation: key-only broadcast, no long-lived cache

There is no persistent frontend cache to invalidate — the coalescer's trade,
as the technique describes. Cross-panel freshness comes from the
`settings-changed` Tauri event (`SETTINGS_CHANGED_EVENT` in
`src-tauri/src/commands/infrastructure/settings.rs`): the backend broadcasts
**the key only, never the value** whenever a row is written or deleted
through the command layer, and `useSettings` subscribers re-read through the
normal door. The payload comment in the emitter documents the deliberate
value omission — the exact "no second delivery path for settings data" rule.

Where a *surface* needs warm-remount behavior, the repo uses a scoped
module cache instead (e.g. `historyCache` in
`src/features/settings/sub_history/components/SettingsHistoryTab.tsx`),
keyed by filter, refreshed by a fresh fetch that silently replaces it —
cache-per-surface rather than cache-in-the-accessor.

## What to check before transplanting

- The coalescer batches only *same-tick* reads. Reads spread across ticks
  (staggered mounts under lazy loading) still fan out; if that shows up in
  a boot profile, the next step is the technique's bulk-load-into-cache
  shape, not a wider coalescing window.
- The `settings-changed` event covers writes through the command layer;
  writes landing through other doors (backend-internal `set` callers) do
  not broadcast. Mounted readers converge on next mount — an accepted,
  stated staleness bound, but one to re-state consciously when porting.
