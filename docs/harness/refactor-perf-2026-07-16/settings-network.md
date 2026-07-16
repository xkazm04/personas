# settings/network — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: App Shell, Settings & Sharing | Files read: 16 | Missing: 0

## 1. Tauri event listener leaks on fast unmount in PeerDetailDrawer
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/settings/sub_network/components/PeerDetailDrawer.tsx:49-62
- **Scenario**: The effect calls `listen(...)` (async) and stores the unlisten fn in a closure variable via `.then()`. If the drawer unmounts (or `peer.peer_id` changes, re-running the effect) before the promise resolves, cleanup runs with `unlisten === null` and the subscription is never removed. Repeatedly opening/closing peer drawers accumulates live listeners.
- **Root cause**: Classic `listen().then(fn => unlisten = fn)` race — the cleanup function captures a variable that may not be assigned yet, and there is no "cancelled" flag to unlisten late-resolving registrations.
- **Impact**: Each leaked listener stays subscribed to `P2P_MANIFEST_SYNC_PROGRESS` for the app's lifetime and fires `fetchPeerManifest` (a backend invoke) on every sync event for that peer — unbounded growth of both listeners and redundant IPC calls in a long-running desktop session.
- **Fix sketch**: Add a `let cancelled = false` flag; in `.then((fn) => { if (cancelled) { fn(); } else { unlisten = fn; } })` and set `cancelled = true` in the cleanup before calling `unlisten?.()`. Same pattern should be the house standard for all `@tauri-apps/api/event` subscriptions.

## 2. ProvenanceBadge.tsx is dead code — never imported anywhere
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/settings/sub_network/components/ProvenanceBadge.tsx:8
- **Scenario**: A repo-wide grep for `ProvenanceBadge` finds only its own definition plus an unrelated, same-named local component in `src/features/overview/ExecutionDetailModal/OutputSections.tsx`. No file imports the sub_network version.
- **Root cause**: The badge (showing import provenance of a shared resource) was presumably meant for `ResourceExposureCard`/manifest rows but was never wired in; the `ResourceProvenance` type import suggests an abandoned feature slice.
- **Impact**: Dead file adds noise, misleads readers into thinking provenance is surfaced in the UI, and collides in name with the overview component. Cheap deletion, or a cheap feature win if wired.
- **Fix sketch**: Either delete `ProvenanceBadge.tsx`, or wire it into `ResourceExposureCard`/`ManifestEntryRow` if `ExposedResource` actually carries provenance data (product call). Verification done: no dynamic usage found in src/; only cross-check would be tests/stories, which don't exist for this folder.

## 3. formatBytes and peer-id truncation duplicated across the context
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/settings/sub_network/components/BundleExportDialog.tsx:515
- **Scenario**: `formatBytes` is implemented twice with different behavior (BundleExportDialog.tsx:515 caps at MB; NetworkDashboard.tsx:54 handles GB and 0-byte case), so the same byte count renders differently in export toasts vs. metrics panels. Separately, the `id.slice(0, 8)...id.slice(-8)` peer-id truncation is hand-rolled in 5 places (IdentitySettings:90, PeerCard:40, PeerDetailDrawer:124, NetworkDashboard:365, BundlePreviewContent:58 — plus a 12-char variant in EnclaveVerificationView:68).
- **Root cause**: No shared `lib` module for this feature's formatting helpers; each component re-derived them locally.
- **Impact**: Behavioral drift already exists (MB-cap vs GB support), and any change to truncation style requires touching 6 files. Also PeerCard:44-54 hand-rolls relative time despite `formatRelativeTime` (used in PeerDetailDrawer:11) and the `RelativeTime` component existing.
- **Fix sketch**: Create `sub_network/lib/format.ts` with `formatBytes` (keep the NetworkDashboard version — it's a superset) and `truncatePeerId(id, chars = 8)`; replace all call sites. Swap PeerCard's inline `lastSeen` computation for the existing `RelativeTime`/`formatRelativeTime`.

## 4. PeerCard is memo()-wrapped but its callback props are recreated every render
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/settings/sub_network/components/PeerList.tsx:47-74
- **Scenario**: `handleConnect` and `handleDisconnect` are plain inline functions in `PeerList`, so every PeerList render (each `connectingPeers` Set update, each snapshot refresh) produces new references, causing every memo'd `PeerCard` to re-render anyway.
- **Root cause**: `memo` on PeerCard (PeerCard.tsx:25) without stabilizing the callbacks it depends on — the memo is currently a no-op.
- **Impact**: Bounded (LAN peer lists are small), but the memo is pure dead weight and misleads future readers into thinking the list is render-optimized; with many peers plus the 30s poll it becomes measurable.
- **Fix sketch**: Wrap `handleConnect`/`handleDisconnect` in `useCallback` (they only depend on stable store actions and `addToast`); `setSelectedPeerId` is already stable. Alternatively drop the `memo` if list sizes will stay tiny.

## 5. IdentitySettings ships redundant dual export and PeerList carries a stale polling comment
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/settings/sub_network/components/IdentitySettings.tsx:11-12
- **Scenario**: `export { IdentitySettings };` immediately precedes `export default function IdentitySettings()`. Only the named export is used (ExposureManager.tsx:11); the default export has no importer. Additionally, PeerList.tsx:41 says "NetworkDashboard drives the shared 5s snapshot poll" while NetworkDashboard.tsx:251 actually polls at 30s.
- **Root cause**: Leftover from a default→named export migration; the comment predates the poll-interval change to 30s.
- **Impact**: Confusing double export invites inconsistent import styles; the wrong interval in the comment misleads anyone reasoning about data freshness on this screen.
- **Fix sketch**: Drop the `default` keyword and the pre-hoisted re-export line, keeping a single `export function IdentitySettings()`. Update the PeerList comment to say 30s (or reference the constant).
