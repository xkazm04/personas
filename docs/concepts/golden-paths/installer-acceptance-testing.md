# Golden path — Installer acceptance testing

> Situation node: `platform-delivery/packaging-and-release/installer-acceptance-testing` ·
> [situation spine](../situation-spine.md)
> `sides: server` · `twoSided: false` · recurrence **3** · risk **medium** ·
> spine label `convergence: mixed`.
> Dimensions: **resilience · function**.
> Spine's own framing: *"Proof the packaged installer installs, launches and finds its assets."*
>
> Composed 2026-08-17 against `master` @ `2a874e692`. **Short form** (Mode 2 tiering:
> medium risk, recurrence 3) — prose is compressed, measurement is not.
>
> **Sweep size.** `.github/workflows/installer-test.yml` (379 lines, read in full),
> `release.yml` (550) and `e2e-smoke.yml` (101) for the chaining;
> `scripts/test-installer.ps1` (198) parsed with a brace-matcher, step by step;
> `src-tauri/src/main.rs`'s `run_health_check()`; `scripts/verify-onnxruntime-bundling.mjs`;
> `tauri.conf.json`'s `bundle` block; `src-tauri/src/commands/infrastructure/skill_files.rs`.
> Plus the **GitHub Actions API, all-time**, for every run and every job of
> `installer-test.yml` and `release.yml`.
>
> **`cargo` was NOT run and no installer was built.** Everything below is from the tree or
> from run history.
>
> **Nothing below was applied.** The §9 rule is proposed as fenced JSON for the orchestrator
> to merge; it was validated in a private scratch registry.

---

## §0 — The headline: eight runs, zero verdicts, and it is not a failure

`installer-test.yml` is a good acceptance test. It silently installs, checks file placement,
checks the uninstall registry key, runs the binary's `--health-check`, and silently
uninstalls — on x64 and on `windows-11-arm`, plus DMG and deb/AppImage jobs on the other two
platforms. Queried from the Actions API on 2026-08-17, all-time:

| | |
| --- | ---: |
| runs | **8** |
| triggering event | `workflow_run`, all 8 |
| branch | `master`, all 8 |
| conclusion | **`skipped`, all 8** |
| successes | 0 |
| failures | **0** |

Every job of the most recent run (`2026-07-16T21:09:59Z`): `test-release` **skipped**,
`test-tag` **skipped**, `test-build` **skipped**. **The workflow has never rendered a verdict
about an installer, and it has never gone red, because a workflow whose jobs all skip
concludes `skipped` — which is not a failure and alarms nothing.**

The cause is one line of chaining:

```yaml
# installer-test.yml:25-27
if: >-
  github.event_name == 'workflow_run' &&
  github.event.workflow_run.conclusion == 'success'
```

`release.yml` has run **30 times and concluded `failure` 30 times** (see
[release-pipeline §0](./release-pipeline.md)). The only automatically-reachable job in this
workflow is conditioned on a workflow that has never succeeded. The other four jobs
(`test-build`, `test-build-macos`, `test-build-linux`, `test-tag`) all require
`github.event_name == 'workflow_dispatch'`, so nothing triggers them but a human clicking a
button — and nobody has.

> **The generalizable shape, and it is the reason this leaf matters more than its
> recurrence-3 suggests:** an acceptance test is the last gate before a user, so it is the
> gate with the fewest people looking at it, and it is the one most likely to be chained
> behind something else. **A `skipped` conclusion is indistinguishable from a healthy one in
> every dashboard GitHub offers.** Green means "we checked". Red means "we checked and it's
> bad". Grey means nothing at all, and grey is what you get for five months when your
> precondition is another workflow's success.

Two independent measurements of the same thing, which is how the skip was found at all:
`GET /actions/workflows/installer-test.yml/runs` returns `total_count: 8` with a conclusion
tally of `{"skipped": 8}`; `GET /actions/runs/<id>/jobs` on the newest run returns three jobs,
all `conclusion: skipped`. A tally that buckets only success/failure/cancelled reports this
workflow as `0 | 0 | 0` — see §12.2.

---

## §2 — The one way (compact)

**Acceptance-test the artifact you are about to publish, from the artifact itself, on a
machine that has never built it — and make the test's verdict able to stop the
publication.** In order:

1. **Test the *installer*, not the build tree.** The interesting failures are placement,
   registry, resource resolution and uninstall — none of which exist in
   `target/release/`. Run the real installer silently (`/S`, `hdiutil attach`,
   `apt-get install ./x.deb`), against the real destination.
2. **Resolve the artifact from the run that produced it, never from "latest".** If your CI
   cannot pass a payload between workflows, do not paper over it by asking a registry what
   the newest thing is — build in the same workflow, or pass the artifact id explicitly.
   Re-resolving is how a test ends up certifying something it never built (§7 B1).
3. **Assert what the leaf's name promises, in three parts: it installs, it launches, and it
   finds its assets.** The third is the one everybody skips and it is the one that only
   breaks in a packaged build — a bundled resource that resolves from the repo in dev and
   from `<resource_dir>` in the installer has exactly one place it can be tested.
4. **Every assertion must be able to fail.** A step whose both branches print and neither
   throws is decoration. So is a job carrying `continue-on-error: true`.
5. **If a job must be advisory during a soak, its promotion criterion must be a condition
   that can actually occur** — a number of runs on a trigger the workflow actually has, and
   a date. Otherwise "temporarily non-blocking" is permanent (§7 C).
6. **Fail closed on "I could not find the artifact".** A test that no-ops when its input is
   missing reports the same colour as a test that passed. Emit a distinct, loud outcome.
7. **Then stop.** Uninstall, and assert the uninstall — the second half of the contract, and
   the half a user only exercises when they are already unhappy.

**Where the artifact cannot be built in the same workflow as the test, prefer building it
*again* in the test workflow over downloading "the latest release".** A rebuild that differs
from the release is a finding; a test of the wrong artifact is not even wrong.

---

## §7 — Deviations

### A. What the acceptance test does not assert — 4

**A1 — It never checks that the bundled assets landed. That is the leaf's own `why`.**
`scripts/test-installer.ps1` runs 9 `Test-Step` blocks: `silent-install`, `binary-exists`,
`uninstaller-exists`, `binary-size`, `onnxruntime-runtime`, `uninstall-registry`,
`deep-link-protocol`, `health-check`, `silent-uninstall`. `tauri.conf.json:129-131` declares
`"resources": {"resources/skills": "skills"}`, and
`src-tauri/src/commands/infrastructure/skill_files.rs:265-291` resolves it at runtime with a
three-candidate fallback chain whose **first** candidate is `<resource_dir>/skills`.
**Nothing in the installed-tree checks looks at it.** The one assertion that touches a
non-executable artifact is `onnxruntime-runtime`, and it delegates to
`verify-onnxruntime-bundling.mjs --dir <installDir>` — which is exactly the right shape and
covers exactly one asset family. *Fix (note): a `bundled-resources` step asserting
`<installDir>/resources/skills/<name>/SKILL.md` exists for each declared system skill —
which is also the only place the [bundling-native-assets](./bundling-native-assets.md) §7 A1
orphan surplus becomes visible from outside the build machine.*

**A2 — `--health-check` cannot detect a missing asset, by construction.**
`src-tauri/src/main.rs:34-75` asserts: it prints `CARGO_PKG_VERSION`; the rustls provider
installs; `rusqlite::Connection::open_in_memory()` answers `SELECT sqlite_version()`; Sentry
initialises; `dirs::data_local_dir()` resolves. It is a **process-can-start** probe, and a
well-chosen one — it needs no window, no display and no database file, which is what makes
it usable from a headless runner and from `xvfb-run`. But it never opens the resource dir,
never touches the real database or its migrations, and never loads the frontend bundle. So
"installs" and "launches" are proven and "finds its assets" is not, on any platform.
*Fix (note): a `--health-check` arm that resolves `app.path().resource_dir()` and asserts one
known-present file. It is ~6 lines and it converts A1 from an installer-script change into a
binary-level invariant every platform's smoke inherits for free.*

**A3 — One of the nine steps cannot fail.** Parsed with a brace-matcher over
`test-installer.ps1`: 8 of 9 `Test-Step` bodies contain at least one `throw`;
`deep-link-protocol` (`:135-143`) contains **zero** — both branches call `Write-Host` and
return. It prints `(personas://)` when `HKEY_CLASSES_ROOT\personas` exists and
`(protocol not in HKCR -- may be per-user)` when it does not, and passes either way. The
deep-link protocol registration is a real user-visible capability (`tauri.conf.json:54-59`
declares the `personas` scheme) and it is the one thing in this script that is checked
without being tested. *Fix (note): check the per-user path too —
`HKCU:\Software\Classes\personas` — and `throw` when neither exists.*

**A4 — MSI is built on every release and acceptance-tested by nothing.**
`tauri.conf.json:71` is `"targets": "all"`, which on Windows produces NSIS **and** MSI (plus
the updater `.zip`s, `createUpdaterArtifacts: true`). Every path into `test-installer.ps1`
resolves an installer by the pattern `*<arch>-setup.exe` — `installer-test.yml:71`, `:117`,
`:374`, and the script's own default glob `Personas_*_$Arch-setup.exe` (`:46`). **NSIS only.**
`tauri:build:stable` is the only script that names `msi` explicitly, and
[release-pipeline §7 C2](./release-pipeline.md) measured that its config is referenced by 0
workflows.

### B. Resolving the wrong artifact — 2

**B1 — `test-release` asks for the *latest* release, not the release the triggering run
produced.** `installer-test.yml:55` is `gh release view --json tagName --jq '.tagName'` with
no tag argument. The guard around it is honest about the case it was written for — a
build-validation run creates no release, so `$tag` is empty and the job no-ops with a
`::notice::`. But the guard's own message says *"(or no release has ever been published)"*,
and **that is the branch it is actually taking today**: the repository has **0** published
releases. The moment one exists, the guard stops firing and every subsequent
build-validation Release run will download **that** release and re-run the full acceptance
suite against it — reporting green for a commit whose installer it never touched. *This is
the `workflow_run` payload gap ([release-pipeline §8.2](./release-pipeline.md)) leaking into
a verdict.* *Fix (note): resolve the tag from
`github.event.workflow_run.head_sha` → `gh api /repos/:r/releases/tags/v<version>` where the
version comes from `package.json` at that SHA, and **fail** — not skip — if the resolved tag
does not exist while the triggering run's `publish` input was true.*

**B2 — The `arm64` leg downloads by filename pattern with no architecture verification.**
`installer-test.yml:71` downloads `*arm64-setup.exe` and hands it to a `windows-11-arm`
runner. The filename is the only claim about what is inside; the acceptance suite has no
machine-type assertion (the repo owns two PE machine-field readers and the release gate uses
neither — see [bundling-native-assets §7 C](./bundling-native-assets.md)). An x64 build
mis-named `arm64` would fail here at `silent-install` or `health-check`, loudly — so this leg
*would* catch it. It is recorded because it catches it **by accident**, and only on the one
leg that has a native arm64 runner.

### C. Two jobs that cannot fail, with a promotion criterion that cannot occur — 3

**C1 — `test-build-macos` and `test-build-linux` are `continue-on-error: true`**
(`:150`, `:267`). Both carry a soak-period comment: *"Flip to false once this job has been
green … for 5 consecutive scheduled runs."*

**C2 — `installer-test.yml` has no `schedule:` trigger.** Its `on:` block declares
`workflow_run` and `workflow_dispatch` and nothing else (`:3-13`). **There is no such thing
as a scheduled run of this workflow**, so the stated promotion criterion cannot be met by any
sequence of events. It is not a slow soak; it is a soak with no clock.

**C3 — And neither job has ever appeared in an executed run.** The most recent run's job
list is `{test-release, test-tag, test-build}` — the macOS and Linux jobs postdate
2026-07-16, which is also the last time `release.yml` ran, which is the only thing that
triggers this workflow. So their green-run counter stands at **0** against a target of 5 on
a trigger that does not exist.

The same pattern is next door and is where these two inherited it: `e2e-smoke.yml:7` says
*"After 5 consecutive green runs, flip continue-on-error to false"* for a workflow that is
**0 for 38**. And its item 3 — *"Promote installer-test.yml from post-release to pre-release
gate"* — is the fix for §0 and is still undone. *Fix (note): give the promotion criterion a
**date** as well as a count, and add a `schedule:` trigger if a scheduled run is what the
criterion counts.*

### D. Cleared — checked and sound

- **`--health-check` is the right primitive and the PowerShell around it is right too.**
  `test-installer.ps1:148-175` documents why `&` cannot capture a GUI-subsystem exe's exit
  code on Windows and uses `Start-Process -RedirectStandardOutput` instead — a real
  hard-won mechanism, and the same temp-file pattern is reused for
  `verify-onnxruntime-bundling.mjs` at `:103-114` with its own stated reason (PowerShell 5.1
  native-stderr wrapping vs `$ErrorActionPreference = Stop`).
- **The ASCII-only constraint is documented and correct** (`:14-18`): cp1252 consoles
  mis-decode UTF-8 box-drawing and refuse to parse the file.
- **The macOS job's degraded mode is honestly designed.** `installer-test.yml:203-228` runs
  its structural assertions (binary exists, executable, `codesign` reports adhoc *or* a real
  Authority, and **fails on no signature at all**) *unconditionally*, and only the launch
  attempt is best-effort. That is the correct split between "what a headless runner can
  promise" and "what it cannot".
- **`fail-fast: false` on the x64/arm64 matrix** (`:33`) with the reason stated: an arm64
  runner outage must not mask a passing x64 leg.
- **The Linux job's `libfuse2` install** (`:305`) with the reason stated: AppImage needs FUSE
  to mount itself and Ubuntu 22.04+ does not ship it. Both smoke tests assert **both** the
  exit code and the presence of `health-check: passed` in the log (`:334`, `:352`) — belt and
  braces, correctly.

---

## §9 — The missing gate

### The signal

**`continue-on-error: true` in a workflow file.** It is the one form of "this verification
cannot change the outcome" that is textual, unambiguous, and countable — and it is the exact
mechanism behind §7 C.

**Which condition it is a proxy for, so another repo can re-derive its own:**
*"a verification runs, reports, and its verdict cannot change what happens."* The CI-provider
spelling here is `continue-on-error`; elsewhere it is GitLab's `allow_failure: true`,
Jenkins' `catchError(buildResult: 'SUCCESS')`, a `|| true` after a checker, or a lint rule
at `warn` under a runner with no `--max-warnings`. **Do not port the pattern; port the
question** — and note that this repo's own worst instance of the condition is not spelled
this way at all: `test-installer.ps1`'s `deep-link-protocol` step (§7 A3) is a verification
that cannot fail, and no regex over YAML will ever see it.

**Site-level overlap with the existing registry: 0%, by construction.** Not one of the
**178** rules in `scripts/census/rules.json` has a root under `.github` or an extension of
`.yml`/`.yaml` (the union of all `roots` is
`{.ai, eslint-rules, scripts, src, src-tauri…, tests, tools, uat}`; the union of all
`extensions` is `{.cjs .js .json .mjs .py .rs .sh .ts .tsx}`). The CI surface — 7 workflows,
1,562 lines — is outside the corpus's ratchet entirely. This is the first rule on it.

**Measured, validated in a private scratch registry
(`gpB-2026-08-17-registry.json`), `--check` exit 0:**

| | files | matches |
| --- | ---: | ---: |
| `verification-that-cannot-fail` | **2** | **3** |
| `verification-that-cannot-fail-positive-control` | 3 | 16 |
| walked | 10 | — |

**Hand-verified precision: 3/3.** All three sites were opened:

| site | verdict |
| --- | --- |
| `installer-test.yml:150` (`test-build-macos`, job level) | **true positive** — §7 C1/C2/C3 |
| `installer-test.yml:267` (`test-build-linux`, job level) | **true positive** — same |
| `e2e-smoke.yml:72` (smoke step) | **true positive** — promotion criterion is 5 green runs on a workflow that is 0-for-38 |

**The positive control partitions the family, and that is the whole design.** The anchor is
"directives that keep CI going past a failure". `continue-on-error: true` keeps going and
**discards the verdict**; `if: always()` keeps going and **preserves it** — the step still
decides the job. 16 compliant sites against 3 violating (84% compliant), and the compliant
form is dominant *in the same repository, in the same files* — 14 of the 16 are in `ci.yml`,
placed there deliberately so *"a failing test step does not hide a lint regression"*
(`ci.yml:301`). That is why these 3 are a defect and not a house style. The control carries
**no `baseline`**, per the merger's contract.

Both patterns are line-anchored with the `m` flag and `ignoreCommentLines: false` **on
purpose**: YAML comments start with `#`, which the engine's `//`-oriented comment stripper
does not know. Anchoring to `^[ \t]*` excludes commented occurrences directly — and there are
four of them in these two files (`e2e-smoke.yml:7`, `installer-test.yml:139`, `:233`, `:258`),
so a naive pattern would report **7** and be 43% prose.

**How it fails loudly if its own precondition is absent.** `floor: 6` — `.github` currently
holds 10 `.yml` files (7 workflows + 3 issue templates); a walk that sees fewer than 6 means
the root or the extension list has stopped describing the repo, and the runner exits 1
rather than reporting a clean bundle. The engine's other fail-loud arms apply unchanged: zero
matching files is fatal, and a **drop** without `--update` is fatal (a drop here is far more
likely to mean someone renamed the key than that someone promoted a job).

**When this rule should be deleted rather than ratcheted:** if all three sites are promoted,
the count reaches 0 and the census cannot express "must be zero" — the rule must be removed
at that point, not baselined at 0.

```json
{
  "id": "verification-that-cannot-fail",
  "goldenPath": "docs/concepts/golden-paths/installer-acceptance-testing.md",
  "roots": [".github"],
  "extensions": [".yml", ".yaml"],
  "signal": {
    "pattern": "^[ \\t]*continue-on-error:[ \\t]*true\\b",
    "flags": "gm",
    "ignoreCommentLines": false,
    "description": "a CI job or step declared continue-on-error: true — it runs, it reports, and its verdict cannot change the workflow's conclusion. PROXY FOR the stack-free condition: 'a verification runs, reports, and its verdict cannot change what happens.' Measured 2026-08-17: 3 matches in 2 files, precision 3/3 hand-verified by opening every site. All three carry a soak-period promotion criterion that CANNOT BE MET: installer-test.yml:150 and :267 say 'green for 5 consecutive scheduled runs' and installer-test.yml declares no schedule: trigger at all (its on: block is workflow_run + workflow_dispatch), and neither job has appeared in any executed run — the workflow has 8 runs all-time, all conclusion `skipped`; e2e-smoke.yml:72 says 'after 5 consecutive green runs' for a workflow that is 0 successes in 38 runs. THE COMPLIANT FORM IS DOMINANT IN THE SAME FILES — `if: always()` also keeps CI going past a failure but the step's own exit code still decides the job: 16 sites in 3 files, 14 of them in ci.yml where the comment at :301 states the intent ('so a failing test step does not hide a lint regression'). That is why these 3 are a defect and not a house style. Line-anchored with the m flag and ignoreCommentLines:false ON PURPOSE — YAML comments are '#', which the engine's '//'-oriented stripper does not know; the four commented occurrences in these same two files (e2e-smoke.yml:7, installer-test.yml:139, :233, :258) would take a naive pattern to 7 matches, 43% of them prose. LEGAL FIX: delete the key and let the job fail, or convert it to `if: always()` if the intent was 'keep running past an earlier failure'. If a soak really is needed, give the criterion a DATE as well as a count, and add the trigger the criterion counts. PRECONDITION (re-derive per repo): this repo runs GitHub Actions. The same condition is spelled allow_failure: true (GitLab), catchError(buildResult:'SUCCESS') (Jenkins), `|| true` after a checker, or a warn-level lint rule under a runner with no --max-warnings — and this repo's worst instance is not spelled in YAML at all (scripts/test-installer.ps1:135-143 is a test step whose both branches print and neither throws). DELETE THIS RULE rather than baselining it at 0 if the count ever reaches zero — the census cannot express 'must be zero'.",
    "$comment": "baseline measured 2026-08-17 at master 2a874e692; walked 10 .yml files under .github"
  },
  "baseline": { "files": 2, "matches": 3 },
  "floor": 6
}
```

```json
{
  "id": "verification-that-cannot-fail-positive-control",
  "goldenPath": "docs/concepts/golden-paths/installer-acceptance-testing.md",
  "roots": [".github"],
  "extensions": [".yml", ".yaml"],
  "signal": {
    "pattern": "^[ \\t]*if:[ \\t]*always\\(\\)",
    "flags": "gm",
    "ignoreCommentLines": false,
    "description": "POSITIVE CONTROL for verification-that-cannot-fail. The COMPLIANT member of the same family: `if: always()` also keeps a step running past an earlier failure, but the step's own exit code still decides the job — the verdict survives. Measured 2026-08-17: 16 matches in 3 files (ci.yml x14, audit.yml x1, installer-test.yml x1) against the violating form's 3 in 2 files, so the family partitions 16 compliant / 3 violating (84% compliant) inside one repository. A control that returns ~0 would mean the pattern is not discriminating on 'keep going past a failure' but on something narrower. No baseline: the merger skips controls."
  },
  "floor": 6
}
```

### What no rule here can reach

Recorded so it is not attempted: **the §0 finding — a workflow whose jobs all skip — is not
expressible.** It is a property of 8 API records, not of any file's bytes, and its textual
cause (`if: … workflow_run.conclusion == 'success'`) is *correct code*. The instrument for
that is assertion 4 of `scripts/check-release-cut.mjs`, specified in
[release-pipeline §9](./release-pipeline.md): for each workflow named as a precondition by
another workflow, query its all-time success count and **fail if it is zero**. One API call
would have caught §0 five months ago.

---

## §12 — Corrections

**12.1 — To my brief: "`npm run check:assets` … is advisory and not CI-gated. So is a lot
else. An advisory check is not a gate."** The lens is right and the example is the weakest
one available. Measured across the whole check surface: **19 `check:*`/`audit:*` npm aliases;
6 inside `npm run check`; 4 invoked directly by a workflow; 2 whose underlying script (not
the alias) runs in a lefthook pre-commit job; and 6 — `check:dead`, `check:dead:files`,
`check:i18n-dead`, `check:catalog`, `check:catalog-boundary`, `check:assets` — invoked by
nothing at all.** But `check:assets` is a *cosmetic* advisory (PNG→WebP savings) and its
being ungated costs kilobytes. The load-bearing instance of the brief's own lens is in this
leaf: three CI jobs that **do** run, **do** report, and **cannot** fail — §7 C — plus a
PowerShell step that cannot fail (§7 A3). *An advisory check that is labelled advisory is a
choice; a verification that looks like a gate and cannot fail is the defect.*

**12.2 — To [adding-a-ci-gate](./adding-a-ci-gate.md) §0's workflow table.** It records
`installer-test.yml` as `0 | 0 | 0` with the note *"has never run at all"*. The API returns
**8 runs**, all `workflow_run` on `master`, all with conclusion **`skipped`** — the earliest
2026-04-17, the latest 2026-07-16. A success/failure/cancelled tally cannot see them, which
is exactly how the note was arrived at, and the distinction is the correction worth carrying:
**a workflow that has never been triggered and a workflow that has been triggered 8 times and
skipped every job present identically in that tally, and they are different diseases.** The
first is unwired — fix the trigger. The second is wired to a precondition that never holds —
fix the precondition, or the thing it depends on. Everything else in that table's row is
accurate, and its verdict about this workflow ("no verdict has ever been produced") is
correct on better evidence than it had.

**12.3 — To `installer-test.yml:45-49`'s guard comment.** *"Without this guard `gh release
view` errors and the job fails on every validation run. Resolve the release first and no-op
cleanly when there isn't one."* True, and it describes only the branch that exists while the
repository has zero releases. `gh release view` with no argument resolves the **latest**
release, which is not the triggering run's — so once any release exists the guard stops
firing and the job starts certifying an artifact it did not build (§7 B1). The comment
documents the guard's purpose and not its resolution semantics, and the two diverge the day
the first release lands.

**12.4 — To the spine node.** `convergence: mixed` is **untestable and should be read as
silence**: `installer-test.yml` has no counterpart in any of the five sibling checkouts —
none of them ships an installer, four have zero tags, and the only sibling with a
`release.yml` (`brainiac`) publishes container images, whose acceptance question is
"does the image start", not "did the installer place the files". **0 of 5 siblings
acceptance-test a package.** Per the doctrine, a silence is strong and this one says the
situation is genuinely local to the only desktop app in the fleet. `sides: server` holds and
the mechanism is worth naming: *the artifact under test is a file, and the client does not
exist until it has been installed.* `risk: medium` is defensible; `recurrence: 3` is
accurate — this leaf has one script and one workflow, and the reason it deserved a document
anyway is that both of them have never produced a verdict.
