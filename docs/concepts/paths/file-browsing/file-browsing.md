---
layer: golden-path
subject: file-browsing
status: forged
techniques:
  - listing-and-refresh
  - navigation-state
  - selection-model
  - file-mutations
  - thumbnails-and-previews
  - kind-taxonomy
evidence:
  - src/features/plugins/drive/hooks/useDrive.ts                    # master browser hook: history nav, identity selection, persisted view-state blob, bulk mutations behind one guard door
  - src/features/plugins/artist/sub_gallery/GalleryPage.tsx         # library view: kind buckets, date grouping, ghost-under-chrome, error ≠ empty
  - src/features/plugins/artist/sub_gallery/ThreeViewer.tsx         # heavy preview isolated behind its own error boundary; the file stays actionable when the renderer dies
  - src-tauri/src/commands/obsidian_brain/vault_fs.rs               # depth-capped walk with explicit per-caller error + hidden-entry policy (cross-domain confirmation from the vault ground)
  - src-tauri/src/commands/drive.rs                                 # soft-delete to trash, hard-delete inside trash, root-destruction refusals re-validated at the command layer
counter_evidence: []
deviations:
  - w7-file-browsing   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# File & asset browsing

A file browser is the surface you build when the user's material lives in a
**hierarchical store the application does not own** — a filesystem, a media
library, a vault of documents. The user's job is spatial and manipulative:
find the thing, orient around where it lives, and act on it — open, rename,
move, tag, delete. The surface is less a report than a workbench.

Three properties separate this subject from [a table](../table/table.md), and
each one changes the architecture, not just the styling:

1. **Hierarchy is the primary axis.** A table's records are uniform peers and
   the user's question is comparative. A browser's items live inside one
   another; containment — where a thing is, what it is next to, what it is
   inside — carries meaning the user actively navigates. Flattening the tree
   into rows discards the very structure the user came to use.
2. **Items are nouns under direct manipulation.** Table rows are read and
   compared; browser items are *grabbed*: renamed in place, dragged between
   containers, multi-selected and deleted. Every item is simultaneously a
   display object and a mutation target, so identity, selection, and
   conflict handling are core architecture rather than optional garnish.
3. **The store is a foreign, concurrent authority.** A table usually fronts
   the application's own data, changed through the application's own doors. A
   file browser fronts a store that other programs, other devices, and the
   user's own second window mutate freely, at any moment, without notice. The
   surface can never assume it is the only writer — or even a current reader.

The third property is the deepest. Everything that makes file browsers hard —
stale listings, mutations that fail because the target vanished, thumbnails of
files that changed underneath their cache — is a consequence of building a
view over an authority that does not consult you.

## The view is a cache

What the browser renders is never "the directory"; it is **the result of a
listing taken at some moment in the past**. Between that moment and now, the
store may have changed. Pretending otherwise is the root defect of naive
browsers; a principal-quality one makes three decisions explicitly:

- **When does the view refresh?** On navigation, on window focus, on an
  interval, on a change notification from the store, on demand — each with
  different costs and different windows of staleness. Choosing is design;
  inheriting whatever the first implementation did is drift.
- **What happens to in-view state on refresh?** Selection, scroll position,
  expanded folders, an in-progress rename — a refresh that resets these
  punishes the user for the surface staying honest. State keyed to item
  *identity* survives; state keyed to *position* dies (see
  [selection-model](techniques/selection-model.md)).
- **How does the surface admit staleness?** After a failed mutation ("that
  file no longer exists"), the honest response is to refresh and say why —
  not to leave a ghost item the user will click twice more.

The listing itself — depth policy, error policy, refresh mechanics — is the
[listing-and-refresh](techniques/listing-and-refresh.md) technique.

## Navigation state is the user's mental map

Which folders are expanded, where the user is, how the view is sorted and
displayed — this is not incidental UI state. It is the externalization of the
user's spatial memory, built up click by click, and destroying it (on
navigation away, on restart, on refresh) forces the user to rebuild their map
from nothing. Treat it as one first-class object:

- **Persist it** across leave-and-return and across restarts. A browser that
  reopens collapsed-to-root every time has amnesia about the one thing the
  user taught it.
- **Version and scope it.** Per store root, per user; restorable as a unit.
- **Restore by identity, not position.** A persisted "expanded" set of path
  identities survives siblings appearing and disappearing; a persisted list
  of indices is corrupted by the store's first independent change.

The shape of this object, breadcrumbs, tree-vs-list duality, and
restore-on-return are the [navigation-state](techniques/navigation-state.md)
technique.

## Selection scales

Selection in a browser is not a single highlighted row. It is a set — grown
by toggling, extended by ranges, sometimes spanning containers — and it is
the *input to every mutation*. Three commitments:

- **Selection is a set of identities**, never a set of positions. Items get
  resorted, refreshed, and moved while selected; a positional selection
  silently retargets the user's next destructive action onto the wrong files.
- **Selection survives a refresh** by intersecting the identity set with the
  new listing: items still present stay selected, items gone drop out —
  visibly, if the user's action depended on them.
- **The count shown is the count acted on.** "14 selected" must be exactly
  the set that delete will receive, including anything selected but scrolled
  out of view. The moment those diverge the surface is lying about the blast
  radius of the next click.

Range semantics, keyboard modifiers, and select-all against a partially
loaded view are the [selection-model](techniques/selection-model.md)
technique.

## Mutations are the danger zone

Rename, move, delete, tag: each one is a write against the foreign authority,
racing every other writer, and each can fail *partially* when applied to a
multi-selection. This is where a browser earns or forfeits trust:

- **Preflight what you can, but treat every mutation as contested.** The
  target may have vanished, been renamed, or gained a name collision between
  the listing and the click. Failures here are normal operation, not
  exceptions — they get designed responses, not error toasts with stack
  traces.
- **Bulk operations report per item.** "Moved 12 of 15 — 3 failed: …" with
  the failures enumerated and re-actionable. A bulk result that says only
  "done" after a partial failure converts three lost files into a discovery
  the user makes next week.
- **Destruction gets a reversal path or an honest gate.** Soft-delete to a
  recoverable holding area when the store offers one; an explicit,
  proportionate confirmation when it does not. Silent permanent deletion
  behind a single click is never acceptable; neither is a confirmation so
  routine it trains the user to click through it.
- **The view reconciles after every mutation** — optimistic if you can
  reverse, pessimistic if you cannot, but never left showing a state the
  store no longer has.

Conflict handling, trash-versus-delete, and partial-failure reporting are the
[file-mutations](techniques/file-mutations.md) technique.

## Previews are guests, not owners

A browser that can show the user *what a file is* — a thumbnail, an inline
preview, a rich viewer — is dramatically more useful than a list of names.
But every preview is code executing against untrusted, possibly corrupt,
possibly enormous content, and the cardinal rule is **isolation**: a broken
file, a decoder crash, or a renderer that takes seconds must cost the user
one tile, never the browser. Thumbnails are derived data with cache and
invalidation semantics; heavyweight viewers (video, dimensional models) load
lazily and fail inside their own boundary. All of it is the
[thumbnails-and-previews](techniques/thumbnails-and-previews.md) technique.

## Kinds, names, and order

Files arrive as undifferentiated names plus metadata; the browser adds the
taxonomy that makes them navigable — kind buckets (image, video, document,
audio, other), the icon and preview treatment each kind gets, and the sort
and grouping vocabulary (by name, by kind, by date, grouped by recency).
That vocabulary must have exactly one authoritative definition that every
consumer — filter chips, sort menus, group headers, per-kind behavior —
derives from, or the buckets drift apart the first time someone adds a kind.
This is the [kind-taxonomy](techniques/kind-taxonomy.md) technique.

Boundary note: kind *filters* and name *search* belong to the browser only as
entry points; query mechanics — parsing, matching, ranking — are
[search's](../search/search.md) subject. The browser contributes the corpus
and the taxonomy tokens; search owns what happens when the user types a
query.

## Accessibility posture

- The tree is a real tree in the accessibility layer: items expose
  expanded/collapsed state, depth, and set position; expansion is operable
  from the keyboard.
- **Full keyboard traversal is table stakes**, because file management is a
  keyboard-heavy activity for its power users: arrows to move and
  expand/collapse, type-ahead to jump by name, explicit keys for open,
  rename, and delete.
- Rename-in-place is a real editing context — focus moves into it, escape
  cancels, and the accessible name updates when it commits.
- Selection state and selection *count* are announced; a bulk-action bar
  appearing because three items are selected must be discoverable without
  sight.
- Dragging items between containers always has a keyboard-and-menu
  equivalent (cut/move-to), since drag is unavailable to many users — the
  drag interaction itself belongs to the drag-drop subject.

## The techniques

- [listing-and-refresh](techniques/listing-and-refresh.md) — reading the
  foreign store: depth caps, error policy per entry, watch-versus-poll
  refresh, and staleness honesty.
- [navigation-state](techniques/navigation-state.md) — the persisted mental
  map: expansion, breadcrumbs, view mode, restore-on-return.
- [selection-model](techniques/selection-model.md) — identity-based
  selection sets, range semantics, surviving refresh, select-all honesty.
- [file-mutations](techniques/file-mutations.md) — rename/move/delete
  against a live store: conflicts, bulk partial failure, trash versus
  delete, reconciliation.
- [thumbnails-and-previews](techniques/thumbnails-and-previews.md) — derived
  visuals: lazy generation, cache invalidation on change, error boundaries,
  heavy-viewer isolation.
- [kind-taxonomy](techniques/kind-taxonomy.md) — one authoritative kind
  vocabulary driving buckets, icons, filters, sort, and grouping.
