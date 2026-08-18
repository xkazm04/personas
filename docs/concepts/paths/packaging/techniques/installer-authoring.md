---
layer: technique
subject: packaging
technique: installer-authoring
status: forged
laws: [creation-names-reaper, identity-survives-reuse]
shared_with: []
---

# Installer authoring

The installer is a program that runs with elevated trust on a machine you
do not control, written in a niche scripting dialect, executed exactly once
per machine per version, and — by default — reviewed by nobody. This
technique inverts each of those defaults: installer customization is
**versioned source code**, diffed and reviewed like any privileged code,
exercised by automation on every change (the install rung of
[installed-tree-acceptance](installed-tree-acceptance.md)), and designed
around the full set of transitions rather than the happy path. The
installer's user-facing strings are part of the product's localization
surface — a product translated into a dozen languages whose installer
greets the user in one has drawn its quality boundary in the wrong place,
and where the installer toolkit lacks a locale, the missing locale files
are authored and versioned like any other source.

## Five transitions, one design

Fresh install is one transition of five. The others — upgrade, downgrade,
repair, uninstall — are distinct code paths with distinct failure modes,
and each is designed deliberately or inherited accidentally:

- **Fresh install** — the baseline: lay down the tree, register the
  integrations, record what was written.
- **Upgrade** — the common case after the first release, and the one the
  default tooling handles worst. The candidate installs *over* a running
  product: prior files to replace (some locked by a running instance),
  prior integrations to update, user data to leave strictly alone. The
  acceptance ladder runs this transition explicitly — previous released
  version first, candidate over it — because upgrade defects are invisible
  to fresh-install testing by construction.
- **Downgrade** — a support-driven reality. The design decision is
  explicit: either supported (older installer over newer tree, verified) or
  refused with a clear message — never undefined behavior that half-mixes
  two versions' trees.
- **Repair** — reinstalling the same version over a damaged tree. Cheap to
  support if uninstall/reinstall is data-safe; that safety is the point of
  the data rule below.
- **Uninstall** — the reaper, designed at creation time.

## Everything written names its remover

The installer's ledger discipline is
[creation-names-reaper](../../_laws.md#creation-names-reaper) made literal:
every entry the installer creates — files, directories, system-registry
entries, service and startup registrations, protocol and file-type
associations, menu and launcher entries — is enumerated, and the uninstall
path removes exactly that enumeration. Two consequences:

- **User data is not on the list.** Documents, databases, credentials,
  settings the user accumulated live outside the install tree (in the
  platform's per-user data locations) precisely so that uninstall can be
  total over its enumeration and still safe. An uninstaller that deletes
  user data converts "reinstall to fix it" from a support tool into a
  catastrophe; one that leaves orphaned system registrations converts every
  reinstall into an archaeology layer. The clean split — install tree fully
  removed, user data fully preserved, with an optional explicit
  "also remove my data" choice — is the only posture that supports both.
- **The enumeration is testable.** Uninstall acceptance walks the machine
  after removal: the enumerated entries are gone, the user-data locations
  are untouched. Without the enumeration there is nothing to test against.

## Identity survives the upgrade

The platform tracks installed products by identity — a product code, a
bundle identity, a package name. That identity must be **minted once and
carried across every version**
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): the
upgrade transition works *because* the platform recognizes the candidate as
a new version of the same product. Regenerating the identity per build —
a default some tooling happily provides — makes every upgrade a second
side-by-side install: two menu entries, two uninstall records, and a user
who cannot tell which is real. The identity, the install-scope decision,
and the upgrade policy are pinned in versioned configuration, not derived
per build.

## Per-user versus per-machine scope

The scope decision shapes everything downstream and is hard to change
after first release, because changing it strands the existing installs on
the other side:

- **Per-user**: no elevation prompt, installs into the user's own
  locations, invisible to other accounts, updatable by the application
  itself without privilege. The default for developer tools and
  frequently-updated applications.
- **Per-machine**: one copy for all accounts, requires elevation, the
  posture enterprise deployment expects, and the only honest choice when
  the product registers machine-wide services.

Choose once, deliberately, and encode the choice; an installer that decides
scope dynamically based on the invoking user's privileges produces a fleet
of machines in unknowable mixed states.

## Running instances and locked files

The upgrade path meets a running product. The designed order: detect the
running instance, request a graceful shutdown, wait bounded, then either
proceed or stop with an honest message — never silently overwrite what the
platform allows and skip what it locks, which produces the half-upgraded
tree, the worst state in the subject: version N's files loaded in memory,
version N+1's files on disk, and a crash signature that matches no version
anyone shipped.

## Unattended mode is a first-class interface

Every dialog in the interactive flow has a silent-mode answer — defaults,
flags, or a response file — because automation (the acceptance ladder) and
enterprise deployment both install without a human present. An installer
whose silent mode diverges from its interactive mode has two installers,
one of them untested; the acceptance ladder exercising silent mode on
every change is what keeps them one.
