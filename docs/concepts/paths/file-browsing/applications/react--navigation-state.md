---
layer: application
subject: file-browsing
technique: navigation-state
stack: react
---

# Navigation state — the Drive Finder's master hook

`src/features/plugins/drive/hooks/useDrive.ts` is the single owner of the
Drive Finder's navigation state, and it demonstrates the technique's core
moves alongside two honest gaps.

## Persist as a unit

The persisted view state is **one JSON blob under one key** —
`VIEW_STATE_KEY = "drive.viewState"` (line 28) holding
`{ viewMode, sortKey, sortDir }`. The header comment states the rationale in
the technique's own terms: "Single JSON blob so writes are atomic and the
shape can grow without breaking older clients." Reads are tolerant
(`readPersistedViewState` returns `{}` on parse failure instead of
crashing — schema drift degrades to defaults, never to amnesia with an
error), and writes merge over the current blob
(`writePersistedViewState`, lines 46–51).

## Persist on change, hydrate lazily

There is no save-on-exit anywhere. The public setters are wrappers that
persist immediately: `setViewMode` (lines 277–280) and `setSort`
(lines 542–551) write the blob on every change, while the raw state setters
stay private to the hook. On mount, state hydrates from the blob via lazy
initializers (`useState(() => readPersistedViewState().sortKey ?? "name")`,
lines 263–273) so the JSON parse happens once, not per render.

## History as first-class navigation

`history: string[]` + `historyIndex` (lines 239–241) give back/forward/up
semantics over folder paths — identities, not indices into any listing. The
`navigate` callback (lines 456–468) truncates forward history and carries a
guard: re-navigating to the current path is a no-op, because without it the
index "would drift past the array length when a user clicks the current
breadcrumb". That is the identity-keyed map defending itself against a
degenerate transition.

## Warm return without persistence

A module-scope cache (`driveEntriesCache` / `driveTreeCache` /
`driveRecentCache`, lines 71–74) survives the route's full unmount so a
revisited folder paints instantly from last-known entries while a background
refresh settles — the "restore-on-return paints warm" half of the technique,
implemented at session scope. Per-folder scroll memory works the same way:
`rememberScroll`/`recallScroll` over a ref-held `Map` (lines 338–344),
session-scoped and deliberately positional, exactly the disposability the
technique assigns to scroll.

## Deliberate exclusions, and two gaps

Selection and the kind filter reset on navigation (lines 385–389) — armed
intent and folder-scoped filters do not travel, matching the technique's
"what not to persist" list. The gaps against the standard: **current
location and tree expansion are not persisted across sessions** (history
re-initializes at the root path on every mount, line 239), so the Finder
reopens at the root rather than where the user left off; and since restore
never happens, the reconcile-against-live-listing step has no
implementation to point at. The warm cache softens the first gap within a
session but is not a substitute across restarts.
