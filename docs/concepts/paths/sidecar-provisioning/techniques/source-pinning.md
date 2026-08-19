---
layer: technique
subject: sidecar-provisioning
technique: source-pinning
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, count-carries-predicate]
shared_with: []
---

# Source pinning

Every provisioned artifact is a set of bytes the application will execute
or load, built by someone else, fetched from infrastructure someone else
operates. This technique is the supply-chain discipline for that fact: the
application downloads only what a **curated catalog** names, only from
**pinned sources**, and trusts nothing until the **content** — not the
label, not the transfer status — has been verified.

## The curated catalog

What may be downloaded is a closed, versioned list shipped with the
application: for each artifact, its identity, its human-facing description
and size (the user deciding whether to spend two gigabytes deserves to know
it is two gigabytes), the exact source location per platform and
architecture, and the expected verification facts — digest where the
publisher provides one, size class and format signature always.
Per-architecture entries are selected by the **build's own compiled target
identity**, never by asking the ambient environment — under emulation the
shell's architecture claims describe the emulator, not the machine, and a
catalog keyed to them fetches the wrong artifact on exactly the machines
where the difference matters. The catalog is the single authority
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
the download door, the storage accounting, and the selection interface all
derive from it. No code path constructs a download location from user
input, model names, or string concatenation — an application that fetches
"whatever the caller asked for" has shipped a remote-code-execution
primitive with a progress bar.

The catalog guards **every** operation that takes an artifact identity,
not just the download: deletion, path computation, and status queries all
reject identities the catalog does not name. The payoff is quiet but real —
an identity that becomes part of a filesystem path is a traversal vector,
and validating it against the closed catalog at every door is cheaper and
stronger than sanitizing strings at each one.

Pinning the source means naming specific hosts — and treating a change of
host as a *reviewed catalog change*, not a runtime fallback. Mirror
fallbacks are legitimate only when every mirror is itself in the catalog
and the verification facts are identical across them.

One door hides in plain sight: **libraries that provision themselves.** A
dependency that quietly downloads its own model on first use is a second
acquisition channel with none of the application's machinery — no catalog
entry, no progress, no cancellation, no verification the application can
see, and a failure mode the application cannot distinguish from its own.
Inventory these when adopting the dependency, and either route them
through the managed door (most such libraries accept a pre-populated
cache location) or list them explicitly as accepted exceptions with their
own trust story — an unlisted self-provisioner is a supply-chain door
nobody guards ([one-validation-door](../../_laws.md#one-validation-door)
applied to acquisition).

## Verify content, not labels

The transfer completing proves only that bytes arrived. Between the catalog
and the published artifact stands a verification ladder, run against the
staged copy before the atomic rename publishes it (atomic-downloads owns
the sequencing):

- **Digest**, when the catalog carries one — the strongest check; it makes
  the downloaded bytes equal to the bytes the catalog author reviewed.
- **Size class** — a floor and ceiling. It catches truncation, error pages
  saved as artifacts, and placeholder files, at zero maintenance cost.
- **Format signature** — the first bytes of every serious artifact format
  announce what it is. An archive that opens with an HTML error page, a
  model file that opens with a redirect notice: one read catches both.
- **Architecture sniff**, for anything executable or linkable — read the
  machine type out of the artifact's own header and compare it to what this
  machine needs.

The last rung earns its place through the most instructive failure in this
family: the **mislabeled artifact**. A publisher ships a package whose
filename and metadata declare one architecture while the binary inside is
another — a packaging mistake upstream, invisible to every label-level
check, producing link or load errors on the victim machine that point
nowhere near the cause. Names are claims; headers are facts
([gate-sees-target](../../_laws.md#gate-sees-target) — the label is a proxy,
the bytes are the target). [packaging](../../packaging/packaging.md)
applies the same sniff to payloads at build time
([os-arch-matrix](../../packaging/techniques/os-arch-matrix.md)); this
technique applies it to payloads that arrive on the user's machine, where
there is no build engineer watching.

## Failure routing

Each verification rung failing means something different, and the
distinction routes the response: a digest mismatch on a pinned source is a
security-relevant event worth surfacing loudly, not retrying quietly; a
size-class failure usually means a broken transfer or an intercepting
network and is worth one clean restart; an architecture mismatch is an
upstream defect that no retry will fix and needs a different artifact or a
repair path. Collapsing these into "download failed (retry?)" discards
exactly the information the responder needs
([count-carries-predicate](../../_laws.md#count-carries-predicate) in its
qualitative form — a failure without its predicate cannot be acted on). A
failed artifact is quarantined, never published; whether the staged bytes
are kept for diagnosis or deleted immediately is a stated policy either way.

## Updating pinned artifacts

Pinning trades freshness for trust, and the trade must be managed, not
suffered. New artifact versions enter by updating the catalog — new source,
new digest, new size — through the same review that guards code. The
catalog entry carries its version so that storage accounting can tell "the
current model" from "the superseded one" (model-storage-lifecycle owns what
happens to the superseded copy). What is *never* acceptable is the
convenience escape hatch: a debug flag or config knob that skips
verification "temporarily". A verification door with a documented bypass is
a door in the open position; the honest escape hatch is the resolution
ladder's override rung, which lets an operator point at their own artifact
*explicitly, visibly, and on their own authority* — outside the catalog's
warranty rather than silently inside it.
