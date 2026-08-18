---
layer: golden-path
subject: release-pipeline
status: forged
techniques:
  - version-single-truth
  - changelog-generation
  - pipeline-staging
  - updater-chain
  - size-budgets
  - release-verification
evidence:
  - .github/workflows/release.yml              # ci-gate → version → frontend → build → updater-manifest; publish is opt-in (workflow_dispatch input, default false)
  - scripts/bump-version.mjs                   # one propagation tool: package.json + tauri.conf.json + Cargo.toml + Cargo.lock in one pass; refuses unparseable versions and missing lock entries
  - scripts/generate-changelog.mjs             # commit-convention derivation; INTERNAL_RE drops chore/ci/test/style/build from user-facing notes
  - scripts/bundle-baseline.json               # committed size baseline (chunks + total) read by the delta report
  - scripts/bundle-size-report.mjs             # delta-vs-baseline markdown report for change review
  - scripts/check-bundle-budget.mjs            # the failing budget gate; shares thresholds with the report via scripts/lib/bundle-budget.mjs (single source)
  - scripts/binary-size-report.mjs             # per-target installer/binary sizes with --budget fail mode
  - src-tauri/tauri.conf.json                  # updater endpoints + shipped public key; bundle.createUpdaterArtifacts (the unbrick fix)
  - docs/development/release.md                # dispatch runbook, pre-flight checklist, post-release verification
counter_evidence:
  - CHANGELOG.md                               # second, hand-maintained changelog the pipeline never writes or cuts — two authorities, one abandoned (11 tags, 3 covered)
deviations:
  - w6-release-pipeline   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - deferred-fix-62   # tag pushed before any artifact exists (11 tags / 0 releases) — golden-path-deferred-fixes.md §62
  - deferred-fix-63   # ci-gate validates one commit, pipeline builds another — golden-path-deferred-fixes.md §63
---

# Release pipeline

A release is a claim: *this exact code, at this exact version, is what users
receive from now on.* The release pipeline is the machinery that makes the
claim true — it turns a chosen commit into a versioned, described, verified,
distributable artifact set and places it where installed copies can find it.
The subject exists because every part of that sentence fails independently:
the version can lie, the description can be noise, the artifacts can disagree
with each other, and the distribution channel can silently deliver nothing.

Two properties separate releasing from every other pipeline in a project:

- **The failures are public.** A broken internal build wastes an afternoon; a
  broken release reaches machines the team cannot touch, under the project's
  name, at the moment of maximum attention.
- **There is no rollback, only forward.** A bad release cannot be un-shipped
  from machines that already installed it. The only repair is *another
  release, traveling through the same channel* — which is why the channel
  itself (the [updater-chain](techniques/updater-chain.md)) is part of the
  release, not an accessory to it. Like a schema migration, a published
  release is a one-way door; unlike a migration, the door is on someone
  else's machine.

There is a third property, quieter and more corrosive: **the release
pipeline is the one pipeline whose failures nobody notices.** A red unit
test annoys a developer within the hour; a red release run annoys nobody,
because the only person who would notice is the person trying to ship, and
most days nobody is. A release pipeline can fail every single run for
months while the project looks perfectly healthy from inside — worse, its
partial side effects (a version number recorded here, a tag pushed there)
keep arriving on schedule, so the pipeline *looks* like it is working. Two
countermeasures, both mandatory: rehearse the pipeline routinely in its
non-publishing mode so its health is measured between releases, not
discovered on release day; and treat the pipeline's own run history as a
monitored signal — consecutive failures of the release workflow are an
incident even when nobody was shipping.

Everything below is written for the harder case — shipping to end-user
machines that update themselves unattended. Server deployment is the same
doctrine with an escape hatch (you can reach the machines); losing the escape
hatch is what promotes each rule from advice to law.

## The version is one fact, held in one place

A version is a single fact about the release, yet a real project records it
in half a dozen manifests: the package descriptor, the native build
manifest, the dependency lock, the installer metadata, the update feed, the
running application's own about-panel. The moment two of those are edited by
hand, they are two authorities, and they will disagree exactly when it
matters — at release time, under deadline, when someone bumps the obvious
file and not the derived ones.

The standard is mechanical: **one source of truth, one propagation tool, one
drift gate.** A human states the new version once; a tool writes every
manifest that records it — *including derived manifests like dependency
locks, the file everyone forgets because no one edits it directly*; and a
gate fails the pipeline if any two recorded versions disagree. Hand-editing
version fields is banned by the gate, not by discipline. The full contract
is [version-single-truth](techniques/version-single-truth.md).

## The pipeline is ordered gates, and publishing is opt-in

A release pipeline is a sequence of stages with a strict ordering law:
**cheap verdicts before expensive work, and irreversible work last.**

1. **Validation** — the project's own quality gates (types, lints, tests,
   version-drift, changelog shape). Everything that can prove the release
   wrong for free runs before anything is built.
2. **Version and description** — stamp the version, cut the changelog. These
   are cheap, deterministic, and produce the identity the artifacts will
   carry. Stamping is local and reversible; **publishing the version claim
   (the pushed tag, the recorded release) is not, and belongs in the publish
   stage** — a pipeline that pushes its tag before the builds succeed
   accumulates version numbers with nothing behind them, each one a
   permanent public promise the fleet's update checks will poll against
   forever.
3. **Build** — the expensive middle: compile, bundle, package for every
   target. Nothing here should be able to *decide* anything; all decisions
   were made upstream.
4. **Publish** — upload artifacts, update the feed installed copies poll.
   This is the one-way door, and it is **an explicit opt-in, never a side
   effect**. The default run of the pipeline produces everything and ships
   nothing; a human (or an explicitly armed automation) turns the key.

The ordering is not aesthetic. Every stage boundary is a **resumption
point**: when the build succeeds and the upload fails, the fix is to re-run
publishing, not to rebuild the world — which requires stages to communicate
through durable artifacts, not shared memory. And every stage must read the
same input: the pipeline pins the exact commit at the start, or a push that
lands mid-run splits the release across two states of the code. Stage
design, re-run semantics, and the failure modes between stamp and publish
are [pipeline-staging](techniques/pipeline-staging.md).

## The changelog is generated, filtered, and owed to strangers

The release description is not a formality; it is the only part of the
release most users ever read. Writing it by hand at release time produces
the worst of both worlds — incomplete (memory-based) and late (deadline-
based). The standard is **derivation**: commit history, written under a
convention that marks each change's kind and audience, is compiled into the
changelog by a tool. Internal noise — refactors, test churn, build
plumbing — is excluded *by rule*, not by editorial courage at midnight.
A generated changelog is a derived value, and it obeys the derived-value
law: the tool that recomputes it is named, and hand-edits go into the
sources it reads, never into its output. The convention, the filter, and
the empty-changelog signal are
[changelog-generation](techniques/changelog-generation.md).

## A release users cannot receive is not a release

Producing artifacts is the middle of the job. Installed copies discover
releases through an **update feed** — a small manifest the application
polls, naming the newest version, where its payload lives, and a signature
proving it came from the project. That feed is the release's last mile and
its most dangerous component, because of a failure class unique to it:

**The updater is the one component whose defects seal themselves in.** Ship
a broken parser in version N, and version N+1 — containing the fix — must
travel through the broken parser. Every other bug can be fixed by the next
release; a bug in the machinery of *receiving* releases severs the channel,
and the remedy degrades to "ask every user to reinstall by hand", which for
an end-user product means losing most of them. The updater path therefore
gets the most conservative change policy in the codebase and its own
rehearsal: every candidate release is applied *as an update from the
previous shipped version* before the feed advances. Feed generation,
signing, the key-loss disaster, and staged rollout are
[updater-chain](techniques/updater-chain.md).

## Size is a budget, not an observation

Artifact size regresses by default — every dependency added, every asset
committed, every debug symbol left in is a silent size increase that no test
fails on. Left unmeasured, size is discovered by users, as download time and
disk cost. The standard treats size as a **budgeted, ratcheted dimension**:
a committed baseline records what each artifact weighed at last acceptance;
every change is reported as a delta against that baseline where the author
can see it; crossing the budget fails, approaching it advises; and when size
*drops*, the baseline is lowered so the win cannot silently erode back.
Budgets are per-artifact and per-target — one global number hides a
regression in the smallest target behind a win in the largest. The
measurement rules and the ratchet are
[size-budgets](techniques/size-budgets.md).

## Prove the release, not the code

Everything the test suite proved, it proved about *the code*. The release is
a different object — an assembled, packaged, stamped, compressed thing — and
it fails in ways no unit test can see: the artifact that does not launch,
the about-panel that reports the previous version, the update that installs
and then cannot receive its own successor. Release verification checks the
assembled thing: install it, launch it, ask it its version, update *into* it
from the previous release, and only then arm the publish gate. What can be
proven on the artifact belongs here; what requires the installed tree on
each real target platform belongs to the packaging discipline (a sibling
subject, owning multi-platform installers and installed-tree acceptance).
The checklist and its ordering are
[release-verification](techniques/release-verification.md).

## The techniques

- [version-single-truth](techniques/version-single-truth.md) — one source,
  mechanical propagation to every manifest including locks, the drift gate.
- [changelog-generation](techniques/changelog-generation.md) — commit
  conventions as data, audience filtering by rule, the unreleased ledger,
  regeneration discipline.
- [pipeline-staging](techniques/pipeline-staging.md) — gate ordering, pinned
  inputs, durable stage hand-offs, opt-in publishing, partial-failure
  recovery.
- [updater-chain](techniques/updater-chain.md) — feed generation from real
  artifacts, signing and key custody, the self-sealing-defect class, staged
  rollout.
- [size-budgets](techniques/size-budgets.md) — committed baselines, delta
  reporting, fail vs advise, per-target budgets, the ratchet.
- [release-verification](techniques/release-verification.md) — proving the
  assembled artifact before the one-way door, including the update-path
  rehearsal.
