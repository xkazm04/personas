---
layer: technique
subject: supply-chain
technique: archive-extraction-safety
status: forged
laws: [gate-sees-target, creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Archive extraction safety

An archive is a serialized filesystem authored by someone else. The
moment an application downloads and unpacks one — a model bundle, a
plugin, a tool release, a user import — it is executing filesystem
operations dictated by untrusted input: **entry names are
attacker-controlled paths, and declared sizes are attacker-controlled
claims.** Format libraries decode the container; they do not, in general,
defend the destination. Every extraction site owns its own defense, and
the defenses are short, mechanical, and endlessly forgotten.

## The traversal ("slip") class: entry names are paths from a stranger

An entry named with parent-directory steps, an absolute path, or a
platform-specific root (drive letters, UNC prefixes) resolves *outside*
the destination directory — and the extractor, running with the
application's privileges, writes wherever it lands: a startup script, a
shell profile, the application's own binaries. The containment check is
three lines and non-negotiable, applied to **every entry before any
bytes are written**:

1. Join the destination directory with the entry name.
2. Canonicalize the result — resolving `..`, symlinks, and platform
   quirks — because the check must see the path the write will actually
   use, not the string the archive supplied
   ([gate-sees-target](../../_laws.md#gate-sees-target)).
3. Verify the canonical path is strictly inside the canonical
   destination; refuse the entire archive otherwise — a hostile entry is
   evidence about the author, not a bad row to skip.

Symlink and hardlink entries deserve their own paranoia: an archive can
first extract a link pointing outside the destination, then extract a
file *through* the link. Either reject link entries outright (the common
right answer for artifact bundles) or re-canonicalize against the live
tree so the second write is caught by the same containment check.

## The bomb class: sizes are claims, not facts

Decompression ratios of tens of thousands to one fit in a tiny file; an
archive can also claim small sizes in its index and deliver unbounded
streams, or nest archives recursively. Budgets are therefore enforced on
**observed bytes during streaming**, never on declared metadata:

- a total-extracted-bytes budget for the whole archive,
- a per-entry byte budget,
- an entry-count budget,
- a nesting-depth limit if the pipeline unpacks archives found inside
  archives.

Exceeding any budget aborts the extraction and deletes the partial
output. Budgets are sized from the legitimate artifact's known scale
with an order-of-magnitude margin — a model bundle whose real size is
known to the manifest that named it has no business being a hundred
times larger.

## Verify before extract; quarantine before promote

Extraction is the *last* step of a safe acquisition pipeline, not the
first:

- **Digest verification precedes extraction.** The downloaded artifact
  is checked against the pinned digest from the manifest that named it —
  owned by
  [source-pinning](../../sidecar-provisioning/techniques/source-pinning.md)
  — so the extractor only ever runs over bytes something vouched for.
  Extract-then-verify is backwards: by verification time, hostile
  entries have already written.
- **Extract into quarantine, validate, then promote atomically.** The
  destination visible to the rest of the application is populated by a
  single atomic rename from a temporary directory, after the extracted
  tree passes shape validation (expected files present, nothing
  unexpected present). Consumers never observe a half-extracted or
  failed tree — the same discipline as
  [atomic-downloads](../../sidecar-provisioning/techniques/atomic-downloads.md),
  one layer up.
- **Assert the payload — a sentinel, not a shrug.** Selective
  extraction that finished without error and delivered *none of what
  the caller needed* is a failure wearing success's exit code
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
  a renamed top-level directory, a truncated download, or an upstream
  re-layout all produce an empty-but-clean extraction. Name the file
  the operation exists to obtain — the binary, the model, the manifest
  — and error when the extracted tree does not contain it. This one
  check converts three silent upstream drift modes into loud,
  immediate diagnoses.
- **The quarantine directory names its reaper**
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)):
  success promotes it, every failure path deletes it, and a
  startup-time sweep collects orphans from crashes — otherwise the
  temp area becomes a midden of half-extracted, possibly hostile trees.

## Inventory the extraction sites

The defended extraction path is worthless if it is one of several. Teams
reliably harden the prominent site — the downloader in the provisioning
module — while a build script, an import feature, or a test helper
unpacks with a bare library call or a shelled-out command. The
discipline is an inventory: enumerate every call site that unpacks
archive formats (the format libraries' entry points make this
mechanically greppable), route them through one shared, defended
extractor
([one-validation-door](../../_laws.md#one-validation-door) applied to
filesystem writes from untrusted input), and add a standing check that
flags new direct uses of the raw libraries. One door, enumerable
callers — the alternative is a defense that holds exactly until the
next convenient shortcut.
