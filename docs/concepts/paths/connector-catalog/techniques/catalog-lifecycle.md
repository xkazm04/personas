---
layer: technique
subject: connector-catalog
technique: catalog-lifecycle
status: forged
laws: [creation-names-reaper, deletion-is-not-repair]
shared_with: []
---

# Catalog lifecycle

A catalog entry is born the day a service is added and — this is the part
that gets skipped — must be able to evolve, merge, and die while credential
instances, automations, and audit history hold references to it. A catalog
designed only for growth becomes a graveyard with a search box: entries for
providers that shut down years ago sit beside supported ones,
indistinguishable, still offering credential forms that can no longer
succeed. The technique is the set of transitions and the bookkeeping each
one requires.

## Version the shipped catalog as a whole and per entry

Two version stamps, two jobs:

- **Per entry**: a revision (or content hash) that changes when the entry's
  definition changes. This is what the
  [refresh gate](shipped-vs-operator-ownership.md) compares to decide
  whether an installed row needs updating — without it, every boot either
  rewrites everything or nothing.
- **Per catalog**: a monotonic version for the shipped set as a whole, so
  an install can know "I last reconciled against catalog v41" and reconcile
  *transitions* (what appeared, changed, disappeared between v41 and v45)
  rather than re-deriving the world from scratch each boot.

An entry's history should be reconstructible — when it entered the shipped
set, which revisions it passed through, when it left. This is the
provenance that turns "why does this install have a row the catalog lacks?"
from an investigation into a lookup.

## Retirement: the set difference nobody computes

Adding entries is self-executing: new in the shipped set → seeded on next
refresh. Retirement is not: an entry *removed* from the shipped set simply
stops being mentioned, and the installed row it seeded lives on in every
existing install, forever, unless something **computes the set difference**
between installed vendor-owned rows and the current shipped set. Most
seeders never do — the measured in-repo state of this subject includes
shipped-row populations whose only retirements ever executed were
hand-written per-identity deletions, with no mechanism to notice the next
orphan; in the same system, exactly one seeder of seven gated its refresh
on a revision stamp, which is the adjacent lesson: the correct pattern can
exist in-house for months and never propagate, because nothing names it as
the pattern. The entry was created by a systematic mechanism; its reaping must be
equally systematic ([creation-names-reaper](../../_laws.md#creation-names-reaper)
— the seeder is the creator, so the seeder's counterpart owns the funeral).

Retirement is staged, because dependents exist:

1. **Deprecated** — the entry remains functional but stops being offered:
   hidden from discovery and pickers, banner on existing uses, replacement
   named if one exists. New adoption ends now; existing users get runway.
2. **Retired** — the row becomes a **tombstone**: identity, label, and
   provenance survive; auth schema, probe, and capabilities are inert. The
   tombstone is load-bearing, not sentimental — audit history and old
   automations still resolve the identity to a name and a "retired on"
   fact instead of a dangling key.
3. **Dependents are walked, never orphaned silently.** Credential instances
   of a retiring type get an operator-facing disposition (export, revoke,
   delete); automations referencing it are flagged where their owners will
   see it. Deleting the row out from under them converts a visible
   deprecation into scattered runtime failures
   ([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) — the
   references were the defect's surface; removing the row removes the
   surface, not the defect).

## Dedupe is aliasing, never overwrite

Sooner or later two entries turn out to be one service — added under a
rebrand and its old name, or hand-created by an operator before the vendor
shipped the official row. Merging has one correct shape: pick the survivor,
convert the duplicate's identity into an **alias** of the survivor, and
migrate dependents (credentials, automation references, audit lines) to the
survivor's identity — or leave them in place and let every resolver follow
the alias, which is safer when history must stay bit-identical. The alias
is permanent: it is the guarantee that the duplicate's identity never
dangles and can never be re-minted for an unrelated service — re-minting a
retired identity means old audit lines silently change referent, the
worst-case identity failure. The [matcher](matching-and-ranking.md) consumes
the same alias table in the other direction, which is why dedupe done right
also improves future import resolution for free.

## Operator rows ride the same lifecycle

Operator-created entries (custom connectors for internal services) get the
same affordances — deprecation, tombstoning, aliasing onto a shipped row
when the vendor catches up — because from a dependent's point of view there
is no difference: a credential referencing a vanished custom row dangles
exactly like one referencing a vanished shipped row. The ownership split
governs who may *trigger* transitions; the transitions themselves are
uniform. The alias-onto-shipped case is worth designing deliberately: it is
the happiest lifecycle event a catalog has ("the product now officially
supports what you hand-built"), and handled without it, the operator faces
a manual re-entry of every credential — punished for having been early.
