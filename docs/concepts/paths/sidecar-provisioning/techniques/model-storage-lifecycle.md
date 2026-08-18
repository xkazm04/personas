---
layer: technique
subject: sidecar-provisioning
technique: model-storage-lifecycle
status: forged
laws: [creation-names-reaper, derivation-names-recomputation, identity-survives-reuse]
shared_with: []
---

# Model storage lifecycle

Downloaded artifacts are tenants on a machine the application does not
own. A model file is tens of megabytes to tens of gigabytes; a healthy
application accumulates several; and the user will eventually stand in
front of a disk-usage view asking what this application is doing with
forty gigabytes. This technique owns residency: where provisioned
artifacts live, under what identity, how their cost is accounted, how they
are shared, and how they die.

## The managed directory

All provisioned artifacts live under **one application-owned root** in the
platform's designated application-data location — never scattered beside
whatever feature first needed them, never in the installation directory
(which updates may wipe and permissions may forbid), never in the user's
document space. One root buys three things: the storage accounting below
is a walk of one tree; backup and sync tooling can be pointed at or away
from it as one decision; and complete uninstallation is the removal of one
directory.

Within the root, layout is derived from the catalog's identity scheme —
by artifact family, then by identity-with-version — so that a directory
listing is *legible*: a human can look at the tree and see what is
installed at which version. An artifact's on-disk name carries its stable
identity, not its download circumstances
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): the
same catalog entry re-downloaded lands at the same place, and two versions
of one model are two entries, not one file whose contents depend on
history.

## Accounting: the store can always answer for itself

The application can enumerate, at any moment: what artifacts are resident,
what each cost in bytes, which capability each serves, and — where usage
tracking exists — when each was last actually used. This inventory backs a
user-facing storage surface, because a user deciding whether to evict a
model deserves the same information the application has.

The accounting rule is
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
applied to disk: any cached inventory or total is a derivation of the
tree, and the tree is the truth. The inventory is recomputed by walking
the managed root, and the recomputation runs at natural checkpoints —
after downloads, after evictions, on entry to the storage surface — so a
crash mid-download or a user deleting files by hand converges back to
honesty instead of persisting as a phantom entry. Artifacts the walk finds
that the catalog cannot explain are surfaced as unaccounted residue, not
silently summed.

## Sharing: one artifact, many consumers

The expensive failure of naive per-feature storage is the same model
resident twice because two features each "own" a copy. The managed
directory stores by artifact identity, not by consumer: features hold
*references* (a need declared against the catalog identity), and the store
maps identity to the single resident copy. This changes eviction from a
per-feature deletion into a reference question — an artifact is
evictable-without-loss when no enabled feature declares a need for it, and
the storage surface can say exactly which features an eviction will
degrade. Two consumers that each embed their own idea of where an artifact
lives will disagree the first time one of them moves it; the store's
identity-to-path mapping is the one authority.

## Eviction: designed death, honest aftermath

Everything under the managed root names its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)). The
minimum viable reaper is **user-driven**: the storage surface lists
artifacts with size, consumers, and last use, and offers per-artifact
removal. Policy-driven eviction — superseded versions cleaned after an
upgrade proves out, artifacts unused past a threshold offered up — layers
on top where usage data exists, but the automatic reaper follows the rule:
**never silently evict what a click cannot restore.** Anything whose
removal costs a multi-gigabyte re-download is proposed, not taken; caches
that rebuild for free may be reaped freely.

Eviction's aftermath is where designs quietly rot, and the obligations are
exact:

- The bytes go — including any sidecar files, staged partials, and
  derived indexes that rode along with the artifact.
- The accounting updates — the inventory reflects the removal immediately.
- The capability verdict resets — the resolution cache and capability
  verdict for every dependent feature return honestly to *absent*, so the
  product degrades by design (capability-detection's ground) instead of
  crashing on a path that no longer exists.
- The reference map updates — the artifact's consumers now point at an
  absence they know about, with the acquisition affordance re-armed.

An eviction that deletes the file and nothing else has not removed the
artifact; it has planted a landmine at every place the artifact's path was
cached. The store's jurisdiction ends at the managed root: artifacts
resolved from operator overrides or system locations are inventory-visible
(the user should see the whole picture) but never eviction-eligible —
the application does not reap what it did not sow.
