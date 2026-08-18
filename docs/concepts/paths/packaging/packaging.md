---
layer: golden-path
subject: packaging
status: forged
techniques:
  - installed-tree-acceptance
  - os-arch-matrix
  - native-payload-verification
  - installer-authoring
  - variant-config-parity
  - signing-and-trust
evidence:
  - .github/workflows/installer-test.yml         # per-cell acceptance: x64+arm64 release-artifact install test (fail-fast off), macOS structural checks, Linux deb/AppImage install+launch smokes
  - scripts/test-installer.ps1                   # the ladder on the installed tree: silent install → file/size/payload/registry verification → health-check launch → silent uninstall
  - scripts/verify-onnxruntime-bundling.mjs      # linking-aware native-payload gate: reads the exe's import table (ground truth of what was linked) instead of assuming a fixed mode
  - scripts/ensure-ort-cache.mjs                 # the mislabeled-arch tarball fix: sniffs the cached lib's REAL machine type, swaps in a digest-verified official build; sentinel-idempotent
  - scripts/build/inspect-pe-imports.mjs         # binary-anatomy instrument: import table + embedded manifest, settled a months-old loader failure two written root causes had missed
  - scripts/check-tauri-configs.mjs              # variant drift gate: canonical + overlays, key allowlist ("Expand intentionally"), parse failure is loud, CSP check fails-not-skips
  - src-tauri/tauri.conf.json                    # the base configuration; lite/stable variants overlay only build.features + bundle.targets
  - src-tauri/nsis/languages/Czech.nsh           # installer customization as versioned code: hand-written installer locale files, reviewed like source
counter_evidence:
  - src-tauri/tauri.android.conf.json            # the variant OUTSIDE the drift gate: forks identity and security policy instead of overlaying, and no gate reads it
deviations:
  - w6-packaging   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Desktop packaging & installers

This is the subject you own when a desktop application ships to machines you
will never touch. Its jurisdiction begins where the build system declares
victory — a compiled application sitting in a build directory — and ends when
that application is **installed, complete, launchable, upgradeable, and
removable** on every operating system and processor architecture you claim to
support. The neighboring subject, release-pipeline, owns what happens *after*
this one succeeds: versioning the release, publishing the artifacts, feeding
the updater. The handoff is a set of signed installer artifacts that this
subject has already proven correct; packaging never publishes, and the
release pipeline never repairs a broken installer — by the time an artifact
reaches it, correctness is settled.

The subject exists because of one inversion that almost every team learns the
expensive way:

> **The build output is not the product. The installed tree is.**

Everything a developer tests day to day — the dev-mode process, the freshly
compiled binary in the build directory — runs in an environment the user will
never have: the toolchain's libraries on the search path, resources resolved
relative to the source checkout, an environment shaped by years of
development-machine accretion. The user gets what the *installer* lays down,
where the installer lays it down, with nothing else present. The gap between
those two worlds is where packaging defects live, and none of them are
visible from the build directory. A gate that certifies the build output is
certifying a proxy; the target is the installed tree, and the gate must see
it ([gate-sees-target](../_laws.md#gate-sees-target)).

Three facts make the subject harder than it looks:

1. **The matrix is real and every cell is independent.** Operating system ×
   processor architecture × build variant is not a formality — each cell has
   its own packaging format, its own native payloads, its own failure modes,
   and passing in one cell proves nothing about its neighbors. The cell you
   do not test is the cell that ships broken, and it will be the one with the
   fewest developers on it.
2. **Artifacts lie about themselves.** A downloaded dependency labeled for
   one architecture can contain binaries for another — mislabeled upstream
   archives are an observed failure class, not a hypothetical. Filenames,
   directory names, and metadata are claims; the bytes have a real machine
   type that can be read, and only the bytes are true.
3. **Install is a state machine, not a copy.** Fresh install, upgrade over an
   existing version, downgrade, repair, uninstall — each is a distinct
   transition with its own obligations to user data, running instances, and
   the machine's trust databases. A packaging design that only considers
   fresh install has designed one transition out of five.

## The installed tree is a contract

Treat the contents of the installed application as a **declared, versioned
contract**: the executable, every dynamic library it loads at runtime, every
sidecar binary it spawns, every model or data file it reads, every resource
the platform's conventions require. The contract is machine-checkable — a
manifest of expected entries per operating system, per architecture, per
variant — and the acceptance gate walks the *actual* installed tree against
it after a *real* installation, not after a build.

Two disciplines follow:

- **Presence is checked where the loader will look.** A library present in
  the build directory but absent from the installed tree produces an
  application that works on every developer machine and fails on every user
  machine — the single most common packaging defect, and structurally
  invisible to any test that runs before installation.
- **Absence is checked too.** Payloads scoped to one variant or one
  architecture must *not* appear in the others. Shipping an unneeded
  hundred-megabyte payload in every installer is not harmless generosity —
  it is download time, disk footprint, attack surface, and a signal that
  nobody knows what the tree contains.

The [installed-tree-acceptance](techniques/installed-tree-acceptance.md)
technique owns the full cycle — install, verify tree, launch, verify the
process actually came up — and the
[native-payload-verification](techniques/native-payload-verification.md)
technique owns the payload manifest and its scoping rules.

## The matrix is enumerated, not implied

Support claims are cheap to make and expensive to honor. The standard makes
the claim explicit: a **support matrix** — every operating-system family,
every processor architecture, every packaging format, every build variant you
ship — written down as an enumeration, with an automated acceptance job per
cell. A cell without a job is not supported; it is *hoped for*, and the
difference surfaces as a user-filed defect on hardware you never exercised.

The architecture axis carries a special discipline: **never trust a label
when you can read the bytes**. Cross-compilation, dependency caches, and
upstream archives all traffic in architecture *names*, and names drift from
contents. Executable formats on every platform carry their machine type in
the header; the gate reads it — from the cached dependency before linking,
from the packaged binary before shipping. The
[os-arch-matrix](techniques/os-arch-matrix.md) technique owns the matrix, the
cross-compilation traps, and the sniff-don't-trust rule.

## The installer is a program you wrote

Every non-trivial desktop application customizes its installer: services to
register, protocol handlers to claim, prior versions to migrate, running
instances to stop, machine-versus-user scope to choose. That customization is
**versioned source code** with everything the phrase implies — reviewed,
tested, owned — not a configuration blob regenerated by a wizard. The
installer runs with elevated trust on the user's machine; it is the most
privileged code you ship, reviewed the least by default. Invert that
default.

Uninstall is designed at the same moment as install
([creation-names-reaper](../_laws.md#creation-names-reaper)): every entry the
installer writes — files, registry-equivalents, service registrations, menu
entries — is enumerated with its removal path, and *user data is explicitly
not on that list*, so uninstall-and-reinstall is a safe repair action rather
than a data-loss event. The upgrade transition preserves application
identity so the platform sees a new version of one product, not a second
product ([identity-survives-reuse](../_laws.md#identity-survives-reuse));
what happens to the user's *data schema* across that upgrade is
[migrations](../migrations/migrations.md)' subject — the installer's
obligation ends at delivering the new binaries without destroying the old
data. The [installer-authoring](techniques/installer-authoring.md) technique
owns the transitions, the scope decision, and the customization discipline.

## Variants share one spine

Real products ship variants: a lean build without heavyweight optional
payloads, a full build with them, per-platform editions, staged feature
tiers. The wrong structure — one full configuration copied per variant —
converts every future configuration change into N edits, of which N−1 will
be forgotten. The standard is **one base configuration plus minimal
overlays** ([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)),
with an automated **drift gate** that fails when a variant diverges from the
base outside its declared overlay — because variant drift is silent by
nature: every variant still builds, still installs, and differs only in ways
nobody chose. The [variant-config-parity](techniques/variant-config-parity.md)
technique owns the overlay structure and the gate.

## Unsigned software is broken software

On every mainstream desktop platform, the operating system now stands
between your installer and the user: quarantine flags, reputation gates,
provenance checks. An unsigned or unnotarized artifact is not "the same
software with a scary dialog" — on some platforms it will not launch at all
without ritual incantations most users do not know, and on all of them the
warning converts a meaningful fraction of downloads into abandonment.
Signing is therefore a **packaging obligation**, in the acceptance path, not
a release-day errand: keys held with the care of production credentials, the
signature verified on the artifact the pipeline actually produced, and the
trust posture per platform written down — including the honest cost of any
cell you deliberately leave unsigned. The
[signing-and-trust](techniques/signing-and-trust.md) technique owns the
classes of trust, their failure modes, and the key-handling discipline.

## The artifact lifecycle

An installer artifact is always in exactly one of these states, and each
transition is owned by a named gate:

| State | Meaning | The gate that owns the transition out |
| --- | --- | --- |
| **built** | application compiled; build output exists | packaging job per matrix cell |
| **packaged** | installer artifact produced for one cell | architecture sniff + payload manifest check on the artifact |
| **installed** | artifact executed on a clean machine of that cell | installed-tree verification against the contract |
| **proven** | tree verified, application launched and answered | signing verification; hand-off to the release pipeline |
| **superseded** | a newer version installed over it | upgrade acceptance: identity preserved, user data intact |
| **removed** | uninstalled | uninstall acceptance: enumerated entries gone, user data untouched |

Two rules fall out of the table:

1. **No state is skippable.** The temptation is always to promote *packaged*
   straight to *proven* because the build was green and the last hundred
   installs worked. The states exist because each one has failed
   independently in the field; the cheap install-and-verify job is the price
   of knowing rather than hoping.
2. **"Proven" is per cell.** An artifact is proven for the operating system
   and architecture it was verified on, and nothing else. The claim "the
   release is tested" is a count without a predicate
   ([count-carries-predicate](../_laws.md#count-carries-predicate)) unless it
   names which cells ran the full ladder.

## The techniques

- [installed-tree-acceptance](techniques/installed-tree-acceptance.md) —
  install → verify tree → launch smoke, per matrix cell, in automation; the
  clean-machine requirement; what a launch smoke must actually assert.
- [os-arch-matrix](techniques/os-arch-matrix.md) — the enumerated support
  matrix, per-cell jobs, cross-compilation traps, and reading the machine
  type of every artifact you did not build yourself.
- [native-payload-verification](techniques/native-payload-verification.md) —
  the payload manifest: dynamic libraries, sidecars, and model files as
  first-class install obligations; presence *and* absence; scoping payloads
  to the variants that need them.
- [installer-authoring](techniques/installer-authoring.md) — installer
  customization as versioned code; fresh/upgrade/uninstall transitions;
  per-user versus per-machine scope; running-instance handling.
- [variant-config-parity](techniques/variant-config-parity.md) — base
  configuration plus overlays, and the automated drift gate between them.
- [signing-and-trust](techniques/signing-and-trust.md) — platform trust
  classes, what unsigned costs users, key custody, and verifying the
  signature on the shipped artifact.
