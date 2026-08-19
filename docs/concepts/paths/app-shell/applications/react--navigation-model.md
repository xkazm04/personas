---
layer: application
subject: app-shell
technique: navigation-model
stack: react
---

# NAV_SECTIONS + railSection + passesGates — how this repo owns the location

The app is URL-less (a desktop webview, no address bar), so the navigation
model lives entirely in owned state: `systemStore.sidebarSection` is the one
current-location value, and `src/lib/navigation/registry.ts` is the closed
vocabulary it is validated against.

## The registry — one authority, four derived consumers

`NAV_SECTIONS` (`registry.ts:74-95`) is the technique's registry, verbatim:
one entry per `SidebarSection` with `label`, `labelKey`, `icon`, `gates`
(`minTier` / `devOnly`), and — the upward lesson the corpus fed back —
`reachability: 'sidebar' | 'nested' | 'overlay-only' | 'hidden'`, so the rail,
the content router, the command palette, and the analytics catalog each derive
their own subset (`SIDEBAR_SECTIONS`, `NESTED_SECTIONS`, `OVERLAY_SECTIONS`,
`registry.ts:122-140`) instead of keeping private lists. The file's own header
names the four catalogs that used to drift apart before it existed. Two gates
keep it honest: a compile-time exhaustiveness assertion
(`registry.ts:105-108`, `_AssertAllRegistered` collapses to `never` if a union
member lacks an entry) and a completeness test (`registry.test.ts`) failing
the build if any consumer omits or invents a section.

Derivations, as the technique prescribes:

- **Active state**: `railSection(id)` (`registry.ts:134-136`) returns
  `entry.parent ?? id` — the nested `design-reviews` section highlights its
  `credentials` parent by *containment*, not by a second flag. The sidebar's
  L2 panel title resolves through the same call (`Sidebar.tsx:215-216`).
- **Gating**: `passesGates(gates, ctx)` (`registry.ts:154-158`) is the one
  place tier + dev gating is decided; sidebar, router, palette
  (`commandPaletteUtils.ts`), and the back/forward engine all consult it.
- **History**: `src/lib/navigation/history.ts` is a pure two-stack
  browser-style engine over `NavDestination { section, personaId }`,
  side-effect-free and exhaustively unit-tested; it prunes destinations that
  `passesGates` now rejects, so Back never lands on a forbidden place.
- **Restore validation**: the store's rehydrate hook migrates the retired
  persisted id `'goals'` to `'teams'` (`systemStore.ts:138-141`) — a
  persisted location treated as untrusted input, exactly the technique's
  restore rule.

## Where the repo falls short of the standard (kept, not hidden)

- **The registry governs 11 of ~156 destinations.** The legacy sweep
  (`docs/concepts/golden-paths/navigation-destination.md`, measured
  2026-08-15 by AST pass + a 143-revision history walk) counted 24
  destination vocabularies; the L2 tab unions in `src/lib/types/types.ts`
  (`OverviewTab`, `SettingsTab`, `DevToolsTab`, …) have no registry, no
  completeness test, and no restoration validation — ~7% coverage of the
  destination space. The same sweep's sharpest transferable result: drift
  tracks the *type link* (`Record<ModuleId, X>` drifted 0/42 vs
  `Record<string, X>` at 5/14), not URL-vs-state.
- **Navigation writes do not all pass one door.** `setSidebarSection` is
  callable with unvalidated strings, and the deep-link sweep
  (`cross-surface-deep-link.md`) found three shipped surfaces passing ids
  that were *never* in the union (`'pipeline'`, `'agents'`) — persisted,
  replayable, and throwing `TypeError` at render. The technique's "one
  validating navigate door" exists for gates but not for id validity.
- **The OS-level URL scheme cannot name a destination.** The registered
  deep-link handler serves five prefixes (auth, share, import, referral,
  pairing) and none carries a section or tab — external addressability
  stops at the app's front door.
