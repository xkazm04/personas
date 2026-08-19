---
layer: technique
subject: markdown-vault
technique: editor-interop
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Editor interop

The vault's defining constraint as a design discipline: the human opens the
same files in their own editor, edits them at arbitrary times, and holds
final authority over their contents. The application is a *guest* in a store
it did not exclusively create and does not exclusively write. Every practice
here descends from one rule — **never fight the user for the file** — and
from its corollary: when the application and the human collide, the human
wins, and the application's job is to notice, adapt, and escalate rather
than overwrite.

## Never hold, never tear

- **No locks, no long-lived handles.** An exclusive hold on a note is a
  fight the application picks with the editor on the human's behalf. Open,
  read, close; open, write, close.
- **Atomic replace on every write** — temp sibling, then rename over the
  target — so the editor's renderer, refreshing at any instant, sees either
  the whole old note or the whole new one. A torn half-write shown in the
  human's own editor is the fastest possible way to teach them the
  application corrupts their files, whether or not it technically did.

## Assume external edits; detect, don't poll-and-pray

Quiescence is never a valid assumption. The interop posture is layered
detection with declared bounds:

- **Watch the vault** for change events and react — refresh views, drop
  derived caches — rather than trusting anything read earlier. Change
  storms are real (a bulk edit, a sync client writing hundreds of files),
  so events are **debounced** into batches instead of stampeding consumers.
- **Bound the blind spots.** The watcher only sees changes while it runs;
  edits made while the application was closed, or before the watcher
  attached, are invisible to it. Whatever caches or ledgers depend on vault
  state therefore carry a second, time-based staleness bound — the watcher
  is the precise mechanism, the time bound is the honesty mechanism.
- **One watcher per vault, and it names its reaper**, per
  [creation-names-reaper](../../_laws.md#creation-names-reaper): switching
  vaults tears down the old watcher before attaching the new one; the
  debounce machinery dies with it. A leaked watcher on a previous vault is
  a background writer of confusing events into the new session.

External edits to records the application *also* writes are not an interop
problem to solve locally — they are exactly the both-sides-moved case whose
three-way discipline lives with the sync layer. Interop's obligation is to
deliver the detection signal, and to refuse the tempting local shortcut of
last-writer-wins.

## Hand navigation back across the boundary

Interop runs in both directions. When the application shows the human a
note, the affordance they actually want is *open it in my editor* — served
by the editor's own deep-link scheme. Discipline of the link itself:

- **Address by full vault-relative path, not basename.** Basenames collide
  across folders; an ambiguous link that opens *a* note with that name is
  worse than none, because it is silently wrong.
- **Normalize the path shape** to the form the editor's scheme expects
  (separator direction, extension conventions), and encode it properly —
  paths contain spaces and human punctuation.
- **Degrade to a no-op, visibly harmless,** when the editor or vault
  identity is not yet known — the affordance can be wired unconditionally
  and simply do nothing rather than every call site growing a guard.

## Be a native citizen of the format

The store is shared territory, so the application writes what the editor
renders natively: the editor's own link syntax so projected records
participate in the human's graph, frontmatter the editor's UI understands,
titles and filenames a human would plausibly have chosen. And it keeps out
of the editor's private territory: configuration and cache directories are
never walked, never linted, never written. A vault where machine-emitted
notes are indistinguishable in kind from human-authored ones — linkable,
searchable, editable — is the success criterion; a vault where the
application's output is a foreign colony the editor renders as broken
syntax is the failure.
