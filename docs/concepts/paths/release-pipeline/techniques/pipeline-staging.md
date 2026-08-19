---
layer: technique
subject: release-pipeline
technique: pipeline-staging
status: forged
laws: [gate-sees-target, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Pipeline staging

A release pipeline is a sequence of stages separated by hard boundaries. The
stage structure is not bureaucracy — it encodes three laws at once: *cheap
verdicts before expensive work*, *irreversible work last*, and *every
boundary is a place to resume from*. A pipeline without real boundaries is a
script; scripts re-run from the top, and re-running the top of a release
means rebuilding the world to retry an upload.

## The canonical ordering

1. **Gate** — every check that can prove the release wrong without building
   it: the full quality suite, version-drift, changelog shape, budget
   pre-checks. This stage exists to make failure cheap; anything that fails
   here costs minutes, not hours, and touches nothing.
2. **Version** — stamp the new version through the single-truth tool, cut
   the changelog. Cheap, deterministic, and it *mints the release's
   identity*: everything downstream carries this version or is wrong.

   Minting has two halves with opposite risk profiles, and conflating them
   is the costliest ordering mistake this subject produces. *Stamping* —
   writing the version into the working tree so builds can embed it — is
   local and reversible, and often **must** precede the build, because
   artifacts embed the version in their metadata and filenames. *Claiming*
   — committing the bump, pushing the tag, recording the release — is a
   permanent public act, and it belongs after the builds succeed, in the
   publish stage. A pipeline that pushes its tag here, before the expensive
   middle, converts every downstream build failure into a version number
   that exists in public with nothing behind it; a fleet polling "latest"
   then compares itself against releases that were never born. The tag is
   an output of a successful build, never an input to one.
3. **Build** — the expensive middle: compile, bundle, package, per target,
   usually in parallel. Build stages should be pure functions of their
   pinned input — no decisions, no network reads that can change the
   answer, no "while we're here" mutations.
4. **Publish** — upload artifacts, advance the update feed. The one-way
   door.

The ordering rule generalizes: **a stage may only be more expensive or more
irreversible than the one before it.** Any check discovered late (a budget
verdict that needs the built artifact, a signature verification) runs at
the earliest stage that can compute it — after build, but always before
publish.

## Publishing is armed, never tripped

The default run of the pipeline — triggered by a push, a schedule, a
curious re-run — must produce every artifact and publish none of them.
Publication is a separate decision, expressed as an explicit input to the
run (a flag, a manually-triggered final stage, a promotion of an existing
run), ideally by a differently-privileged identity. Two reasons, either
sufficient:

- **Rehearsal must be free.** If publishing is a side effect of building,
  the team cannot exercise the pipeline without shipping, so the pipeline
  is only ever tested in production, on release day, under deadline.
- **The blast radius of a mistake collapses.** A mis-trigger, a bad branch
  filter, a re-run of an old workflow — with opt-in publishing these
  produce artifacts nobody sees instead of a version the fleet installs.

The same asymmetry applies within publishing: uploading artifacts to
storage is *staging*; advancing the feed that installed copies poll is
*shipping*. Keep them separate, in that order — artifacts fully uploaded
and verified before any pointer names them — so the feed never references
a payload that is still uploading or failed halfway.

## Pin the input, carry the identity

Every stage must operate on the same code. A pipeline whose stages each
resolve "the latest commit on the release branch" independently is racing
its own contributors: a push that lands mid-run splits the release across
two states of the tree, and no stage can detect it. The pipeline resolves
the exact revision once, at the top, and every stage receives that pin —
never the branch name
([identity-survives-reuse](../../_laws.md#identity-survives-reuse): the
release's identity is the revision, and it must survive the hours the run
takes and any re-run of any stage).

Stages hand work forward through **durable artifacts** — built payloads,
manifests, verdicts persisted where a later stage (or a later re-run) can
retrieve them. This is what makes the boundaries real resumption points:
when the build succeeded and publishing failed, recovery is "re-run
publish against the stored artifacts", not "rebuild and hope the second
build is bit-identical" (it rarely is, and a feed that names a payload
from build A with a checksum from build B has shipped a corruption
report to every client).

## Partial failure and the re-run contract

Design every stage to be **re-runnable against the same pinned input**, and
classify each step by what re-running does:

- *Idempotent* (builds from pinned input, manifest generation): re-run
  freely.
- *Guarded* (create the tag, create the release record, upload an
  artifact): the step checks for its own prior success and treats
  already-done as success — but verifies the existing state matches its
  intent before saying so (the half-uploaded artifact must be re-uploaded,
  not skipped).
- *Forbidden to repeat* (advancing the feed to a version that is already
  superseded): the step refuses, loudly.

The most dangerous window is **between minting identity and completing
publish**: the version is stamped, perhaps tagged, and the run dies. The
recovery must be a documented path, decided before it is needed — resume
the same version's run to completion, or abandon the version number
entirely and mint the next one. Both work; improvising between them at
midnight produces the third option, a version number that half-exists.

## A gate must be able to pass

The gate stage often includes a conjunction with an external condition —
"the main quality workflow concluded green for this commit", "the security
scan passed this week". Before wiring any such conjunct into the publish
path, **measure its historical pass rate**; it is one query. A gate
conjoined with a condition that has never once been true is not rigor — it
is an off switch nobody remembers installing, and it fails in the worst
possible way: silently, plausibly, and only on the day someone finally
tries to ship. The same discipline applies over time: a release pipeline
that only runs on release day is a pipeline whose gates, permissions, and
integrations are tested exclusively in production. Run the non-publishing
mode routinely — every merge, or on a schedule — so the answer to "does the
release pipeline still work?" is a measurement, not a hope. Two related
checks belong in that rehearsal: the pipeline's own recent run history
(consecutive failures are an incident even when nobody was shipping), and
the reachability of every publish-path conjunct.

## Failure must be louder than absence

A pipeline stage that fails must be distinguishable from a stage that ran
and did nothing ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The classic silent hole: a matrix build where one target's job is skipped
by a filter typo — every job that ran is green, the release ships, and one
platform's artifact simply does not exist. The publish stage therefore
asserts its inputs by enumeration: *these are the artifacts a release must
contain; all are present, all carry the minted version, all checksums
verify* — before anything is uploaded. The gate reads the actual artifact
set, not the job statuses
([gate-sees-target](../../_laws.md#gate-sees-target)): green jobs are a
proxy; the artifacts are the target.
