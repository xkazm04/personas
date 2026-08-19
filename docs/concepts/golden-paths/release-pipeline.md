# Golden path — Release pipeline

> Situation node: `platform-delivery/packaging-and-release/release-pipeline` ·
> [situation spine](../situation-spine.md)
> `sides: server` · `twoSided: false` · recurrence **4** · risk **HIGH** ·
> spine label `convergence: converged`.
> Dimensions: **resilience · function**.
> Spine's own framing: *"Version files, tag, changelog and four platform builds in one ordered cut."*
>
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Sweep size.** All 7 GitHub workflows (1,562 lines, every one read in full); the four
> `tauri.*.conf.json`; `package.json`'s 84 scripts, expanded programmatically through the
> `npm run` chain; `scripts/run-codegen.mjs` and the 15 generators it registers;
> `scripts/bump-version.mjs`, `generate-changelog.mjs`, `check-tiers.mjs`,
> `check-tauri-configs.mjs`, `ensure-ort-cache.mjs`, `verify-onnxruntime-bundling.mjs`,
> `sync-system-skills.mjs`, `test-installer.ps1`; `lefthook.yml`; `CHANGELOG.md`; the five
> workspace `Cargo.toml` files; `src-tauri/src/main.rs`. Plus **the GitHub Actions API,
> all-time, for all seven workflows**, and the repository's tag and release lists.
>
> **`cargo` was NOT run and no build of any kind was started.** The operator uses this app
> daily and the composer had no toolchain. That constraint turned out to be the leaf's
> method rather than its limit: *the gap between what the scripts declare and what CI
> actually runs is measurable without building anything*, and every finding below lives in
> that gap.
>
> The **Deviations** section is a fix backlog. **Nothing in it was applied.** Two items are
> filed in [`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md).

---

## §0 — The headline: the publish path is gated on a condition that has never once been true

`release.yml:43-70` declares a job called `ci-gate`. When `publish` is on it asks the
Actions API what `ci.yml` concluded for the commit being released, and refuses unless the
answer is `success`:

```yaml
if [ "$CONCLUSION" != "success" ]; then
  echo "::error::Refusing to PUBLISH from a commit whose CI conclusion is '$CONCLUSION'."
  exit 1
fi
```

Queried from the Actions API on **2026-08-17**, all-time, by workflow:

| workflow | runs | success | failure | cancelled | other |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ci.yml` | **324** | **0** | 191 | 132 | 1 in progress |
| `release.yml` | **30** | **0** | 30 | 0 | — |
| `e2e-smoke.yml` | 38 | **0** | 34 | 4 | — |
| `installer-test.yml` | 8 | 0 | 0 | 0 | **8 skipped** |

**`ci.yml` has concluded `success` zero times in 324 runs.** So `ci-gate` cannot pass for
any commit in this repository's history, and `publish: true` — the only mode that produces
a GitHub Release, an updater manifest, or a signed installer a user can install — is
unreachable by construction. Not "flaky". Not "usually red". **Never once green, and the
publish path is defined as the conjunction with it.**

The rest of the picture is consistent with that, and each half is worth stating on its own:

**Eleven tags. Zero releases.** `git tag` returns 11 (`v0.1.1` … `v1.1.0`, including the
fossil `v0.1.NaN.1`). `GET /repos/:owner/personas/releases` returns an array of length
**0**. The tag `v1.1.0` names a commit for which no artifact has ever existed.
`release.yml`'s own header comment says *"auto-tagging on every run left 5 tags on origin
with zero releases behind them"* — measured today it is **11 tags with zero releases**, so
the file's self-assessment is stale by 6.

**The cut lands before anything is built, and the builds are what fail.** Per-job outcomes
of the most recent `release.yml` run (`2026-07-16T20:40:49Z`, the run that produced tag
`v1.1.0`):

| job | conclusion |
| --- | --- |
| `bump-version` | **success** — version files written, committed, tagged, `git push origin master --tags` |
| `frontend` | **success** |
| `build (windows-x64)` | **failure** |
| `build (windows-arm64)` | **failure** |
| `build (linux-x64)` | **failure** |
| `build (macos-universal)` | **failure** |
| `updater-manifest` | skipped |

The version bump reached `master` and the tag reached `origin`; **four of four platform
builds failed and no installer was produced.** Eight of the eleven tags were authored by
`github-actions[bot]` under the message `chore: bump version to <x>`, so this is the
pipeline's normal behaviour, not one bad day.

**And the workflow that would prevent a repeat has itself never run.** That 2026-07-16 run
declares the jobs `{bump-version, frontend, build, updater-manifest}`. The file on `master`
today declares `{ci-gate, version, frontend, build, updater-manifest}` — the `ci-gate` job,
the `publish` opt-in, the build-validation mode, the installer artifact upload, the ONNX
bundling verification and the binary-size report **all postdate the last execution**. Two
commits have touched `release.yml` since. Every safety property in §0's opening paragraph
is text that has never been executed.

> The generalizable form, and it is the thing to carry out of this leaf:
> **a release pipeline is the one pipeline whose own failures are invisible to the people
> it protects.** A red unit test annoys a developer within the hour. A red release workflow
> annoys nobody, because the only person who would notice is the person who wanted to ship,
> and they were not trying to ship. Thirty consecutive failures over five months produced
> no signal at all. The tags kept arriving on schedule, so from inside the repository the
> pipeline *looked* like it was working.

---

## §1 — Trigger

You are in this situation when you are about to:

- **"cut a release"**, **"ship v1.2"**, **"tag a version"**, **"publish the installer"**.
- add a file that must carry the version number — a new crate, an `about` dialog, a
  manifest, an Android `versionCode`, a Sentry release name.
- add a platform, an architecture, or a bundle format to the build matrix.
- write a step that pushes anything back to the repository (a commit, a tag, a release
  asset) from inside a workflow.
- wire a workflow to run **after** another workflow (`workflow_run`, `needs:` across
  files, an API query for a sibling's conclusion).
- *the "if you are about to write X" test:* if you are about to write
  `git tag`, `git push --tags`, `gh release create`, or a step that computes a version
  string, you are here.

You are **not** here for: what a build profile compiles
([feature-flagged-compilation](./feature-flagged-compilation.md)), which generator runs on
which hook ([codegen-task-registration](./codegen-task-registration.md)), whether a
build-time constant survives into the artifact
([compile-time-env-embedding](./compile-time-env-embedding.md)), or whether the resulting
installer works ([installer-acceptance-testing](./installer-acceptance-testing.md)).

---

## §2 — The one way

**Make the tag an input, not an output — and make the release a promotion of an artifact
that already exists and has already been proven, never a request to go build one.** A
release cut has exactly two irreversible acts: writing a version into the repository, and
publishing bytes under that version's name. Everything between them is fallible, so both
irreversible acts must sit on the *far* side of every fallible one. Concretely: build the
artifacts first, from an immutable ref, and prove them; only then write the version, tag,
and publish. If your pipeline instead computes a version, commits it, pushes a tag and
*then* starts a 45-minute cross-platform build, every failure downstream leaves a permanent
public claim behind — that is how this repository accumulated 11 tags and 0 releases. Where
the ordering cannot be inverted (a Tauri bundle embeds `CARGO_PKG_VERSION`, so the version
must be written before the build), the version must be written to a **detached candidate
ref that is never pushed until the artifacts exist**, and the tag pushed as the *last* step
of the last job. Second: a release has exactly **one** version surface, and every other
file that displays a version reads it from that one. Where a language forces a literal
into a second file, the set of those files is an **inventory the release script asserts
against**, not a hand-maintained list in a `git add` line. Third: a gate that guards
publication must fail loudly when it cannot render a verdict, and must be **something that
can pass** — a conjunction with a workflow that has never been green is not a gate, it is
an off switch nobody remembers installing.

---

## §3 — Mandated primitives

| Primitive | What it gives you | Where |
| --- | --- | --- |
| `scripts/bump-version.mjs` | conventional-commit → semver bump; writes `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` in one pass; **refuses to bump an unparseable version** (`:54-57`) and **refuses if the lockfile entry is missing** (`:107-110`) | `scripts/bump-version.mjs` |
| `scripts/lib/git-tags.mjs` → `getCommitsSinceLastTag()` | the single definition of "since the last release" — shared by the bumper and the changelog generator, so they can never disagree about the range | `scripts/lib/git-tags.mjs` |
| `scripts/generate-changelog.mjs` | commits → grouped release notes; `INTERNAL_RE` (`:17`) drops `chore/ci/test/style/build` so the version-bump commit never appears in its own notes | `scripts/generate-changelog.mjs` |
| `release.yml`'s **tag-collision guard** (`:119-134`) | fails in seconds with an actionable message instead of after 45 minutes of platform builds. The comment names the exact incident that earned it | `.github/workflows/release.yml:119` |
| `release.yml`'s **`updater-manifest` hard-fail** (`:486-498`) | refuses to publish a `latest.json` that strands a platform. Enumerates 8 required url+signature pairs and names the config keys to check | `.github/workflows/release.yml:486` |
| `scripts/verify-onnxruntime-bundling.mjs` | linking-aware proof that the shipped exe can find ORT — reads the PE import table rather than assuming a linking mode | `scripts/verify-onnxruntime-bundling.mjs` |
| `scripts/check-tauri-configs.mjs` | `$schema` drift, overlay-surface containment, feature names vs `Cargo.toml [features]`, and a **directive-parsing** CSP assertion that fails rather than skips on a missing key | `scripts/check-tauri-configs.mjs` |
| `scripts/check-tiers.mjs` | runs codegen **once** up front, then builds each `VITE_APP_TIER` variant, and keeps going after a failure so one broken tier cannot hide another (`:61`) | `scripts/check-tiers.mjs:22-32` |

Do **not** invent a second version bumper, a second "commits since last tag" helper, or a
second changelog format. All three exist and all three are correct.

---

## §4 — Steps

1. **Decide what a release *is* in this repo before writing any step.** Here it is: four
   platform installers + updater bundles + signatures + a `latest.json` the shipped
   updater polls. The last item is the one that makes a partial release worse than none —
   `tauri.conf.json:61-65` points every installed copy at
   `releases/latest/download/latest.json`.
2. **Give the workflow a mode, and make publication the non-default.** `release.yml:15-20`
   already does this: `workflow_dispatch` with `publish: boolean, default: false`. A
   default-off publish is the single best decision in this file.
3. **Put the gate before the first irreversible act, and make the gate reachable.** The
   gate must be able to pass. If it queries another workflow's conclusion, measure that
   workflow's historical success rate *before* you make it a precondition (§0).
4. **Resolve the build ref ONCE and pass it down.** Every downstream job checks out
   `needs.version.outputs.ref` (`release.yml:182`, `:243`). Do not let one job read
   `github.sha` while another reads `master` — see §7 D2.
5. **Build the frontend once and share it.** `release.yml:174-204` builds `dist/` on
   `ubuntu-latest` and uploads it; the four platform jobs download it instead of rebuilding.
   That is right, and it is the cheapest correctness win in the file — four platforms cannot
   disagree about the bundle they embed if there is only one bundle.
6. **Build all platforms with `fail-fast: false`, then require all of them at the manifest
   step.** `release.yml:211` + `:486-498`. One platform's runner outage should not cancel
   the other three, but it must still stop the publish.
7. **Prove each artifact on its own runner, before it leaves.** `release.yml:322-331`
   (ONNX bundling) and `:333-335` (size budget) are the model: a per-artifact assertion that
   runs where the artifact is, and fails the leg.
8. **Write the version, commit, and push the tag LAST.** This is the step this repository
   has backwards. See §5 A1.
9. **Then stop.** Do not hand-write an installer test, a signature verifier, or an updater
   manifest generator — `tauri-action` produces the signed updater bundles and
   `installer-test.yml` owns acceptance. Hand off to
   [installer-acceptance-testing](./installer-acceptance-testing.md).

### Can the primitive's signature make the wrong call impossible?

Asked before §9, per the contract. Three answers, and two of them are yes:

- **The version-surface set can be made unspellable.** Cargo has `[workspace.package]
  version` + `version.workspace = true`. Adopting it collapses the four crate literals to
  one, and `bump-version.mjs`'s existing single regex then covers the whole workspace. This
  is a **type-shaped fix, not a gate**: after it, a new crate *cannot* declare a version the
  bumper misses, because the only spelling available inherits. Qualification check —
  **Q3 (a type nobody constructs constrains nothing)**: this one is constructed 5 times
  today, so it reaches. **Q5 (withholding beats requiring)**: `version.workspace = true`
  withholds the literal entirely, which is the strong form.
- **The `git add` list can be withheld.** `release.yml:151` hand-lists the four files the
  bumper writes. The bumper already knows that set. Have `bump-version.mjs` print the paths
  it wrote on a second output line and have the workflow stage exactly those — the list then
  cannot drift, because there is only one list. **Q7** applies in the good direction: the
  requirement (a hand-written pathspec) *is* what forces the bad value.
- **The tag cannot be made unforgeable by a type** — a `git push --tags` is a side effect, not
  a value. This is where the ordering discipline in §2 has to carry the weight, and where a
  gate is genuinely earned.

---

## §5 — Anti-patterns

**A1 — Tagging before the artifacts exist.** *Failure mode:* the tag is a permanent public
claim; the build is fallible. Push the tag first and every build failure leaves a version
number in the world with nothing behind it. Measured here: 11 tags, 0 releases, 30/30
release runs failed. The updater makes it worse than cosmetic — a user on `v1.0.0` polls
`releases/latest/download/latest.json` forever against a release list that is empty.

**A2 — Gating on a conjunct you have not measured.** *Failure mode:* the gate looks
rigorous and is an off switch. `ci-gate` is well-written, well-commented, correctly narrows
its own permissions, and prints the verdict on the non-publishing path so a red tree is
never invisible. It is also a conjunction with a workflow that is 0-for-324. **Before you
gate on X, query X's success rate.** One API call.

**A3 — Two changelogs, one generated and one abandoned.** *Failure mode:* the human-facing
file rots while the pipeline reports health. `generate-changelog.mjs` writes the *GitHub
Release body* from commits; nothing writes `CHANGELOG.md`. Measured: **11 tags, 4 `##`
headings, 3 tags covered, 8 not** — including both 1.x releases. `.claude/CLAUDE.md`'s PR
self-review asks every contributor to add to `## [Unreleased]`, and `[Unreleased]` has
never been cut.

**A4 — Resolving the release's subject from two different refs.** *Failure mode:* the
commit you verified and the commit you shipped are different commits, and nothing says so.
See §7 D2.

**A5 — A "check" that no automated caller invokes.** *Failure mode:* a green
`npm run check` that means less than its name. Measured: **19 `check:*`/`audit:*` npm
aliases; 6 are inside `npm run check`; 4 more are invoked directly by a workflow; 2 have
their underlying script (not the alias) invoked by a lefthook pre-commit job; and 6 —
`check:dead`, `check:dead:files`, `check:i18n-dead`, `check:catalog`,
`check:catalog-boundary`, `check:assets` — are invoked by nothing at all.**
Advisory is a legitimate design; *unlabelled* advisory is not. Say which are gates.

**A6 — A pipe between a checker and its exit code.** *Failure mode:* the step reports the
pipe's status, not the checker's. GitHub's default `run:` shell is `bash -e {0}` — **no
`pipefail`**. `audit.yml:44` runs
`cd src-tauri && cargo deny check 2>&1 | tee security-results/cargo-deny.txt`; a dependency
policy violation exits non-zero into `tee`, which exits 0, and the step passes. The
identical check at `ci.yml:313` has no pipe and is enforced. **Same check, two workflows,
one disarmed by a `tee`.**

**A7 — Believing a comment that describes the pipeline's cost.** *Failure mode:* an
optimisation that saves nothing, defended by a wrong number. See §7 D5.

---

## §6 — Evidence

**The one site to copy: `release.yml:380-498`, the `updater-manifest` job.** It is the best
release-shaped code in the repository, and every property is deliberate:

- it is `if: publish == 'true'` — it does not pretend to run on a mode where its inputs
  cannot exist;
- it retries the release-asset fetch with exponential backoff (`:403-408`) because GitHub
  finalises assets asynchronously;
- it **prints every asset name and every matched URL before deciding** (`:470-477`), so a
  failure is diagnosable from the log alone;
- it **enumerates the eight things that must exist and hard-fails naming each missing one**
  (`:486-498`), with the comment stating exactly why a graceful degrade is worse:
  *"a latest.json with an empty url/signature doesn't degrade gracefully — the updater on
  that platform errors on every check, which reads as 'updates are broken', silently."*

That is the fail-loud contract, implemented, in a release job. Copy its shape.

Secondary exemplars:

| Site | Why |
| --- | --- |
| `release.yml:119-134` | tag-collision guard: fails in seconds, message names the remedy and the incident |
| `release.yml:259-268` | per-target `rust-cache` key, with the comment explaining the arch-poisoning it prevents |
| `ci.yml:243-260` | *a compilation cache must never be able to fail the build* — degrade to a slow build, warn, keep the gate |
| `ci.yml:419-431` | the binding-drift check that also looks for **untracked** output, because `git diff` exits 0 on a new file |
| `scripts/bump-version.mjs:49-57`, `:106-110` | two hard refusals, both earned by real incidents (`0.1.NaN.1` is still a tag) |
| `scripts/check-tiers.mjs:22-32` | runs codegen before spawning `vite build` directly, and says in the comment why |

---

## §7 — Deviations

### A. The cut is ordered backwards, and the evidence is on `origin` — 3

**A1 — The tag is pushed before any artifact exists.** `release.yml:146-154` commits and
runs `git push origin master --tags` inside the `version` job; `build` declares
`needs: [version, frontend]`. Result measured today: **11 tags / 0 releases**, and the last
run tagged `v1.1.0` with 4/4 platform builds failing. *Fix (deferred — changes what the
workflow does):* move the commit+tag+push into a final job that `needs: build`, and pass the
computed version to the platform jobs as an output rather than as a committed file.
Filed as **deferred fix 62**.

**A2 — `CHANGELOG.md` is not part of the cut.** `release.yml:151`'s `git add` names four
files and `CHANGELOG.md` is not one. Two implementations agreeing: 11 tags, 4 `##` headings,
**3 tags covered, 8 not** (`v0.1.1`–`v0.1.5`, `v0.1.NaN.1`, `v1.0.0`, `v1.1.0`). The spine's
own framing for this leaf names "changelog" as one of the four things in the ordered cut;
it is the one thing the cut does not touch. *Fix (note): have the `version` job rename
`## [Unreleased]` to `## [<version>] — <date>`, insert a fresh empty `[Unreleased]`, and add
`CHANGELOG.md` to the staged set.*

**A3 — `v0.1.NaN.1` is still a tag on this repository.** The bug that produced it is fixed
(`bump-version.mjs:49-57`) and the fix is well-commented. The artifact of the bug was never
deleted, and it sits between `v0.1.6` and `v0.2.0` in `git tag --sort=-v:refname`. *Fix
(note, requires operator consent — deleting a public tag is destructive):* `git push origin
:refs/tags/v0.1.NaN.1`.

### B. Version surfaces the bumper cannot reach — 2

**B1 — Five `version` literals, one bumper, four unreachable.** `bump-version.mjs` writes
four files. Under `src-tauri/` there are **five** `^version = "x.y.z"` declarations:

| file | version today | written by `bump-version.mjs` |
| --- | --- | --- |
| `src-tauri/Cargo.toml:18` | `1.1.0` | **yes** (`:92`, `^(version\s*=\s*")` with `m` — first match in file) |
| `src-tauri/core/Cargo.toml:3` | `1.1.0` | no |
| `src-tauri/db/Cargo.toml:3` | `1.1.0` | no |
| `src-tauri/engine/Cargo.toml:3` | `1.1.0` | no |
| `src-tauri/macros/Cargo.toml:3` | `0.1.0` | no |

`members = [".", "macros", "core", "db", "engine"]` and **no `[workspace.package]` table
exists**, so every member declares its own literal. Three of them are at `1.1.0` by
coincidence of a hand-edit, and `macros` has already diverged to `0.1.0`. The regex's `m`
flag plus first-match semantics means it is also *positionally* fragile: it rewrites the
first `^version =` in the root manifest, which happens to be the package version only
because `[workspace]` (lines 1-14) declares none. *Fix: adopt `[workspace.package] version`
+ `version.workspace = true` — see §4's type-over-gate answer.*

**B2 — `Cargo.lock` is bumped for one package by name.** `bump-version.mjs:106` matches
`name = "personas-desktop"\nversion = "…"` and errors out if that literal is absent — a
good refusal. It does not touch `personas-core`/`personas-db`/`personas-engine` entries.
Consistent today only because B1 leaves those versions frozen; the moment B1 is fixed
without fixing B2, `--locked` builds break.

### C. What the release path does *not* run — 3

**C1 — The release build runs zero of the repository's checks and zero tests.** The
`frontend` job is `npm ci` + `npm run build`. `npm run build` is
`sync-system-skills && tsc -b && vite build` (plus the `prebuild` codegen preset) — so `tsc`
runs, and ESLint, Vitest, the i18n parity check, the theme-contrast check, the error-registry
parity check, the tier builds, the bundle budget and the unused-bindings scan **do not**.
That is a *defensible* design — the release delegates to `ci-gate` — and it is exactly why
§0 matters: the delegation target is 0-for-324, so the delegation resolves to nothing.

**C2 — Two of the three declared Tauri build variants are not reachable from any workflow.**
`--config src-tauri/tauri.lite.conf.json` and `--config src-tauri/tauri.stable.conf.json`
appear in **0** of the 7 workflow files (verified by a repo-wide search: the only non-doc
hits are `package.json`, `scripts/check-tauri-configs.mjs`, `scripts/dev/tauri-dev-test.mjs`
and `scripts/test/launch-isolated.mjs`). CI exercises the *canonical* config only:
`installer-test.yml` runs `npx tauri build --bundles {nsis,dmg,deb+appimage}` and
`release.yml` runs `tauri-action` with `args: --target <triple>`, neither passing `--config`.
The overlays are small (2 keys each) and `check-tauri-configs.mjs` validates their shape, so
the exposure is bounded — but `tauri:build:stable` is the only declared producer of an
**MSI**, and its feature/target combination is built by nobody.
*Related, and not re-derived here:* [feature-flagged-compilation §7 C](./feature-flagged-compilation.md)
measured that no CI job compiles `ml` or `p2p` at all — 374 cfg sites and 16,076 LOC first
compiled at release time, which is precisely the code path the four failing legs exercise.

**C3 — The npm lifecycle hooks that guard the native cache do not run in CI, and the release
is the only cross-compile.** `pretauri:build`, `pretauri:build:stable`, `pretauri:dev`,
`pretauri:dev:stable` and `pretauri:dev:test:full` all run `scripts/ensure-ort-cache.mjs`.
The release invokes `npx tauri` through `tauri-action` (`tauriScript: npx tauri`), which is
not an `npm run`, so **no `pre*` hook fires** and the ORT architecture fix never executes on
a release runner. This is partly benign and partly not — see
[bundling-native-assets §7 B](./bundling-native-assets.md), which owns the analysis.

### D. Gates that resolve the wrong thing — 5

**D1 — `installer-test.yml` has produced 8 runs and 0 verdicts.** All 8 are
`workflow_run` events on `master`, all conclusion `skipped`. Owned by
[installer-acceptance-testing](./installer-acceptance-testing.md); recorded here because it
is the release pipeline's only post-publication proof.

**D2 — `ci-gate` validates one ref and the pipeline builds another.** `ci-gate` queries
`?head_sha=${{ github.sha }}`. The `version` job then does
`actions/checkout@v4` with `ref: master` (`:88`) and computes
`REF = "v${VERSION}"` on the publish path — a tag created on whatever `master` points at
*when the job runs*. On a `workflow_dispatch` from a non-tip ref, or when `master` advances
between dispatch and execution, **the commit whose CI conclusion was checked is not the
commit that gets tagged and built.** On the `pull_request: types: [closed]` path the gap is
structural: `github.sha` is the merge-test commit, and the checkout is `master`. *Fix
(deferred — changes what the workflow builds):* resolve the SHA once in `ci-gate`, emit it
as an output, and have `version` check that SHA out explicitly. Filed as **deferred fix 63**.

**D3 — `beforeBuildCommand: ""` is passed to `tauri-action` and may not be an input it
has.** `release.yml:320`. The intent is unambiguous and correct — the `frontend` job built
`dist/` and the platform jobs download it, so re-running `npm run build` would waste ~10
minutes per platform and could produce a *different* bundle than the one the release
validated. GitHub Actions accepts unknown `with:` keys with a warning and no failure, so
from the tree alone it is impossible to tell whether this line does what it says. **This is
the shape to notice, not the line:** a workflow input is a claim about another repository's
API, and nothing in this repo verifies it. *Fix (note): read the action's `action.yml` at
the pinned major and either keep the input or replace it with the documented mechanism;
either way, add a step that asserts `dist/index.html`'s mtime is older than the job start.*

**D4 — A `tee` disarms `cargo deny` in one workflow and not the other.** `audit.yml:44` vs
`ci.yml:313` (see §5 A6). *Fix (note): drop the pipe, or set
`shell: bash` + `set -o pipefail`, or `tee` after capturing `${PIPESTATUS[0]}`.*

**D5 — CI runs six full Vite builds per `frontend-checks` run, and the comment that claims
otherwise is wrong.** Expanded programmatically from `package.json`:

```
npm run check → check:contracts, check:tiers (NO ARGS → starter+team+builder),
                check:tauri-configs, check:csp-hosts, check:corpus,
                check:doc-map, census:check, tsc --noEmit, eslint src/
```

So `ci.yml:118`'s `npm run check` already runs **1 codegen pass + 3 Vite builds**. `ci.yml:163`
then runs `npm run check:tiers starter team` (**+1 codegen, +2 builds**) and `ci.yml:167` runs
`npm run build` (**+1 codegen, +1 build**). **Total: 3 codegen passes and 6 Vite builds.**
`ci.yml:157-159` justifies excluding `builder` from the explicit tier step because *"the
canonical `npm run build` step below produces it, so building it again would be redundant
(~one extra full Vite build per CI run)"* — but `npm run check`, four steps earlier, already
built all three. The optimisation saves nothing and the stated cost model is off by 5 builds.
*Fix (note): pass explicit tiers to `check:tiers` inside `npm run check` (or drop it from the
chain), and correct the comment.*

### E. Cleared — claims tested and found sound

Recorded because a cleared claim is worth as much as a confirmed one.

- **The `pretauri:*` hook coverage is coherent, not a gap.** The three variants without an
  ORT pre-hook — `tauri:build:lite`, `tauri:dev:lite`, `tauri:dev:test` — are exactly the
  three that compile with `desktop` (no `ml`), and `ort` is a `dep:` of `ml` only
  (`Cargo.toml`). `scripts/dev/tauri-dev-test.mjs:27` confirms `tauri:dev:test` derives from
  `tauri.lite.conf.json`. The partition is correct.
- **All 17 committed codegen artifacts are tracked.** Verified by two implementations
  (`git ls-files --error-unmatch` per path; membership in a `git ls-files` Set read into
  node): 17/17 tracked, 0 ignored, including all 793 `src/i18n/section-locales/**` files.
  So the "`npx vite build` silently ships stale translations" hazard in the brief is real
  as a *stale-tree* hazard and **not** as a *missing-artifact* hazard — the split output is
  committed. The freshness question is [codegen-task-registration](./codegen-task-registration.md)'s,
  and it measured the committed artifacts of all 14 registered tasks byte-fresh today.
- **`git add <explicit paths>` in `release.yml:151` is the right shape for a workflow.** The
  parallel-session hazard `.claude/CLAUDE.md` documents (lefthook re-staging on a partial
  commit) does not apply on a fresh runner with no hooks installed and a single writer.

---

## §8 — Gaps — what the primitives genuinely cannot do

1. **`tauri-action` owns the bundle step, so the pipeline cannot assert anything about the
   artifact between "built" and "uploaded to a release".** On the publish path the action
   creates the release and uploads in one opaque step; the ONNX and size checks at `:322`
   and `:333` run *after* it. There is no supported hook for "verify, then upload". The only
   available shape is to run with `tagName: ''` (build only), verify, and upload with `gh`
   by hand — which means reimplementing the signature handling.
2. **`workflow_run` cannot pass a payload.** GitHub gives the downstream workflow the
   triggering run's id and conclusion, not its outputs. That is the structural reason
   `installer-test.yml` has to re-resolve "which release" by asking `gh release view` and
   gets the *latest*, not the triggering one.
3. **A release workflow cannot verify its own reachability.** Nothing in Actions expresses
   "this job's `if:` has never been true". This is the gap that hid §0 for five months, and
   it is not closable inside the workflow — it needs an external query (§9).
4. **The census cannot express any of this leaf's findings.** Detailed in §9; the short
   version is that every one of them is an *absence*, a *ratio between two different
   artifacts*, or a *property of run history* — three things a file-content ratchet cannot
   see.
5. **A Tauri release cannot invert the version/build ordering completely.** The bundle
   embeds `CARGO_PKG_VERSION` and the NSIS filename carries it, so the version must be
   written to the working tree before the build. Only the *commit and the tag* can move
   after it — which is why §2 says "detached candidate ref", not "build first".

---

## §9 — The missing gate

### What I am declining, and with what numbers

**A census rule is the wrong instrument for this leaf, and I am not proposing one.** The
census ratchets a count of a textual condition present in files. Every finding above is one
of three shapes it cannot see:

| Finding | Why the census cannot express it |
| --- | --- |
| `ci-gate` is unreachable (§0) | a property of **324 API records**, not of any file's bytes |
| 11 tags / 0 releases (§7 A1) | a property of `origin`'s refs and the Releases API |
| 8 tags with no changelog heading (§7 A2) | a **join between two artifacts** (`git tag` × `CHANGELOG.md`); the census reads one file at a time |
| 4 unbumpable crate versions (§7 B1) | the violating text is `version = "1.1.0"` — **byte-identical to the compliant text** in the root manifest. A pattern that matches one matches all five, and the discriminator is *which file*, which is a set-membership question |
| 6 Vite builds per run (§7 D5) | requires **expanding an `npm run` graph**, not matching a string |
| 6 uninvoked `check:*` aliases (§5 A5) | an absence — "no automated caller names this script". Doctrine §4: *"the census cannot assert an ABSENCE."* |

There is a second, independent reason, and it is worth recording because it applies to the
whole `.github/` surface: **not one of the 178 rules in `scripts/census/rules.json` has a
root under `.github` or an extension of `.yml`/`.yaml`.** (Verified: the union of all
`roots` is `{.ai, eslint-rules, scripts, src, src-tauri…, tests, tools, uat}`; the union of
all `extensions` is `{.cjs .js .json .mjs .py .rs .sh .ts .tsx}`.) The CI/CD surface — 7
workflows, 1,562 lines, the thing that decides what reaches a user — is entirely outside
the corpus's ratchet. One rule is proposed on that surface, and it belongs to the
neighbouring leaf: [installer-acceptance-testing §9](./installer-acceptance-testing.md)'s
`verification-that-cannot-fail`, validated at 3 matches / 2 files with a 16-match positive
control. Adding a second, weaker workflow rule here would dilute it.

### The instrument this leaf actually needs — `scripts/check-release-cut.mjs`

Same warrant as `scripts/check-csp-hosts.mjs`, which exists precisely because an
"allowlist-covers-a-set" condition cannot live in the census. Four assertions, all
inventory-shaped, all offline except the last:

1. **Version-surface inventory.** Enumerate every declared version in the tree — all
   `^version = ` lines in `src-tauri/**/Cargo.toml`, `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/gen/android/**/tauri.properties` — and assert the set equals the set
   `bump-version.mjs` writes. Fail listing the difference. *Today this exits 1 with four
   entries.* **Precondition guard: exit 2 if the walk finds fewer than 5 `Cargo.toml`
   files**, so a broken glob cannot read as a clean run.
2. **Tag ↔ changelog join.** For every tag matching `v<semver>`, assert a
   `^## \[?<semver>` heading exists in `CHANGELOG.md`. *Today this exits 1 with 8 entries.*
   **Precondition guard: exit 2 if `git tag` returns nothing.**
3. **Staged-set agreement.** Assert that the pathspec in `release.yml`'s `git add` line
   equals the paths `bump-version.mjs` writes. *Today: agrees.* This is the assertion that
   keeps agreeing once assertion 1's fix lands.
4. **Gate reachability (online, `--online`).** For each workflow named as a precondition by
   another workflow, query `/actions/workflows/<file>/runs` and **fail if its all-time
   success count is zero**. This is the one that would have caught §0 in one call, five
   months ago. *Today this exits 1 naming `ci.yml`: 0 successes in 324 runs.*

Wire it as `npm run check:release-cut`, run it in `release.yml` **as the first step of the
`version` job on the publish path only** — i.e. where its verdict can still change what
happens — and as a step in `ci.yml`'s `frontend-checks` in offline mode.

**Which condition each assertion is a proxy for, so another repo can re-derive its own:**

- 1 and 3 proxy *"the set of files carrying the release identity is enumerated once, and every
  writer agrees with the enumeration."* A repo with a real workspace-version mechanism, a
  monorepo release tool (changesets, release-please, Lerna), or a single `VERSION` file does
  not have this condition at all — do not port the check, port the question.
- 2 proxies *"every published identity has a human-readable account of what changed."* A repo
  that generates its changelog **into the tree** from commits (rather than into a release
  body) satisfies this by construction.
- 4 proxies *"a precondition that has never been satisfiable is an off switch."* This one is
  universal and cheap, and it is the one to port first.

### Why not just fix `ci.yml`?

Because that is a different leaf's job ([adding-a-ci-gate](./adding-a-ci-gate.md) owns the
diagnosis, down to the `npm ci` lockfile desync that takes `frontend-checks` down), and
because **assertion 4 must exist even after `ci.yml` is green.** The next precondition
someone adds will be unreachable for its own reasons, and nothing in the repository would
notice.

---

## §10 — The convergence oracle

**Cohort established for this leaf, at measurement time (2026-08-17): five checkouts
present, and the effective independent cohort for *this question* is one.**

| repo | workflows | version bumper | changelog gen | `CHANGELOG.md` | tags |
| --- | --- | --- | --- | --- | ---: |
| `personas-web` | `ci.yml` | none | none | yes (2 headings) | **0** |
| `brainiac` | `ci.yml`, `deploy-test.yml`, `release.yml`, `security.yml` | none | none | no | **1** |
| `personas-cloud` | **none** | none | none | no | **0** |
| `vibeman` | `ci.yml`, `auto-refactor.yml`, `security-audit.yml` | none | none | no | **0** |
| `ascent` | `ci.yml`, `maturity.yml` | none | none | yes (1 heading) | **0** |

**The `convergence: converged` label fails, and it fails by silence.** Four of five siblings
have never cut a version at all, and none has a version bumper or a changelog generator.
Personas is the only repo in the cohort that ships a versioned artifact to end users, so
there is nothing here to converge *with*. Per the doctrine's ledger this is the **fourteenth**
tested `converged` label and the fourteenth failure; the mode is the plain one (silence), not
one of the exotic ones.

**`sides: server` holds, and the mechanism is worth naming.** The entire subject — workflow
YAML, npm scripts, Cargo manifests, git refs — exists before a renderer does. There is no
client half to report and none is missing: the frontend's only participation is that
`import.meta.env.VITE_APP_TIER` is read at build time, and *that* is
[environment-variable-configuration](./environment-variable-configuration.md)'s, whose census
rule `env-default-conflates-unset-with-empty` already records the release-relevant
consequence — `VITE_APP_TIER` has no writer in `release.yml`, so every installer this
pipeline would produce is the **builder** tier by fallback.

**The one real signal the oracle produced, and it is an inversion.** `brainiac/.github/workflows/release.yml`
triggers on `push: tags: ["v*"]` — **the tag is the input**. A human decides to release by
creating the tag; the workflow reacts by building and publishing images. Personas puts the
tag on the *output* side: the workflow decides the version, writes it, commits it and pushes
the tag as a side effect of starting. **The repo with the tag on the input side has 1 tag and
1 release; the repo with the tag on the output side has 11 tags and 0 releases.** The same
author, a different mechanism (Docker images vs. four platform installers), and a different
answer — which per the doctrine is the form of oracle evidence that survives shared
authorship. `brainiac`'s file also carries `fail-fast: true` with the comment *"One tag must
not ship half a stack"*, which is the same instinct §2 states, applied one job earlier.

**Personas is ahead of the fleet on two clauses**, stated as self-comparison: nobody else has
an updater-manifest completeness gate, and nobody else has a tag-collision guard. Both are
genuinely good and both should be copied outward rather than reinvented — which is only
useful to say because the same file's ordering is the thing that broke.

---

## §12 — Corrections

**12.1 — To my brief: "establish which codegen outputs are committed and which are
build-time-only… that partition is the spine of `release-pipeline`." It is not, and the
partition has a different answer than implied.** The partition was measured (§7 E) and it is
**17 of 17 committed, 0 build-time-only**, with exactly one gitignored destination
(`src-tauri/resources/skills/**`, 1 tracked file: `.gitkeep`). More to the point, the
codegen-freshness question is owned end-to-end by
[codegen-task-registration](./codegen-task-registration.md), composed the same day, which
**executed** all 19 generators under a filesystem harness. Re-deriving it here would have
produced a second, worse set of numbers for someone else's leaf. The spine's own framing —
*"version files, tag, changelog and four platform builds in one ordered cut"* — is the
better scoping, and it is what this document follows.

**12.2 — To my brief: "Is every variant reachable from CI, or do some exist only as local
conveniences? A variant nobody builds is a variant that is already broken."** The premise is
right and the framing is one level too shallow. Measured: `lite` and `stable` are reachable
from 0 workflows (§7 C2) — but their *contents* are two keys each, and both keys are
exercised elsewhere (`desktop` by `ci.yml`'s three cargo invocations, `desktop-full` and
`nsis` by `release.yml` and `installer-test.yml`). The genuinely unbuilt combination is
**MSI**, which only `tauri:build:stable` declares. The sharper finding is not that a variant
is unbuilt; it is that **the canonical variant is built 30 times and has failed 30 times**,
which no amount of variant coverage would have surfaced.

**12.3 — To `.claude/CLAUDE.md`, "Build & packaging": *"Locally validate all three with
`npm run check:tiers` (CI also runs this)."*** CI runs `npm run check:tiers starter team` —
two tiers, explicitly — at `ci.yml:163`. It *also* runs all three, four steps earlier and
invisibly, because `npm run check` chains `check:tiers` with no arguments. Both halves of
the sentence are true and together they mislead: the reader concludes CI validates three
tiers once, when it validates them twice and then builds a sixth time. See §7 D5.

**12.4 — To `.github/workflows/ci.yml:157-159`.** The comment *"the builder tier is NOT built
here — the canonical `npm run build` step below produces it, so building it again would be
redundant (~one extra full Vite build per CI run)"* is false in its premise and off by 5× in
its cost estimate. `npm run check` at `:118` already built all three tiers.

**12.5 — To `.github/workflows/release.yml:12-13`.** *"auto-tagging on every run left 5 tags
on origin with zero releases behind them"* — re-measured 2026-08-17: **11 tags, 0 releases.**
The comment is a snapshot that has not been refreshed as the condition it describes doubled.

**12.6 — To [adding-a-ci-gate](./adding-a-ci-gate.md) §0's workflow table (2026-08-15).** Two
rows have moved and one should be restated. `ci.yml` is now **324 runs / 0 success / 191
failure / 132 cancelled** (was 260 / 0 / 184 / 76) — the verdict is unchanged and now rests
on 25% more evidence. `installer-test.yml` is listed as *"has never run at all"* with
`0 | 0 | 0`; the API returns **8 runs**, all `workflow_run`, all with conclusion
**`skipped`**. The distinction matters and is the correction worth carrying: *a workflow that
has never run and a workflow that has run 8 times and skipped every job look identical in a
success/failure/cancelled tally, and they are different diseases.* The first is unwired; the
second is wired to a precondition that never holds. `installer-test.yml` is the second.
Recorded in full at [installer-acceptance-testing §0](./installer-acceptance-testing.md).

**12.7 — To the spine node itself.** `convergence: converged` is contradicted (§10, by
silence: 4 of 5 siblings have never cut a release). `sides: server` **holds**, with the
structural reason stated. `risk: high` is, if anything, understated — the measured state is
that the repository's declared version has never corresponded to a downloadable artifact.
