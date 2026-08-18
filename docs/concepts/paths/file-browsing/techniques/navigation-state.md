---
layer: technique
subject: file-browsing
technique: navigation-state
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Navigation state

Every click in a browser teaches it something: which folders the user opened,
where they are, how they like the view arranged. Navigation state is the sum
of that teaching, and the technique is to treat it as **one named, persisted,
restorable object** rather than a scatter of ephemeral flags that evaporate
on the next unmount.

## What the object contains

One struct, one owner, one persistence key per store root:

- **Current location** — the path or identity of the directory in view.
- **Expansion set** — the identities of every expanded tree node.
- **View mode** — tree, list, grid; icon size; whether previews render.
- **Order** — sort field and direction; grouping choice.
- **Filter tokens** — active kind buckets or tags (the *choices*; the query
  mechanics they feed belong to the search subject).

Two things deliberately *not* in it: **selection** (a set of mutation
targets, too dangerous to resurrect across sessions — restoring a
half-remembered selection re-arms a delete the user configured days ago) and
**scroll position** (restore it opportunistically within a session, but it is
positional by nature and rots across store changes).

## Persist as a unit, restore by identity

The object round-trips as a whole. Partial persistence — sort survives but
expansion does not — feels broken in a way users cannot articulate; the
surface remembers trivia and forgets the map.

Restoration is where implementations rot, and the rot is always the same
mistake: **persisting positions instead of identities**. An expansion set
stored as tree indices is corrupted by the store's first independent change —
folders appear and vanish between sessions, and index 4 is somebody else now.
Store identities (stable ids where the store mints them, full paths where it
does not), and at restore time *reconcile against the live listing*:

- Expanded identity still exists → re-expand it.
- Expanded identity gone → drop it silently; a missing folder is not an
  error, it is the store exercising its authority.
- Current location gone → walk up to the nearest surviving ancestor and land
  there, saying so. Restoring into a void — an empty panel for a deleted
  folder — reads as data loss even when nothing of the user's was lost.

The reconcile step means restore is a *merge with reality*, never a blind
replay. Blind replay is how a browser ends up rendering folders that no
longer exist.

## Breadcrumbs and the tree-list duality

Most browsers show location twice: a tree (the map) and a path trail (the
"you are here"). Both derive from the same current-location value — two
renderings, one authority. The moment each maintains its own idea of where
the user is, they disagree after exactly one edge case (a rename of an
ancestor is the classic), and the user is looking at a surface that points
two directions at once.

The trail is interactive: every ancestor segment navigates, and on width
pressure it collapses the *middle* (root and current stay visible — those
are the two segments that orient).

## When to write

Persist on change, debounced — not on exit. Exits are the moments most
likely to be crashes, kills, or power loss, which is to say: the moments the
write does not happen. A browser that only saves its map on clean shutdown
loses the map precisely when the user already lost everything else.

## Scope and reset

State is scoped per store root (two different vaults do not share an
expansion set) and survives version upgrades by tolerating unknown fields
and missing ones — a navigation-state object that hard-fails on schema drift
converts an upgrade into amnesia. And there is always a cheap "reset view"
door: persisted state that has drifted into a bad configuration must be
escapable by the user without folklore.
