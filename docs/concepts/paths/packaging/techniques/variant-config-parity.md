---
layer: technique
subject: packaging
technique: variant-config-parity
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Variant configuration parity

Products ship variants: a lean edition without the heavyweight optional
payloads, a full edition with them, per-platform builds with different
integration surfaces, tiered feature builds. Each variant needs its own
packaging configuration — and the moment there is more than one
configuration, there is a drift machine. This technique is the structure
that keeps N variants from becoming N independent products, plus the gate
that proves they haven't.

## The failure mode: divergence nobody chose

Variant drift has a signature that makes it uniquely durable: **every
drifted variant still works.** It builds, installs, launches, passes its
own tests. The divergence is not a defect in any single variant — it is a
difference *between* variants that no one decided: a permission granted in
one and not the others, a window property fixed in the base and forgotten
in an overlay, a security setting hardened on the flagship variant only.
Because nothing fails, the drift is discovered by a user of the neglected
variant, months later, as behavior "the app" doesn't have — on their copy
of it.

The mechanism is always the same: a change lands on the configuration the
developer runs daily, and the sibling configurations are edited from
memory, or not at all. Discipline does not fix a structure that requires N
edits for one decision; structure does.

## One base, minimal overlays

The standard shape is a **single base configuration** holding everything
the variants share, and per-variant **overlays** holding only the
differences — each difference present because someone chose it, each one
readable as the variant's definition. This is
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to packaging: every shared setting has exactly one authoritative
home, and a variant file that restates a base value has created the second
copy that will drift.

Two disciplines keep overlays honest:

- **Overlays are diffs, not forks.** An overlay states what the variant
  changes — payload set, product naming, feature gates, bundle format list
  — and nothing more. When an overlay grows to restate half the base, it
  has become a fork wearing an overlay's name, and merges from the base
  have silently stopped.
- **The difference list is the variant's specification.** "What is the
  lean edition?" should be answerable by reading its overlay in one
  sitting. If the answer requires diffing two full configurations, the
  structure has already failed.

Where the packaging toolchain natively supports layered configuration,
use it. Where it only accepts full files, the full files become **build
products** — generated from base + overlay — or, failing that, the gate
below becomes mandatory rather than advisable, because hand-maintained
full copies are the maximum-drift configuration.

## The drift gate

Structure prevents drift where the toolchain cooperates; the gate catches
it everywhere else. An automated check, run with the rest of the fast
gates on every change, that:

- parses every variant configuration and the base — parse failure is a
  loud failure, not a skip
  ([gate-sees-target](../../_laws.md#gate-sees-target): a gate that
  silently skips an unreadable file gates nothing);
- compares each variant against the base field by field;
- classifies every difference as **declared** (listed in the variant's
  allowed-divergence set — the machine-readable form of "someone chose
  this") or **undeclared** — and fails on undeclared, in either direction:
  a setting added to the base but missing from a variant is the same
  defect as a variant inventing its own.

The allowed-divergence set is the gate's most important property. A gate
that merely diffs and warns trains everyone to ignore it within a month;
a gate with an explicit allowlist converts every new divergence into a
reviewed decision — the change either updates the base (all variants) or
adds an allowlist entry (a chosen difference, on the record).

## Variants multiply the matrix

Every variant multiplies the acceptance surface: the matrix of
[os-arch-matrix](os-arch-matrix.md) gains a variant axis, and the
installed-tree contract of
[native-payload-verification](native-payload-verification.md) becomes
per-variant — the lean edition's acceptance asserts the heavyweight
payloads are *absent*, which is precisely the check that catches an
include-rule change that quietly un-leaned it. The budget question — "can
we afford to acceptance-test every variant?" — is the variant-count
question in disguise: a variant the team cannot afford to verify is a
variant the team cannot afford to ship.
