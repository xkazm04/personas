---
layer: technique
subject: session-resume
technique: layered-place-restoration
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Layered place restoration

"Put me back where I was" decomposes into four layers, and treating them
as one feature is how applications end up restoring the cheap layers by
accident and the valuable ones not at all. The layers, shallow to deep:

1. **Route** — the section and view the user was in.
2. **Scroll** — where within the view their eyes were.
3. **Active entity** — the item selected, opened, or focused.
4. **In-progress work** — the half-written draft, the wizard mid-step,
   the message composed but unsent.

Value and risk both increase with depth. A restored route is nearly
always right and costs one click when wrong. Restored scroll is right if
the content is unchanged and mildly wrong otherwise. A restored entity
may since have been renamed, closed, or deleted. Restored in-progress
work may collide with edits made elsewhere in the meantime — the only
layer whose failure mode is a *conflict* rather than a misplacement.
The consent model tracks the same gradient: shallow layers restore
automatically, deep layers are offered
([resume-affordances](resume-affordances.md)).

## The declaration rule

The discipline of this technique is not "restore everything." It is:
**every surface declares, for each layer, whether it restores — and the
absence of a layer is a recorded decision, not a gap nobody chose.** The
audit is mechanical: walk the surfaces, walk the four layers, and demand
an answer at each cell. The holes this finds are consistently the
per-entity ones — the long chat transcript with no per-thread reading
position (a real, recorded finding: the shell restored the section, the
lists restored their scroll, and the thread the user was reading dumped
them at the top), the wizard that forgets its step — because those layers
require per-entity storage and someone has to decide to build it, whereas
route restoration falls out of persisting one string. An application can legitimately
decline a cell ("scroll in this list is not worth keeping"); what it may
not do is fail to notice the cell existed.

## Per-layer contracts

Each restoring layer declares three things: **storage key**, **lifetime**,
and **invalidation** — what makes the saved place wrong.

- **Route** — key: singleton (last location). Lifetime: indefinite.
  Invalidation: the route no longer exists (renamed section, removed
  feature, revoked entitlement) — restoration must validate against the
  *current* route table and fall back to home, silently. Restoring into
  a dead or forbidden route greets the returning user with an error
  screen as their welcome. The serialization of "where" — location as
  data, validated on entry — is the navigation model's territory (owned
  by the app-shell subject); this layer consumes it.
- **Scroll** — key: per *context* — encode everything that defines
  "where you are" (surface, entity, tab, the filters in force) into the
  key, so a genuinely new context starts at the top and only a *return*
  restores. Lifetime: the process by default (a module-scoped map is the
  honest minimum); across restarts only when the content is stable
  enough to deserve it. Two forms, chosen by content volatility:
  a **pixel offset** is cheap, generic, and right for lists whose
  contents are stable across the return; an **item anchor** — "the entry
  you were reading," found again by identity — survives reflow and
  insertion above, and is the form for long, growing streams (a
  transcript, a feed). Whichever form, restoration must **wait for real
  content**: a list that renders a ghost, then data, then virtualized
  rows growing to height, will snap a naïvely-applied offset back to
  zero — re-apply across a short frame budget until the container is
  tall enough to hold the target, then stop, and suppress the save path
  while restoring so the synthetic scrolls do not overwrite the saved
  value. Index-keyed positions are wrong in either form.
- **Active entity** — key: per surface. Lifetime: medium. Invalidation:
  the entity is gone or inaccessible — validate before restoring, fall
  back to the surface's default state, and say nothing (announcing "the
  item you had open was deleted" at launch is an answer to a question
  the user hasn't asked; let the surface's normal empty/default state
  carry it).
- **In-progress work** — key: per entity, per flow. Lifetime: explicit
  and generous, but finite and disclosed. Invalidation: the underlying
  entity changed since the draft was taken — which is not a discard
  signal but a *conflict* signal, and the restoration must surface both
  versions rather than silently preferring either. This layer's storage
  is real user work; it is the one layer where silent loss is
  unforgivable and silent overwrite is worse. Draft mechanics (dirty
  tracking, autosave cadence) belong to the editing subject; this layer
  owns *that the draft survives the session and is offered back*.

## Restoration order and failure isolation

Layers restore outside-in — route, then entity, then scroll, then the
offer of in-progress work — because each depends on the previous one
having landed. Scroll restoration cannot run until the list it scrolls
has painted its real content (restoring scroll into a ghost re-scrolls
to zero when data arrives; coordinate with the loading sequence). Each
layer fails *independently and silently downward*: a dead entity does
not abort the route restore; a failed scroll restore leaves the top of a
correctly-restored view. The user should never see restoration fail —
they should only ever land somewhere reasonable, at worst one layer
shallower than hoped.

## Storage hygiene

Deep layers accumulate per-entity records — reading positions, drafts,
wizard states — keyed by an unbounded population. Every such store names
its reaper at creation
([creation-names-reaper](../../_laws.md#creation-names-reaper)): a cap
with eviction, an age-based prune, or a lifecycle hook (entity deleted →
its positions and drafts go too). The orphaned-draft store that only
ever grows, keyed by entities that no longer exist, is this technique's
signature leak. And all of it is *user* place data — it lives in the
user's local persisted state (mechanics owned by the client-state
subject), never conflated with the agent's memory of its own work.

## Decision rules

- Four layers, each declared per surface: restores / deliberately does
  not. Undeclared cells are audit findings.
- Validate before restoring: route against the current route table,
  entity against existence and access; fall back one layer, silently.
- Key scroll by full context; offset for stable lists, item identity for
  growing streams; never by index. Restore only once real content is
  tall enough, and mute the save path while restoring.
- In-progress work: finite disclosed lifetime, conflict surfaced on
  underlying change, never silently dropped or silently applied.
- Restore outside-in; each layer's failure degrades one layer shallower,
  invisibly.
- Per-entity place stores name cap, pruning, and deletion propagation at
  creation.
