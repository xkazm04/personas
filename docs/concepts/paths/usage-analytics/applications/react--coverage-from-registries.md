---
layer: application
subject: usage-analytics
technique: coverage-from-registries
stack: react
---

# Coverage from registries — React/Zustand nav stores

How this repo derives its analytics coverage from the app-shell's navigation
registry, where the derivation is exemplary, and where the technique's "close
every axis" warning was measured being violated.

## The derivation

`src/lib/analytics/navCatalog.ts` is the tracked-surface catalog. Its section
half is a true projection of the shell's registry:

```ts
// navCatalog.ts:60
export const SECTIONS: readonly SidebarSection[] = NAV_SECTIONS.map((e) => e.id);
```

`NAV_SECTIONS` comes from `src/lib/navigation/registry.ts` — the same
single-authority registry the Sidebar renders from (app-shell's
navigation-model technique). A section added to the shell is in the analytics
denominator the same commit; there is no parallel list to forget. Every
reachability class rides along (sidebar, overlay-only, hidden), because the
registry declares reachability and a user can visit any of them.

## The full-denominator report

`src/lib/analytics/summary.ts` (`buildSessionSummary`, 58 lines, pure,
unit-tested without a DOM) diffs the session's accumulated counts against the
*full* catalog and returns `sectionsVisited` / `sectionsIgnored` /
`tabsVisited` / `tabsIgnored` plus both totals — the negative space as
first-class output. The `SessionSummary` type in `src/lib/analytics/sink.ts:57`
carries `sectionsIgnored` and `tabsIgnored` explicitly; its docstring calls the
ignored lists "the point of the whole exercise". This is the visited-AND-ignored
contract from the technique, implemented as a side-effect-free function whose
correctness is exactly the catalog's correctness.

## The value-axis guard

Tab dimensions mirror unions in `src/lib/types/types.ts`. The catalog closes
each dimension's value set with an exhaustive `Record`:

```ts
// navCatalog.ts:69
const exact = <T extends string>(map: Record<T, true>): readonly T[] => Object.keys(map) as T[];
const HOME_TABS = exact<HomeTab>({ welcome: true, cockpit: true, ... });
```

The file's own comment records why: the previous `satisfies readonly X[]`
guard accepted *subsets* and silently missed `mastermind` and `missions` when
those tabs shipped; a `Record<Union, true>` makes both an omission and a stale
extra a compile error. This is "drift detected" hardened to "drift impossible"
— on the value axis.

## The axis the guard does not reach (measured deviation)

`TAB_DIMENSIONS` (`navCatalog.ts:109`) — the list of *which* tab dimensions
exist — is a hand-written array literal with no exhaustiveness obligation,
because "the set of tab-shaped fields on the nav stores" is not a type
anything can be exhaustive over. The legacy composition over this layer
(docs/concepts/golden-paths/usage-analytics.md §7 D2/D7) inventoried the
stores with two independent scanners and found **20 tab-shaped nav fields
against the catalog's 14**: `artistTab`, `companionPluginTab`, `kpisTab`,
`obsidianBrainTab`, `twinTab`, `pendingLifecycleSubTab` unregistered — four of
them plain slices of the system store the existing subscription would have
picked up for free. The session summary's `tabsTotal` denominator was 104
where the reachable population is 122 (85.2%), so every "ignored tabs" figure
ever emitted undercounted its own denominator — in the direction that makes
surfaces look less used.

This is the technique's warning verbatim: the omission did not stop when the
value axis was closed; it moved to the dimension axis, where no type reaches.
The prescribed remedy is the technique's "detected" fallback — an inventory
instrument (a script enumerating `*Tab` fields in `src/stores/slices/` and
diffing against `TAB_DIMENSIONS`, exit non-zero on any unregistered dimension,
with a floor assertion so an empty inventory is FATAL, not green) — since the
projection genuinely cannot be computed from a type. The legacy composition
specifies it in its §9.4; it is not yet built.

## Shared plumbing, one emit site per event class

`src/lib/analytics/index.ts` subscribes once to the nav stores and emits
`feature_visit` for whatever section/tab the store transitions to
(`emitSectionVisit` / `emitTabVisit`) — no per-surface tracking calls in any
screen component, which is the technique's "no surface instruments itself"
rule. Lazy stores attach on first visit (`LAZY_STORE_ATTACHERS`), capturing
the current tab immediately since subscribe only fires on change — a detail
worth copying: a lazily attached observer must read the present state, or the
first visit of the session is systematically missed.
