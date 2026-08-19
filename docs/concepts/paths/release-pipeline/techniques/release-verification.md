---
layer: technique
subject: release-pipeline
technique: release-verification
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Release verification

Everything the quality suite proved, it proved about the code — usually in
a development-shaped build, on the automation host, against test doubles.
The release is a different object: assembled, optimized, stripped, signed,
compressed, stamped. It fails in ways no unit test can express, because the
failures live in the assembly, not the logic: the optimizer eliminated
something the debug build kept; the packager missed a runtime file; the
stamp step defaulted; the artifact for one target never got built at all.
Release verification is the gate that observes **the artifact set itself**
before the one-way publish door
([gate-sees-target](../../_laws.md#gate-sees-target)) — green builds and
green tests are proxies; the artifacts are the target.

## The ladder, cheapest first

Each rung is worthless without the ones below it, and each catches a class
the previous rung cannot see:

1. **Existence and completeness.** Enumerate what a release must contain —
   every target, every artifact kind, feed manifest, signatures — and
   assert every item is present with a plausible size. This rung exists
   because of the skipped-matrix-job failure: all jobs that ran are green,
   and one platform's artifact simply does not exist. Checking "no job
   failed" cannot catch it; only enumeration can
   ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
2. **Internal consistency.** Every artifact carries the minted version —
   in its filename, its embedded metadata, and its self-report. Checksums
   in the feed match the payloads byte-for-byte. Signatures verify with
   the *shipped* public key, not the key that happens to be in the build
   environment. This rung catches the split release: artifacts from two
   different runs, a stale cache, a feed built from intent.
3. **The artifact runs.** Install the real artifact on a clean machine
   image, launch it, and interrogate it: it starts, reports the minted
   version, and passes a smoke pass over its core surface. "Clean" is
   load-bearing — a developer machine satisfies missing dependencies
   silently, which is exactly the defect class this rung exists to catch.
4. **The update path works.** Install the *previous shipped release*,
   point it at the candidate feed, and watch the full chain: discover,
   download, verify, apply, relaunch, report the new version — and
   confirm the updated copy can still poll the feed, so it can receive
   the *next* release. This is the rehearsal the updater chain demands;
   it is the only rung that proves users will actually receive what the
   other three rungs proved good.

Rungs 1–2 are cheap, scriptable, and belong in every run of the pipeline as
the pre-publish assertion. Rungs 3–4 need real or virtualized target
machines; run them on every release candidate, automated as far as the
platform allows and as a written manual checklist where it does not — an
honest manual checklist beats an automated check that only pretends to
cover the rung.

## What this technique does not own

The full per-platform installed-tree acceptance — installer conventions on
each operating system, file placement, uninstall behavior, permissions,
platform store requirements — belongs to the packaging discipline (a
sibling subject; its acceptance suite is rung 3 taken to full depth per
platform). Release verification asserts the *pipeline's* promises: the set
is complete, consistent, launchable, and updatable. Packaging asserts the
*platform's* expectations. The seam matters because the two run at
different cadences: packaging acceptance changes when installers change;
release verification runs on every single release.

## Verification is a stage, not a virtue

The rungs only protect anything if they are wired **between build and
publish** as a stage whose failure stops the run — verification that runs
after publishing is a postmortem generator, and verification that can be
skipped under deadline pressure ("just this once, the change was tiny")
will be, on exactly the release that needed it. The publish stage should
be structurally unable to proceed without the verification stage's
recorded verdict on the same pinned artifacts — the verdict travels as a
durable artifact keyed to the artifact checksums it vouches for, so a
re-run cannot pair an old verdict with new bytes.
