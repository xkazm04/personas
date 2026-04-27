# Ambiguity Audit — Deployment, Sharing & Plugins

> Total: 12 findings (2 critical, 5 high, 4 medium, 1 low)
> Files read: ~22
> Scope: Deployment dashboard + cloud panels, peer-to-peer sharing UI (bundles/enclaves/identity), plugin browse page/theme, composition DAG utilities.

## 1. Bundle clipboard auto-clear silently fails on read errors

- **Severity**: critical
- **Category**: edge-case
- **File**: src/features/sharing/components/BundleExportDialog.tsx:23-34
- **Scenario**: After copying a bundle blob or share-link to the clipboard, a 30s timer reads the clipboard back and overwrites it with `''` only if the contents still match. The catch block is empty (`// intentional: cannot verify, skip wipe`). On Tauri/Windows the read can fail intermittently for permission/focus reasons — when it does, the secret credential remains in the clipboard indefinitely.
- **Root cause**: The "TTL" guarantee is presented as a security primitive (comment calls bundle bytes and share-link tokens "credentials") but failure mode silently keeps the credential rather than escalating. There's no retry, no toast, no fallback, no logging.
- **Impact**: A user sees the toast "Bundle copied" assuming a 30s self-destruct, but a single failed read leaves a sealed bundle (signed, importable elsewhere) on the OS clipboard until they manually copy something else. Users will leak bundles through clipboard sync apps (1Password, Windows Cloud Clipboard).
- **Fix sketch**:
  - Retry the read once after 100ms before giving up.
  - On final failure, log a warning and surface a toast: "Could not auto-clear clipboard — please copy something else to evict the bundle."
  - Document the security guarantee explicitly (best-effort, not guaranteed).

## 2. Single-shared `dangerConfirmed` checkbox covers two distinct danger paths

- **Severity**: critical
- **Category**: implicit-assumption
- **File**: src/features/sharing/components/BundlePreviewContent.tsx:74-119, src/features/sharing/components/BundleImportDialog.tsx:378-388
- **Scenario**: Two separate warning blocks render — "trusted peer with bad signature (tampering)" and "unknown signer (cannot verify)". Each shows its own checkbox bound to the *same* `dangerConfirmed` state. The footer only checks `dangerConfirmed` to enable "Import Anyway" — there's no record of *which* warning the user acknowledged.
- **Root cause**: Reusing one boolean for two semantically different acknowledgements means a user who reads one warning, ticks its box, then sees the other appear (e.g. trust state changes between preview fetch and render — possible because `signer_trusted` is server-derived) is treated as having confirmed the second.
- **Impact**: A user who consents to "I know this trusted peer's signature is broken" cannot meaningfully consent separately to "I know I cannot verify this signer at all". Telemetry/audit logs (if added) cannot tell which danger was accepted, and a UI state race between preview re-fetches could carry stale consent across warning types.
- **Fix sketch**:
  - Use two separate state flags `tamperConfirmed` and `unknownSignerConfirmed`, OR
  - Tag the consent with the warning kind (`'tamper' | 'unknown' | null`) and reset on warning-type change.
  - Reset `dangerConfirmed` when `preview` is replaced.

## 3. Cloud reconnect generation increments on every effect tick, killing the running loop

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/deployment/hooks/useCloudHealthMonitor.ts:128-148
- **Scenario**: The effect bumps `generationRef.current++` in its cleanup, and `++generationRef.current` in its body. Dependencies are `[isConnected, reconnectState.isReconnecting]`. Whenever `reconnectState.isReconnecting` flips (which happens *inside* `startReconnectLoop`/`attemptReconnect` via `useSystemStore.setState`), the effect re-runs, the cleanup bumps the generation, and any in-flight `attemptReconnect` becomes `isStale(gen)` → returns. The reconnect loop dies mid-flight.
- **Root cause**: The generation token treats every reconnect-state change as if the component unmounted, but the hook itself triggers reconnect-state transitions. The hook's own state changes invalidate its own work.
- **Impact**: After the first failed health-check the reconnect state flips to `isReconnecting=true`, the effect re-runs, generation increments, the freshly-scheduled `attemptReconnect` callback fires later but bails as stale. The hook stops trying to reconnect after the first attempt unless `isConnected` itself changes — defeating the entire backoff schedule documented at line 9-18.
- **Fix sketch**:
  - Drop `reconnectState.isReconnecting` from the dep array; gate inside the effect body on store state read at run time.
  - Or split: one effect for "start polling on connect", another single-shot effect that watches `isConnected` only.
  - Add an integration test that simulates "connected → drop → drop → reconnect" and asserts attempts >= 2.

## 4. Pre-existing `dangerConfirmed` not reset between preview opens

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/sharing/components/BundleImportDialog.tsx:61-75, 79-95
- **Scenario**: `reset()` correctly clears `dangerConfirmed` to `false`. But once the user has confirmed a danger and the import succeeds, navigating back via "Choose File" without closing the dialog (currently no UI path, but `phase` can transition from `'done'`/`'preview'`) preserves consent. More relevantly, if a preview RPC returns a *different* bundle (token race line 58-59 prevents stale display, but if the second preview also has a danger warning), consent from preview #1 carries to preview #2.
- **Root cause**: Consent is bound to the dialog instance, not to the previewed bundle's hash. Conceptually consent should expire when the bundle identity changes.
- **Impact**: A confused user could approve a bundle from peer A, refresh to a bundle from peer B, and the "Import Anyway" button is already armed. Combined with finding 2, this is a real footgun for unsigned bundle execution.
- **Fix sketch**:
  - Reset `dangerConfirmed` whenever `preview?.bundle_hash` changes.
  - Bind consent to bundle hash explicitly: `confirmedHash === preview.bundle_hash`.

## 5. Deployment health stats cache never bounded or invalidated

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/deployment/hooks/useDeploymentHealth.ts:36, 60-84
- **Scenario**: `statsCache.current` starts as `{}` and is fully replaced on every fetch (`statsCache.current = newStats`). However, the `needsFetch` gate (line 39) only triggers when the *set* of unique persona IDs changes. If a deployment is paused, then re-enabled, then activity changes — but the persona id set is identical — health data is stale forever (until app reload). 7-day window means stale 6-day-old data is shown indefinitely.
- **Root cause**: The dependency `stableKey` is the *identity set* of personas, but stats themselves are time-varying. There's no TTL or refresh trigger.
- **Impact**: Sparklines on the deployment dashboard go silently stale. Operators look at success-rate trends that haven't updated since the page first rendered. No indicator distinguishes "fresh" from "cached for 30 minutes".
- **Fix sketch**:
  - Add a TTL (e.g., 60s) and re-fetch on expiry.
  - Or invalidate `statsCache` when `cloudFetchDeployments` runs.
  - Surface "last updated N min ago" tooltip on the sparkline column.

## 6. Workflow validation reports cycle nodes but doesn't classify them

- **Severity**: high
- **Category**: requirements-unclear
- **File**: src/features/composition/libs/dagUtils.ts:60-67, 110-117
- **Scenario**: When Kahn's algorithm halts with residual in-degree, comment says nodes "are part of, or downstream of, the cycle. Surface them so the editor can highlight them." Callers receive a flat list and have no way to distinguish "I'm in the cycle" from "I'm downstream of the cycle". The code that highlights cycle nodes will mark every downstream node as cyclic — including legitimately reachable terminal nodes.
- **Root cause**: The algorithm's natural output (residual in-degree > 0) conflates two graph-theoretic concepts. The comment acknowledges this but defers the distinction to "the editor".
- **Impact**: UI cannot give the user accurate "this edge is the problem" feedback. As composition graphs grow (several persona nodes, many edges) every cycle drags half the graph into a red highlight, making the actual problem invisible. Cycle-fix workflows will be frustrating.
- **Fix sketch**:
  - Run Tarjan's SCC on the residual sub-graph to identify true cycle members.
  - Return `{ cycleNodes: string[]; downstreamNodes: string[] }`.
  - Or document the limitation explicitly so editor authors don't expect surgical highlighting.

## 7. Cycle detection runs duplicate topo sort during validation

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/composition/libs/dagUtils.ts:111
- **Scenario**: `validateWorkflow` constructs nodeIds, iterates nodes/edges, then calls `topologicalSort(nodes, edges)` which constructs nodeIds, in-degree, adjacency *again*. For large workflows this is two full graph passes.
- **Root cause**: Modular factoring favored over performance. Acceptable for current scale (interactive editing of small DAGs) but undocumented constraint.
- **Impact**: If composition is reused for batch/scheduled validation of stored workflows (a likely future direction given the deploy/share scope), redundant work compounds.
- **Fix sketch**:
  - Factor a single internal function that returns `{ adjacency, inDegree, order, cycleNodes }` and have both callers consume it.
  - Or note the perf trade-off in a comment and the expected scale (e.g., < 100 nodes).

## 8. `topologicalSort` accepts duplicate edges silently

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/composition/libs/dagUtils.ts:34-38
- **Scenario**: If `edges` contains two edges `A → B`, in-degree of B is incremented twice. `validateWorkflow` does *not* flag duplicates. Topo order is preserved, but the implicit invariant "each edge counted once" is broken in graph theory and downstream consumers (e.g., a runtime that treats edges as data flow channels) may double-fire.
- **Root cause**: Edge deduplication is delegated to upstream code (the editor) but never asserted.
- **Impact**: A glitchy UI that re-emits the same edge ID, or an imported workflow JSON, can produce a graph that *looks* valid but executes incorrectly. There's no signal in validateWorkflow output.
- **Fix sketch**:
  - In `validateWorkflow`, detect duplicates by `(source, target)` pair and emit a `ValidationError`.
  - Or document that callers must ensure edges are unique before calling.

## 9. Plugin theme accent registry hard-codes plugin IDs — invariant with `PluginTab` type drifts silently

- **Severity**: medium
- **Category**: trade-off-hidden
- **File**: src/features/plugins/pluginTheme.ts:13-44
- **Scenario**: `PLUGIN_ACCENTS` is a `Record<Exclude<PluginTab, 'browse'>, PluginAccent>`. If a new plugin id is added to `PluginTab` but the developer forgets to add an accent, TypeScript catches it. But the early return for `'browse'` (line 47) and the `accent` lookup mean a value of `id === 'browse'` returns `{}` — `--plugin-gradient-from` is undefined, and the gradient div renders with literal CSS string `var(--plugin-gradient-from)` which falls back to nothing. The top-border line silently disappears.
- **Root cause**: The "browse" carve-out is implicit. The function shape says "every PluginTab has a theme" but in fact one is silently skipped.
- **Impact**: PluginAccentLayer rendered with `pluginId='browse'` shows a transparent stripe with no documentation that this is intended. Easy to mistake for a CSS bug.
- **Fix sketch**:
  - Either remove `'browse'` from valid `pluginId` props on `PluginAccentLayer` (add a type guard at the boundary), or
  - Add a sentinel "neutral" accent for browse so the styling is intentional.
  - Comment why browse is the exception.

## 10. PluginBrowsePage hard-codes "Research Lab" and "Twin" labels/descriptions instead of using i18n

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/plugins/PluginBrowsePage.tsx:25, 27
- **Scenario**: All other plugin entries use `t.plugins.X_label` / `t.plugins.X_desc`. Two entries (`research-lab`, `twin`) have inline literal English strings.
- **Root cause**: Either translation keys haven't been added yet, or these were added in a hurry. There's no comment explaining why two plugins are exempt from i18n.
- **Impact**: Locale switch leaves these two plugin descriptions in English while everything around them is translated. Not a correctness bug but a real UX inconsistency, and a future contributor adding a third plugin won't know which pattern to follow.
- **Fix sketch**:
  - Add `research_lab_label/desc` and `twin_label/desc` keys to the i18n bundle.
  - Or add a `// TODO(i18n): pending translation keys` comment to make the intent explicit.

## 11. PeerCard `last_seen_at` parses with `new Date(...)` without verifying input format

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/sharing/components/PeerCard.tsx:44-54
- **Scenario**: `peer.last_seen_at` is fed to `new Date()`. Type is implicit (string ISO? unix epoch?). `try/catch` catches throwing parses but `new Date('invalid')` returns `Invalid Date` (no throw); `getTime()` returns `NaN`; `Date.now() - NaN` is `NaN`; `NaN < 60_000` is false; falls through to "h ago" format; `Math.floor(NaN/3_600_000)` is `NaN` → `"NaN ago"` rendered.
- **Root cause**: Defensive try/catch was added but the actual failure mode (`Invalid Date` returning NaN, not throwing) wasn't considered.
- **Impact**: If the backend ever sends an unexpected string (legacy peer record, schema drift), the UI shows literal "NaNh ago" rather than the empty fallback. Peer entries become confusing.
- **Fix sketch**:
  - `if (Number.isNaN(d.getTime())) return '';` before computing the diff.
  - Same pattern exists in PeerDetailDrawer at line 220 (`new Date(peer.last_seen_at).toLocaleString()`) — would render literal "Invalid Date".

## 12. `useDeploymentTest` `runTest` has stale `tests` capture in its dep array

- **Severity**: low
- **Category**: edge-case
- **File**: src/features/deployment/hooks/useDeploymentTest.ts:42-44, 102
- **Scenario**: `runTest` has `[tests]` in its dependency array (line 102) so it captures fresh state to early-return when `tests[deploymentId]?.running`. However, a new function reference is produced on every state change, and any `useEffect` or memoized callback depending on `runTest` re-runs every time *any* test state changes — including unrelated rows.
- **Root cause**: Reading state for an early-out check inside `useCallback` is the classic stale-closure trap. Using `setTests` functional updater would be cleaner.
- **Impact**: Minor render churn in the deployment table when many tests run simultaneously; no correctness bug today. Becomes a problem if `runTest` is added to a `useMemo` boundary later.
- **Fix sketch**:
  - Replace the early-return read with a functional-updater check: `setTests(prev => prev[deploymentId]?.running ? prev : { ...prev, [deploymentId]: { running: true, result: null } })` and bail on the same-reference returned value.
  - Drop `tests` from deps.
