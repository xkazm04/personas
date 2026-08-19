---
layer: technique
subject: packaging
technique: native-payload-verification
status: forged
laws: [gate-sees-target, one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Native payload verification

A modern desktop application is an executable plus a caravan: runtime
dynamic libraries, sidecar executables it spawns, inference models and data
files it loads, platform-specific support binaries. None of these are
compiled into the main binary, none are exercised by unit tests, and every
one of them is a **first-class install obligation** — the application
without them installs cleanly, launches, and fails at the exact moment the
user reaches the feature that needs them. This technique makes the caravan
explicit and checks it mechanically.

## The payload manifest

One declaration — versioned with the source, per operating system, per
architecture, per variant — lists every native payload the installed tree
must contain: its name, its location relative to the install root, which
matrix cells it belongs to, and which it must be *absent* from. This
manifest is the single authority on what the tree contains
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary));
the packaging configuration, the acceptance check, and the documentation
all derive from it rather than each keeping a private copy of the list.
When the lists live in two places, they drift the day someone adds a
payload and finds only one of them — and a drifted manifest converts the
verification gate into a check of last year's application.

Payloads earn a manifest entry at the moment they are introduced, as part
of the same change — the review question for any change that adds a native
dependency is "where is its manifest entry, and which cells is it scoped
to?"

## Presence: check where the loader looks

The verification walks the **installed tree** (after a real install — this
technique is a rung of
[installed-tree-acceptance](installed-tree-acceptance.md)) and asserts each
manifest entry exists at the location the runtime will actually resolve.
The distinction matters because dynamic-library resolution is a search, and
searches succeed misleadingly: on a developer machine the loader finds a
globally installed copy, a toolchain copy, a copy from another product —
and the missing bundled copy is invisible until a clean machine looks for
it. Presence in the *build output* is the proxy; presence in the installed
tree at the resolvable path is the target
([gate-sees-target](../../_laws.md#gate-sees-target)).

Presence alone is the floor. Per entry, the check escalates as value
warrants:

- **Machine type** for every native binary — a payload of the wrong
  architecture is worse than a missing one, because it fails later and
  stranger (see [os-arch-matrix](os-arch-matrix.md) on sniffing).
- **Size class** for large payloads — a truncated model file or a
  placeholder that shipped instead of the real artifact passes an
  existence check and fails at load time.
- **Content digest** where the payload is security-sensitive or
  bit-exactness matters — the strongest check, bought at the cost of
  updating the digest on every legitimate payload change.
- **Loadability** where cheap: actually opening the library or running the
  sidecar with a version flag proves the dependency chain of the payload
  itself, which presence cannot.

## The artifact declares its own requirements — read them

Some payload obligations are not constant: a native dependency may be
statically compiled into the executable in one build mode and dynamically
loaded in another, and both modes are legitimate. A fixed manifest entry
fails here in both directions — "the library must always be present"
false-fails every self-contained build, and "presence is optional" checks
nothing. The resolution is that **the shipped binary itself declares which
mode it was built in**: every executable format carries an import table, a
ground-truth record of what the linker actually bound. The check reads the
declaration out of the artifact and asserts conditionally — the payload
must be present *if and only if* the binary imports it. This upgrades the
manifest from a list of files to a list of *rules*, some unconditional,
some keyed to what the artifact says about itself — and it is
[gate-sees-target](../../_laws.md#gate-sees-target) once more: the build
configuration is the proxy for how the binary was linked; the binary is
the truth.

One honesty rule rides along: when the binary cannot be parsed, the check
falls back to the *conservative* posture (require presence) and says so —
an unreadable artifact must never resolve to the permissive branch,
because "could not verify" reported as "verified, nothing needed" is the
empty-success lie wearing a payload check's clothes.

## Absence: scoping is a shipped decision

The manifest's negative space is as binding as its positive space. A
payload scoped to the full variant must not appear in the lean variant; an
architecture-specific binary must not ship to the other architectures; a
development-only tool must not ship at all. Unscoped payloads are the
default outcome of every bundling system — glob-shaped include rules sweep
in whatever the build directory contains — so absence is asserted
explicitly, per cell, by the same walk that asserts presence.

The costs of failed scoping are real and compound: installer download size
(paid by every user on every update), disk footprint, signing surface
(every shipped binary is something the platform's trust machinery will
scan and something a security review must account for), and — most
corrosive — the loss of the manifest's authority, because a tree that
contains unexplained entries teaches everyone that the manifest is
advisory.

## Sidecars are payloads with a second life

A sidecar executable is verified here twice — present, correct machine
type, loadable — and then handed to
[subprocess-lifecycle](../../subprocess-lifecycle/subprocess-lifecycle.md)
for everything about its runtime: spawning, supervision, termination. The
packaging-side obligation that trips teams: the sidecar's *own* dynamic
dependencies are part of this manifest too. A sidecar that launches on the
build machine and dies on the user's machine for want of a runtime library
is the same defect as a missing payload, one process removed.
