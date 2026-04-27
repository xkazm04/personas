# Deployment, Sharing & Plugins — Dev Experience Scan

> Total: 11 · Critical: 1 · High: 5 · Medium: 4 · Low: 1
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Zero tests anywhere in `deployment/`, `sharing/`, `plugins/`, or `composition/`

- **Severity**: Critical
- **Category**: testing
- **File**: `src/features/deployment/**`, `src/features/sharing/**`, `src/features/plugins/**`, `src/features/composition/**` (no `*.test.*` / `*.spec.*` files; no `__tests__/` dirs)
- **Scenario**: This batch holds the riskiest pure logic in the app: `composition/libs/dagUtils.ts` (Kahn's topo sort + cycle detection — a one-character bug here silently turns a cyclic workflow into "execute nothing"), `deploymentTypes.ts:compareValues` (six-key sort with null fallbacks, easy to invert), `useDeploymentHealth.ts` (cache + re-map state machine guarded by a `prevKeyRef`), `useCloudHealthMonitor.ts` (generation-counter + backoff array — already commented "stale polls would stamp state"), `useDeploymentTest.ts` (timer-keyed-by-id with explicit unmount cleanup), `useTwinReadiness.deriveReadiness` (pure function with documented thresholds), and the bundle import phase machine in `BundleImportDialog.tsx` (six phases, three input sources, monotonic `requestTokenRef`). Every one of these is a textbook unit-test target — and every one is untested. Vitest is already in the toolchain.
- **Root cause**: Feature folders shipped without a testing convention. The complex logic is well-commented (the authors clearly knew the failure modes — see "stamps stale state" / "memory retention of closure" comments) but never expressed those invariants as assertions.
- **Impact**: Refactors in any of these files are manual-click-test only. The DAG cycle detector regression in particular would silently degrade the composition engine — there is nothing in CI to catch it. Rewriting the test prompt format in `useDeploymentTest`, swapping the backoff array, or changing `compareValues` ordering all carry unnecessary risk.
- **Fix sketch**: Co-locate small Vitest specs with the highest-value targets: (a) `dagUtils.test.ts` — empty graph, single node, simple chain, diamond, two disjoint subgraphs, simple cycle, self-loop, edge to non-existent node; (b) `deploymentTypes.test.ts` — every SortKey × asc/desc, with one row having null `lastActivity`/`createdAt`; (c) `useTwinReadiness.test.ts` — `deriveReadiness` is already pure, six branches × three statuses each, plus the score rounding boundary; (d) `useDeploymentTest.test.tsx` — timer cleanup on unmount, double-fire prevention, dismiss clears timer. Total ~150 LOC for ~80% coverage of the load-bearing logic.

---

## 2. Three near-identical share/import/export entry points with diverging UX

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/sharing/components/BundleExportDialog.tsx:108-201`, `src/features/sharing/components/BundleImportDialog.tsx:102-218`, `src/features/sharing/components/IdentitySettings.tsx:47-70`
- **Scenario**: BundleExport offers three send-paths (file-save, clipboard-base64, share-link); BundleImport offers three receive-paths (file-pick, clipboard-paste, share-link URL); IdentitySettings offers a fourth flavor (export identity card via clipboard, import via paste). All four call `navigator.clipboard.writeText`/`readText` directly, but only the bundle paths schedule a 30 s sensitive-clipboard wipe (`scheduleSensitiveClipboardClear`). The identity-card export does not — yet the identity card contains the user's signing public key + display name, which is exactly the kind of value that warrants the same hygiene. Toast wording, error wrapping (`errMsg` vs raw `err.message`), and "copied!" feedback timing (2000 / 2500 / 3000 ms) drift between dialogs.
- **Root cause**: Each dialog was written from scratch as the protocol it serves was added (bundles → enclaves → share-links → identity cards). No shared "share-flow" hook crystallized.
- **Impact**: Adding a fourth share medium (e.g., QR code, email mailto) means writing a fourth copy of the same orchestration. Security drift is quiet — only one of the four flows wipes the clipboard. UX wording diverges in ways the user notices.
- **Fix sketch**: Extract `useShareHandshake({ payload, sensitive })` hook returning `{ exportToFile, copyToClipboard, openShareLink, status }` with a single 30 s sensitive-wipe rule and unified toast/log wording. Apply to all four dialogs. Document in a 10-line README in `sharing/` what makes a payload "sensitive" (anything containing a private key, signed bundle bytes, or share-link token).

---

## 3. `useTwinTranslation` and `useLifecycleTranslation` are duplicated 14-locale scaffolds with the same code

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/plugins/twin/i18n/useTwinTranslation.ts`, `src/features/plugins/dev-tools/sub_lifecycle/i18n/useLifecycleTranslation.ts` (and 28 locale-bundle files between them)
- **Scenario**: Both files are byte-for-byte the same module shape: import 14 locale modules (en/zh/ar/hi/ru/id/es/fr/bn/ja/vi/de/ko/cs), build a `translations` map, look up by `useI18nStore().language`, fall back to en. Twin uses an explicit `as TwinDictionary` cast with a doc-comment about "missing keys fall back to English"; Lifecycle does the same fallback without the comment. Meanwhile every other plugin (artist, drive, research-lab, obsidian-brain, dev-tools-other-subs) uses the global `@/i18n/useTranslation`. There is no documented rule for *when* a feature should fork into a scoped i18n bundle.
- **Root cause**: Twin and Lifecycle were each built when their string surface was thought to be too large to belong in the global tree. The pattern was copied across rather than extracted. This is the same drift surfaced in the Settings scan (point #2 there) — a third instance of the same anti-pattern.
- **Impact**: Translators face three locale surfaces (global, twin, lifecycle) for one app. New devs adding a string to a Twin or Lifecycle screen often add it to the global tree first, then have to move it. Adding a 15th locale means touching 3+ folders.
- **Fix sketch**: Either (a) extract the duplicated factory into `@/i18n/createScopedTranslation(translations, key)` and consolidate to one shared hook implementation; or (b) collapse both back into the global tree under `t.plugins.twin.*` / `t.plugins.lifecycle.*`. Option (b) is simpler and matches what every other plugin already does. Document the chosen rule in `src/i18n/README.md`.

---

## 4. The "plugin system" has no plugin contract — six hardcoded panels in a giant switch

- **Severity**: High
- **Category**: code-organization | documentation
- **File**: `src/features/plugins/PluginBrowsePage.tsx:21-28`, `src/features/plugins/pluginTheme.ts:13-44`, `src/lib/types/types.ts:328`, `src/features/shared/components/layout/sidebar/sections/PluginsSidebarNav.tsx:49-228`
- **Scenario**: Adding a new plugin requires touching at minimum: (1) `PluginTab` union in `lib/types/types.ts`; (2) `PLUGIN_ACCENTS` in `pluginTheme.ts`; (3) `PLUGINS` array in `PluginBrowsePage.tsx` (with hardcoded mix of t-translated and raw English strings — `'Research Lab'` and `'Twin'` are hardcoded English; the others are translated); (4) a new `enabledPlugins.has('xxx') && (...)` block in `PluginsSidebarNav.tsx`; (5) router glue in whatever shell mounts these pages; (6) systemStore tab state for sub-tabs; (7) usually a fresh `Sub<Name>Page` lazy-loaded in a per-plugin shell. There is no `Plugin` interface, no manifest, no registration function, no docs explaining what "a plugin" even is.
- **Root cause**: "Plugins" is a UI gallery affordance that grew accidentally, not an extension point. The PluginAccentLayer + per-plugin theme machinery hints at intentional design, but the actual loader is a six-arm `if/else` chain.
- **Impact**: Every new plugin is a 7-file change touching unrelated layers. The hardcoded English strings prove the checklist is being skipped already. There is zero way to load a plugin lazily, gate it by feature flag, or test plugin enablement in isolation. AI agents adding plugins will half-do it.
- **Fix sketch**: Define a `PluginManifest` type — `{ id, label, description, icon, accent, lazy: () => Promise<Component>, sidebar?: SidebarSection }` — and a `registerPlugin(manifest)` call. Co-locate manifest with each plugin folder (`plugins/twin/manifest.ts`). Replace the hardcoded `PLUGINS` array, the `PLUGIN_ACCENTS` record, the `PluginTab` union (derive from manifests), and the if/else chain in PluginsSidebarNav with single iteration over the registry. Add a 30-line `plugins/README.md` documenting the contract.

---

## 5. `composition/` feature is a single 133-line file behind an `index.ts` re-export

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/composition/index.ts`, `src/features/composition/libs/dagUtils.ts`
- **Scenario**: The whole "composition" feature directory exists to host one DAG-utils file: `index.ts` is a one-line re-export, and `libs/` holds `dagUtils.ts` only. This is the *engine* for the persona composition system — but the file lives as a forgotten utility under an empty-looking feature folder. There are no nodes, edges, layout, validators, or UI components co-located. The name "composition" implies a feature that doesn't exist in this folder. Type imports point at `@/lib/types/compositionTypes` — types live elsewhere too.
- **Root cause**: A migration promoted `dagUtils` into a future "composition" feature shell, but the actual feature work either lives elsewhere, never landed, or was scrapped. The shell remained.
- **Impact**: A dev opening `features/composition/` to learn about the composition engine sees an empty folder and a 133-line util file that imports types from another location. Discovery is broken. Anyone writing related logic doesn't know whether to put it here, in `lib/`, or somewhere else. The single index.ts re-export adds a layer for no reason.
- **Fix sketch**: Either (a) flatten — move `dagUtils.ts` and `compositionTypes.ts` together into one place (`src/lib/composition/`) and delete the feature folder; or (b) consolidate — move the composition types from `src/lib/types/compositionTypes.ts` into `features/composition/types.ts` so the feature folder is self-contained, and add a one-paragraph README explaining what belongs there. Pick one; don't leave the orphan.

---

## 6. `TwinVariantTabs` ships throwaway A/B prototype scaffolding to all 8 twin sub-pages

- **Severity**: Medium
- **Category**: code-organization | dev-loop-friction
- **File**: `src/features/plugins/twin/_variants/TwinVariantTabs.tsx`, plus eight `Page.tsx` files (`sub_identity/IdentityPage.tsx`, `sub_tone/TonePage.tsx`, `sub_brain/BrainPage.tsx`, `sub_knowledge/KnowledgePage.tsx`, `sub_voice/VoicePage.tsx`, `sub_channels/ChannelsPage.tsx`, `sub_training/TrainingPage.tsx`, `sub_profiles/ProfilesPage.tsx`)
- **Scenario**: TwinVariantTabs is documented in its own JSDoc as "throwaway scaffolding — once a winner is picked the wrapper is collapsed and only the chosen variant remains." But every twin sub-page wraps three lazy-loaded variants (`Atelier` / `Console` / `Baseline`) inside it, persisting the user's choice to localStorage as `twin-variant:<key>`. That's `8 sub-pages × 3 variants = 24 component files` for a feature where the JSDoc explicitly says only one will ship. Production ships the prototype tab strip with a "Prototype" label literally rendered above every twin page.
- **Root cause**: A design exploration was committed and scaled out before the picker was made. The "throwaway" comment was written but not acted on.
- **Impact**: Bundle size bloated by 2× the chosen variant per sub-page. New devs touching twin pages have to read three implementations. End users see a "Prototype" pill in production. Lazy-loading is per-variant, so first-paint of each twin page pulls more code than necessary.
- **Fix sketch**: Pick a winner per-page (the persisted localStorage choice in dev gives that signal), delete the other two variant files plus `_variants/TwinVariantTabs.tsx`, and inline the chosen component into the Page shell. Remove the localStorage key. Keep `_shared/` (it's actual shared code). This is a pure deletion PR — no API changes.

---

## 7. Drive plugin keyboard shortcuts are inline in DrivePage, not extractable or testable

- **Severity**: Medium
- **Category**: code-organization | testing
- **File**: `src/features/plugins/drive/DrivePage.tsx:74-155`
- **Scenario**: A 80-line `useEffect` registers a global `keydown` listener mapping nine shortcuts (Ctrl+A/C/X/V, Delete/Backspace, F2, Enter, Arrow keys, Escape) directly inside the page component. The handler reaches into `drive.selection`, `drive.visibleEntries`, `drive.selectAll`, `drive.copy/cut/paste`, etc., and calls `setDialog` for confirms. None of this is extracted to a hook, and there are no tests for the input-target guard (`tagName === 'INPUT' || 'TEXTAREA' || isContentEditable`) — which is the load-bearing bit that prevents Backspace from deleting files when a user is renaming.
- **Root cause**: Shortcut wiring grew incrementally; never refactored once it crossed the "this should be its own thing" threshold.
- **Impact**: The only way to verify the input-target guard still works after a Drive change is to manually rename a file and press Backspace. The hook would also be a cleaner home for a future "shortcut help" overlay.
- **Fix sketch**: Extract `useDriveShortcuts({ drive, onRequestDelete, onRequestRename })` into `drive/hooks/`. Co-locate `useDriveShortcuts.test.ts` mocking `drive` and dispatching keydown events on a stub element. Same shape used elsewhere in the app (e.g. global keyboard nav).

---

## 8. `cloudExecutionStats` retry/cache logic in `useDeploymentHealth` is a hand-rolled mini state machine

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/deployment/hooks/useDeploymentHealth.ts:1-105`
- **Scenario**: The hook builds a `stableKey` from sorted persona IDs, separately tracks `deploymentIdsKey`, holds two refs (`prevKeyRef`, `personaEntriesRef`), one cache (`statsCache.current`), and forks logic on `needsFetch` to either re-fetch or re-map cached stats. The cancel guard is the classic `let cancelled = false` pattern with a manual cleanup. This entire shape is what TanStack Query (`useQuery`) is designed for — and the codebase elsewhere uses similar patterns (see `useTwinReadiness` doing pure derivation; `useDeploymentTest` doing manual timer maps).
- **Root cause**: No data-fetching library is in use; every async resource is hand-rolled, and convergent patterns aren't being extracted.
- **Impact**: Every new "fetch keyed by a stable identifier, cache the result, re-map when keys change, cancel on unmount" hook in this surface re-derives the same five-ref state machine. Subtle bugs (missing cancellation, stale cache, refs forgotten) creep in version-by-version.
- **Fix sketch**: Either (a) add a tiny shared `useCachedKeyedFetch<K, V>(keys, fetcher)` utility in `hooks/utility/` and migrate the three known instances (`useDeploymentHealth`, the persona-stats fetcher used elsewhere, similar code in `useCloudHealthMonitor`); or (b) bring in `@tanstack/react-query` for the fetch surface and migrate incrementally. (a) is lower-risk and matches the codebase style.

---

## 9. Deployment dashboard is one component with 18 store subscriptions and 6 derived useMemos

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/deployment/components/UnifiedDeploymentDashboard.tsx:19-152`
- **Scenario**: `UnifiedDeploymentDashboard` makes 18 separate `useSystemStore((s) => s.x)` subscriptions (8 state, 9 actions). Cloud-related slice subscriptions and GitLab-related subscriptions could each be grouped via `useShallow` (the codebase already does this in `CloudDeployPanel.tsx:56-69` — the *same feature folder* uses the right pattern). On every store change, this component re-runs all 18 selectors and 6 `useMemo`s.
- **Root cause**: This component was written before the `useShallow` convention was adopted in the cloud panel. No lint rule warns about >N selectors in one component.
- **Impact**: Re-render churn when any unrelated cloud or gitlab field changes (e.g., a polling tick on `cloudConnectionLatencyMs`). Single 80-line block of selectors at the top of the component is the noisiest part of the file. Inconsistent with the established convention in the same feature.
- **Fix sketch**: Group into two `useShallow` selectors — `cloudState` and `gitlabState` — mirroring the shape already used in CloudDeployPanel. Optionally add a custom ESLint rule (or just a CONVENTIONS.md note) flagging components with >6 individual `useStore` calls and pointing at the canonical example.

---

## 10. `i18n` fallback uses a `Record<string, string>` cast as untyped index in `NetworkAccessScopeBadge`

- **Severity**: Low
- **Category**: convention-drift
- **File**: `src/features/sharing/components/NetworkAccessScopeBadge.tsx:42`
- **Scenario**: `(st as Record<string, string>)[styles.labelKey] ?? scope.level` — the component casts the typed translation object to an untyped record to look up keys named like `'scope_none_label'`. That defeats the type-checker for that one access; if the translation key is ever renamed, the cast won't fail, the fallback to `scope.level` will silently kick in, and the user will see the raw enum string ("none" / "restricted" / "unrestricted") instead of a localized label.
- **Root cause**: Quick way to write a generic key lookup without setting up a discriminated mapping.
- **Impact**: Soft drift surface — a translation refactor will silently regress this badge to showing raw enum values. No type error, no runtime warning, just wrong copy.
- **Fix sketch**: Replace the `Record<string, string>` cast with an explicit map: `const SCOPE_LABEL: Record<NetworkAccessScope['level'], string> = { none: st.scope_none_label, restricted: st.scope_restricted_label, unrestricted: st.scope_unrestricted_label }`. Three lines, fully typed, refactor-safe.

---

## 11. No documented convention for `sub_*` vs `components/` vs root-level files

- **Severity**: Medium
- **Category**: documentation | convention-drift
- **File**: `src/features/plugins/{artist,dev-tools,obsidian-brain,research-lab,twin}/sub_*/`, `src/features/plugins/{drive,twin}/{components,_shared,_variants,hooks,i18n,signing,ocr}/`, `src/features/sharing/components/`, `src/features/deployment/{components,hooks}/`
- **Scenario**: Drive uses `components/`, `hooks/`, `signing/`, `ocr/`. Sharing uses only `components/` (but bundle-related and identity-related and peer-related and exposure-related all sit flat in there with 16 files). Deployment uses `components/` + `hooks/` + a nested `components/cloud/` (with its own internal `*Helpers.ts` and `*Helpers.tsx`). Plugins uses `sub_<name>/` (artist, dev-tools, obsidian-brain, research-lab) with hooks/utils sometimes flat at the plugin root, sometimes in `hooks/`, sometimes in `_shared/` (twin only), and sometimes in inner `i18n/` folders (twin + dev-tools/sub_lifecycle only). Composition uses `libs/`. There are at least 5 different organizational patterns in 4 sibling feature folders.
- **Root cause**: Each feature was structured by whoever built it first. No `CONVENTIONS.md` sets a baseline.
- **Impact**: Where do you put a new shared utility under twin? Look at `_shared/`. Drive? Try `components/` or guess. Deployment? Maybe `hooks/` if it's stateful, otherwise inline in components. Onboarding cost compounds — a dev moving between these features has to relearn the layout each time. AI agents place files inconsistently.
- **Fix sketch**: Pick the simplest convention that already works in the largest feature (Drive's `<feature>/{DrivePage.tsx, components/, hooks/, <subdomain>/}` shape is clean). Document in 20 lines at `src/features/README.md`. As a soft migration, when touching any of these files for unrelated work, nudge them toward the convention. Don't do a flag-day rename — too much churn for a low-velocity issue.

---
