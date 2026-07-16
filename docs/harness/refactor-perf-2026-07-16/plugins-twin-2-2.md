# plugins/twin [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Plugins & Companion | Files read: 18 | Missing: 0

## 1. shared/TwinStat.tsx is entirely dead — zero importers in src
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/twin/shared/TwinStat.tsx:36
- **Scenario**: `TwinStat`, `TwinStatDivider`, and `TwinTile` (plus the `TwinAccentSwatch` type and both tone maps) have no importers anywhere under `src/` — verified by full-src grep for the component names and for `from '.../shared/TwinStat'`; the only hit is the file itself. Tauri frontend, no dynamic component resolution in play.
- **Root cause**: The "redesigned Twin pages" KPI strips these primitives were built for were superseded (header bands now render `TwinReadinessRibbon` / bespoke markup), and the primitives file was never removed.
- **Impact**: 65 lines of unused UI code that reads as the canonical KPI primitive set; the next KPI strip author may build on or diverge from a component nothing renders. Small bundle cost only if a barrel ever re-exports it.
- **Fix sketch**: Delete `src/features/plugins/twin/shared/TwinStat.tsx`. One caveat: it lives in this same context, so no cross-context callers exist to check — a repo-wide grep for `TwinStat`/`TwinTile` before deleting (already done here) is the whole verification.

## 2. Five sub-pages are one-line pass-through wrappers left over from the variant system
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/plugins/twin/sub_brain/BrainPage.tsx:3
- **Scenario**: `BrainPage`, `ChannelsPage`, `IdentityPage`, `KnowledgePage`, `ProfilesPage`, and `TrainingPage` are all `export default function X() { return <XAtelier />; }` — only `TonePage` still does real work (variant switching via `TwinVariantTabs`). TwinPage's `lazy()` imports route through these shims.
- **Root cause**: Each sub-tab once selected between atelier/console/baseline variants; all except Tone were collapsed to the atelier, leaving the Page indirection behind.
- **Impact**: Six extra modules in the lazy-load graph and a misleading structure that implies every subtab has a variant layer. Pure navigation overhead when reading the feature.
- **Fix sketch**: Point TwinPage's `lazy(() => import(...))` calls directly at the six `*Atelier` files and delete the five trivial `*Page.tsx` shims (keep `TonePage.tsx`, which is real). Alternatively keep the shims as deliberate stable entry points — but then TonePage being the only non-trivial one deserves a comment.

## 3. Stale doc comments reference deleted/renamed components
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/plugins/twin/sub_channels/useChannelActivity.ts:6
- **Scenario**: `useChannelActivity`'s header says "ChannelsBaseline renders the result" — no `ChannelsBaseline` exists (only `ChannelsAtelier`, which is the actual consumer). `TwinHero.tsx:7-9` says it is "Rendered by ProfilesPage" and references "Direction 4"; the real renderer is `ProfilesAtelier` and the direction-exploration naming is long gone (same "Directions 1/3/5" archaeology in useTwinReadiness.ts:9-13).
- **Root cause**: Components were renamed/collapsed during the variant descope but the prose comments that name them were not updated.
- **Impact**: The comments actively misdirect — someone auditing consumers of the hook will grep for a component that doesn't exist.
- **Fix sketch**: Update `useChannelActivity.ts:6` to say `ChannelsAtelier`; update `TwinHero.tsx` to say `ProfilesAtelier` and drop the "Direction 4" reference; optionally translate the "Directions 1/3/5" comment in useTwinReadiness into plain feature names.

## 4. useReadinessCelebration placement subscribes the whole TwinPage tree to four wide store slices
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/twin/TwinPage.tsx:46
- **Scenario**: `useReadinessCelebration()` (via `useTwinReadiness`) subscribes TwinPage to `twinProfiles`, `twinTones`, `twinChannels`, and `twinReadinessApproved`. Every write to any of those arrays (each tone edit, channel toggle, memory approval, hydration burst) re-renders TwinPage and therefore the entire active subtab tree — the lazy subtab components take no props and are not memoized, so they cannot bail out.
- **Root cause**: The celebration hook only needs the derived `readiness.score`, but hooks re-render their host component, and the host here is the root of the whole Twin feature.
- **Impact**: Hot-path store updates (typing-adjacent saves in Tone/Identity, approval sweeps in Knowledge) each trigger a full subtree re-render of components that already re-render themselves from their own subscriptions — double work that scales with the size of the open atelier. The `useMemo` inside `useTwinReadiness` does not help because the input array references change on every store write.
- **Fix sketch**: Move the hook into a zero-DOM child: `function ReadinessCelebrationMount() { useReadinessCelebration(); return null; }` rendered as a sibling inside TwinPage. Store-slice re-renders then confine to that empty component. Same trick applies to `useHydrateActiveTwin` if its `activeTwinId` subscription is ever widened (today it is cheap).

## 5. Channels tab visit always re-fetches communications due to key-based remount
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: redundant-fetch
- **File**: src/features/plugins/twin/sub_channels/useChannelActivity.ts:49
- **Scenario**: TwinPage renders subtabs under `key={twinTab}` (TwinPage.tsx:60), so every navigation to Channels remounts `ChannelsAtelier`, whose `useChannelActivity` effect re-issues `fetchTwinCommunications(twinId, undefined, 200)` even if the same data was fetched seconds ago while tab-hopping. `DistilledFactsPanel` (Brain) also piggybacks on this slice, so a Brain→Channels→Brain hop does the IPC+SQLite round trip on each Channels entry.
- **Root cause**: The fetch effect keys only on `[twinId, fetchTwinCommunications]`, but the mount identity is destroyed by the `key` prop on tab switch, turning "fetch once per twin change" into "fetch once per tab visit".
- **Impact**: Bounded (200 rows over Tauri IPC) but repeated on a hot navigation path; on twins with heavy communications tables the query plus serialization adds visible tab-switch latency for data that rarely changed in the interim.
- **Fix sketch**: Add a small staleness guard in the store action (skip if the slice was fetched for this `twinId` within N seconds) or track `lastFetchedTwinId` in the systemStore and have the hook only force-fetch when it differs, with an explicit refresh path for the pull-to-refresh/reply flows. Alternatively drop `key={twinTab}` remounting for the wrapper and animate via a CSS class toggle, which also spares full subtab remounts generally.
