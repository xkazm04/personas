# Home & Roadmap — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 0, Medium: 4, Low: 1)

## 1. Roadmap disk cache is never re-validated — TTL-fresh and 304 paths serve payloads the current build would reject
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/live_roadmap.rs:177-197 (fresh-cache path), :216-229 (304 path); `validate()` called only at :303
- **Scenario**: A payload is cached by an older app build whose `validate()` was laxer (e.g. before the empty-items / missing-en-title rules were added), or the cache file in `app_data_dir` is hand-edited/partially corrupted but still deserializable. User upgrades the app; the cache file survives the upgrade. On the TTL-fresh path the payload is served with no validation; once expired, the server answers 304 (ETag unchanged), which bumps `cached_at` and re-serves it as `source: Network` — indefinitely, hour after hour, as long as the server content doesn't change.
- **Root cause**: `validate()` runs only on a 200 body (`fetch_from_network` → `Fresh`). The design assumes "cache contents were validated when written", but the validation rules are per-build while the cache file is cross-build, and the 304 path re-blesses the cache without ever re-checking it.
- **Impact**: The strict-schema policy documented at the top of the file ("a strict check ensures a stale CDN never bricks rendering") is silently bypassed: clients can render `[roadmap.<id>]` placeholders or drift-y content that current validation exists to block, reported to the UI as a healthy `network` fetch. The frontend's zero-displayable fallback in `roadmapItems.buildDisplayItems` catches only the fully-blank case, not partial placeholder rot.
- **Fix sketch**: Run `validate()` in `read_cache` (or immediately after) and treat a failing cache as absent (delete it), forcing a full 200 refetch without the `If-None-Match` header.

## 2. Hand-inlined wire type declares `itemType` but the actual JSON key is `type` — tsc-green, undefined at runtime
- **Severity**: Medium
- **Category**: bug
- **File**: src/api/liveRoadmap.ts:25 (vs src-tauri/src/commands/live_roadmap.rs:90-91 and the generated src/lib/bindings/LiveRoadmapItem.ts:3)
- **Scenario**: Any developer consumes `LiveRoadmapItem.itemType` from the api wrapper (e.g. to render a feature/fix badge on live roadmap items, matching `RELEASE_TYPE_META[item.type]` already used for bundled releases in HomeReleases.tsx:114). TypeScript compiles cleanly; at runtime the field is always `undefined` because Rust's `#[serde(rename = "type")]` overrides the struct-level camelCase rename — the wire key is `type`, exactly as the ts-rs binding (`{ id, type, status, priority, sortOrder }`) says.
- **Root cause**: The file deliberately inlines the wire types "rather than imported from generated ts-rs bindings" for Variant-B flexibility, and the inline copy drifted from the serde output. The stated purpose of the wrapper ("Types the call") is the thing that's wrong.
- **Impact**: A latent trust-boundary typing lie: the only field currently unread is the one that's mistyped, so the first feature to use it ships an invisible `undefined` (missing badge, `RELEASE_TYPE_META[undefined]` crash) with zero compiler signal.
- **Fix sketch**: Rename the field to `type` (or re-export the generated `src/lib/bindings/LiveRoadmap*.ts` types from this module instead of duplicating them); optionally add a type-equality assertion against the bindings so future drift fails tsc.

## 3. FleetHealthStrip shimmers forever when the metrics fetch fails — loading and failure are indistinguishable
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/home/sub_welcome/FleetHealthStrip.tsx:106 (also :97-104)
- **Scenario**: On app start the user lands on Home → Welcome and `fetchFleetMetrics()` rejects (DB locked mid-migration, backend command error). `metrics` stays `null`, so the strip renders `FleetHealthStripSkeleton` — four pulsing placeholder pills — indefinitely. The 30s `usePausableInterval` retry only runs while the Welcome tab is active and visible, so a user who parks on another tab and comes back still sees a shimmer that has been "loading" for an hour.
- **Root cause**: `metrics === null` is treated as "first snapshot still loading"; the store's fetch failure is swallowed (fire-and-forget `void`) and there is no error/failed state, so failure is rendered with the loading affordance.
- **Impact**: Silent failure dressed as progress on the primary landing surface: the fleet-health signal (including the failure-spike alarm this strip exists to show) is simply absent, and the user is told "still loading" instead of "couldn't load".
- **Fix sketch**: Track fetch failure (e.g. `fleetMetricsError` in overviewStore or a local `settled && !metrics` flag) and after the first settled failure render a compact "metrics unavailable — retry" pill instead of the skeleton, reusing MetricPill styling with the click wired to a refetch.

## 4. Empty roadmap hides the live-status pill and refresh control — exactly when the user needs them
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/home/sub_releases/HomeReleases.tsx:161-175 (pill nested inside `{hero && …}`), :153
- **Scenario**: `buildDisplayItems` yields zero items — e.g. the bundled `releases.json` has no `status === 'roadmap'` release after a content edit, or the roadmap release ships with an empty items list while the live fetch is `unavailable`. `hero` is `undefined`, so the entire hero block — which is the only place `LiveRoadmapStatusPill` (status + "refresh" affordance) is rendered — disappears, and the lanes block is skipped too (`remaining.length > 0`). The page shows just the header and shipped releases with no explanation and no way to retry the live fetch.
- **Root cause**: The live-channel status/refresh affordance is structurally coupled to having a hero item to decorate, but its most important state (`unavailable`/`stale`) correlates with having little or no content to show.
- **Impact**: Missing empty state on the roadmap surface; the degraded-channel warning the api layer carefully distinguishes (`stale` vs `cache` in liveRoadmap.ts:55-67) becomes unreachable UI precisely in the failure scenario it was designed for, and the user has no recovery action.
- **Fix sketch**: Lift `LiveRoadmapStatusPill` out of the `{hero && …}` block so it always renders in the roadmap section, and add an explicit empty-state card ("Roadmap unavailable — retry") when `roadmapItems.length === 0`.

## 5. Credentials pill flashes a confident "0" while the vault store is still loading
- **Severity**: Low
- **Category**: ui
- **File**: src/features/home/sub_welcome/FleetHealthStrip.tsx:76,148-155 (via src/features/home/sub_welcome/lib/useVaultCredentials.ts:20-29)
- **Scenario**: User with 12 stored credentials opens the app to Home → Welcome. `fetchFleetMetrics` resolves quickly so the strip leaves its skeleton, but `useVaultCredentials` starts at `[]` (lazy `import()` of vaultStore + `fetchCredentials` IPC still in flight), so the Credentials pill renders "0" for the load window before jumping to 12.
- **Root cause**: The hook conflates "not yet loaded" with "genuinely zero" — it returns a bare `CredentialLite[]` with no loading signal, and the strip's own loading gate (`!metrics`) is keyed to a different, faster data source.
- **Impact**: The strip's carefully-argued no-data honesty (success-rate shows "—" instead of a fake 0%, per :131-134) is contradicted one pill over: a transient false "0 credentials" reads as "vault is empty" and can nudge users toward the credentials page to fix a non-problem.
- **Fix sketch**: Have `useVaultCredentials` return `{ creds, loaded }` (loaded after the store seed/fetch settles) and render "—" or a mini-shimmer in the pill value until `loaded`, mirroring the success-rate convention.
