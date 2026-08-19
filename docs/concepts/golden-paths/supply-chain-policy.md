# Golden path — Supply-chain policy

> Situation node: `platform-delivery/gates-and-conventions/supply-chain-policy` ·
> [situation spine](../situation-spine.md) · recurrence 5 · risk **medium** ·
> sides **server** (**upheld — §12.4**) · convergence **converged**
> (**failed, and inverted — §12.3**) · dimensions: **security · cost** ·
> `twoSided: false` · spine's own framing: *"License, advisory and registry
> checks when a dependency is added or bumped."*
> Composed 2026-08-17 against `master` @ `cc27be561`. **Short form** per the
> Mode-2 tiering (spine header, §0, §2 compact, §7, §9, §12). The quality core —
> two implementations of every count, hand-verified precision, private-registry
> validation — is unchanged. **`cargo` is unavailable in this session; every
> Rust-side claim below comes from reading the manifests and from *the CI logs
> of runs that already executed*, never from a local build.**
>
> **Sweep.** `src-tauri/deny.toml` (65 lines, one commit, never edited since
> 2026-04-09); `.github/workflows/audit.yml` (52 lines) and its 23 lifetime runs;
> `.github/workflows/ci.yml:308-313` and its **327** lifetime runs;
> `scripts/security-audit.sh` (9,082 B); `renovate.json`;
> `package.json` + `package-lock.json` (**707** lockfile packages);
> `src-tauri/Cargo.lock` (**1,010** packages) and the four workspace manifests
> (**38** `optional = true` declarations); all **56** `uses:` references across
> **7** workflows; `src-tauri/gen/android/gradle/wrapper/` (**2** tracked files).
> Oracle: all five siblings, cohort re-established at measurement time (§12.3).
>
> **Measured by executing, not reading.** The headline came out of the GitHub
> Actions API and the raw job log of run `32025966929`, job `95375460599` — not
> from an argument about the config file.

---

## §0 — Headline

**`cargo deny check` has never rendered a policy verdict in this repository —
not once in four months and 350 workflow runs — and for two entirely different
reasons in sequence.**

| period | what happened to the policy check |
|---|---|
| 2026-04-09 → 2026-08-13 | **`skipped`.** The step had no `if: always()`, and an earlier step in `rust-tests` failed on every run. Sampled at 2026-04-27, 07-07, 07-13, 07-17, 07-24, 07-29, 08-04, 08-10: `skipped`, 8 of 8, all three platforms. |
| 2026-08-13 → today | **`failure` in 21 milliseconds, having examined 0 of 1,010 crates.** `if: always()` landed in `6cd8a87f0` (*"ci: turn on the tests that never ran, stop red steps hiding each other"*) — and the moment the step could finally run, it died before reading the dependency graph. |

The exact bytes, from the job log:

```
error[unexpected-value]: expected '["all", "workspace", "transitive", "none"]'
   ┌─ /home/runner/work/personas/personas/src-tauri/deny.toml:19:17
19 │ unmaintained = "warn"
   │                 ━━━━ unexpected value
[ERROR] failed to deserialize config from '.../src-tauri/deny.toml'
Process completed with exit code 1
```

The mechanism is the finding. `ci.yml:310` installs the policy engine with
`cargo install cargo-deny --locked` — and **`--locked` pins cargo-deny's own
lockfile, not cargo-deny's version.** The runner fetched **v0.20.2**; the config
was written for a 2026-04 schema and has not been touched since. **The policy
engine floats and the policy is frozen**, so an upstream release became an
unannounced gate outage.

The second door is shut too. `audit.yml`'s cargo-deny step is `skipped` on
**23 of 23** weekly runs since 2026-03-16 (0 successes, ever) because
`scripts/security-audit.sh` — which carries `cargo audit` *and* `npm audit` —
fails first and nothing there is `if: always()`. Since 2026-08-10 it does not
even reach that: **`npm ci` fails with `EUSAGE — package.json and
package-lock.json are not in sync` (`Missing: @emnapi/runtime@1.11.3,
@emnapi/core@1.11.3`)**, which takes down the frontend gate, the weekly security
audit, the bundle budget and the unused-bindings check with one lockfile.

So: **every advisory, license, registry and yanked-crate check this repository
declares is currently unenforced**, on both the per-push path and the weekly
path, and `renovate.json:23` states as settled fact that *"cargo-deny already
gates supply chain on every PR."*

Three more, each independently verifiable:

- **101 third-party action references across the six-repo fleet, 0 pinned to a
  commit SHA.** Personas: **56 refs, 7 workflows, 0 SHA-pinned**, including
  `dtolnay/rust-toolchain@stable` **8 times — `stable` is a branch**, not a tag.
  Meanwhile the same repository content-addresses **1,707** library
  references (1,004 Cargo `checksum` + 703 npm `integrity`). The discipline
  exists; it stops at the boundary where code executes with a repo token.
- **Renovate has never run.** `renovate.json` was committed 2026-06-11 with
  `:dependencyDashboard`, which opens an issue titled *"Dependency Dashboard"*
  on its first execution. Measured: **0 Renovate PRs** (of 13 lifetime PRs) and
  **0 issues** with that title, open or closed. The file's own `//` says
  *"Requires enabling the Renovate GitHub App on this repo."* It was not
  enabled. `.claude/CLAUDE.md`'s *"Dependency bumps come in via Renovate"*
  describes a lane that has produced nothing in 67 days.
- **The lockfile contains exactly one thing the policy forbids.**
  `deny.toml` sets `unknown-git = "deny"` with `allow-git = []`;
  `src-tauri/Cargo.lock:6011` carries
  `source = "git+https://github.com/xkazm04/pumper.git?rev=7e13f31…"`. Whether
  cargo-deny would *see* it turns on feature resolution, and `[graph]` declares
  five targets and **no feature selection at all** while the root crate's
  `default = []` — so the scope of the policy is undeclared, and nobody has ever
  observed its output to find out.

---

## §2 — The one way (compact)

**Pin the engine with the policy, declare the graph the policy walks, and
content-address everything you execute — then make the verdict separable from
the build's health, because a policy check inside a red job is a check nobody
reads.** Concretely:

1. **Pin the checker's version, not just its lockfile.** `cargo install X
   --locked` reproduces *X's* dependencies; it does not reproduce *X*. Use a
   pinned prebuilt binary (`taiki-e/install-action` with a `tool: X@version`) or
   `--version`. A supply-chain gate whose engine auto-upgrades has an outage
   scheduled for whenever upstream renames a config key — and the outage looks
   exactly like a policy violation.

2. **Declare the graph.** `all-features = true` and `exclude-dev = false`
   belong in `[graph]` explicitly. A policy that inherits its scope from cargo's
   default feature resolution is a policy whose scope no reader can state, and
   in a workspace with 38 `optional = true` declarations that difference is the
   entire ML/P2P/scraper dependency surface — the heaviest and least-audited
   native code in the tree.

3. **Content-address every external artifact you execute.** Libraries already
   are (`integrity`, `checksum`, `rev`). CI actions are code that runs with your
   token and they are referenced by mutable names — `@v4`, `@v2`, `@stable`.
   Pin to a 40-character commit SHA and let a bot move it. The same rule covers
   `npx pkg@latest` and any `curl | sh` installer.

4. **Verify a vendored binary's own bytes, and pin the distribution it
   fetches.** Established as a general law by
   [`bundling-native-assets`](./bundling-native-assets.md): *a vendored
   artifact's declared provenance is a claim, not a fact.* Its supply-chain form
   is the Gradle wrapper — a tracked 59,203-byte `.jar` that will download and
   execute a distribution named only by URL unless `distributionSha256Sum` pins
   it.

5. **Treat a lockfile desync as an incident, not a CI annoyance.** The lockfile
   *is* the control: it is where every integrity hash lives. `npm ci`'s refusal
   to install from an out-of-sync lockfile is the mechanism working. What must
   not happen is what happened here — the refusal cascading into four unrelated
   gates for a week while being read as "CI is flaky".

6. **Separate the policy verdict from the build's health.** `if: always()` is
   necessary and not sufficient: a failing policy step inside a job that is red
   for four other reasons carries no information at job granularity. Put the
   supply-chain checks in **their own workflow, with their own required status**,
   so "the dependency tree has a problem" and "the build is broken" are two
   different colours on two different rows.

7. **An audit that needs a build is an audit you will lose.** `npm audit`
   resolves from `package-lock.json` alone; `cargo deny` and `cargo audit` read
   `Cargo.lock`. None of them needs `npm ci`, `node_modules`, or a compiled
   target. Wiring them behind an install step is what converted one lockfile
   desync into a total loss of advisory coverage. Run them off the manifests.

8. **Automation you configured and never enabled is worse than none**, because
   it gets cited as coverage — by the config file's own comment, by CLAUDE.md,
   and by the next reviewer. Prove the lane produces artifacts (a PR, a
   dashboard issue) before writing down that it does.

---

## §7 — Deviations

### 7.A — P0. The policy engine is unpinned and the policy is stale; it dies in 21 ms

`ci.yml:310` `cargo install cargo-deny --locked` → v0.20.2 on 2026-08-17.
`src-tauri/deny.toml:17-21` carries the pre-`version = 2` advisory schema:

```toml
[advisories]
vulnerability = "deny"      # removed key in the modern schema
unmaintained = "warn"       # <- now an ENUM: all|workspace|transitive|none
yanked = "warn"
ignore = []
```

`unmaintained` was repurposed from a lint level to a *scope*; `"warn"` is no
longer a member of its domain, so deserialization fails and **`cargo deny check`
exits 1 without reading `Cargo.lock`**. Elapsed between the step's `##[endgroup]`
and the error, from the log timestamps: `12:25:27.1903790Z` →
`12:25:27.2117893Z` = **21 ms**, across **0 of 1,010** packages.

**The fix is in the fleet, not in a manual** — see §12.3. **Not applied**: this
is a security control whose current settings may be deliberate (`yanked = "warn"`
vs `"deny"` is a policy decision, not a typo), and repairing it turns a check
that examines nothing into one that will very likely report real findings on a
1,010-crate tree during a working day. Registered as deferred fix **#106**.

### 7.B — P0. Both doors to the policy are shut, for two different reasons

| workflow | lifetime runs | success | the policy step |
|---|---:|---:|---|
| `ci.yml` | **327** (191 failure, 135 cancelled, 1 in flight) | **0** | `skipped` until 2026-08-13, `failure` (7.A) since |
| `audit.yml` | **23** (weekly since 2026-03-16) | **0** | **`skipped` on 23 of 23** |

`audit.yml` has no `if: always()`. `Run security audit` (which carries
`cargo audit` **and** `npm audit`) fails first on every run — with
`Install dependencies` (`npm ci`) failing before even that since ~2026-08-10 —
so `Check dependency policies (cargo-deny)` is `skipped` every time.

**Consequence for a published claim:** the `tee`/`pipefail` defect at
`audit.yml:44` that [`release-pipeline`](./release-pipeline.md) §5/§7 records is
**real in the source and has never been reached**. See §12.1.

### 7.C — P0. 56 action references, 0 content-addressed, 8 of them to a branch

Two implementations agreeing exactly (a `grep -o 'uses: *[^ ]*'` tally and a
per-file line enumeration):

| ref | count | mutability |
|---|---:|---|
| `actions/checkout@v4` | 17 | moving major tag |
| `actions/setup-node@v4` | 11 | moving major tag |
| `dtolnay/rust-toolchain@stable` | 8 | **a branch** |
| `swatinem/rust-cache@v2` (+1 `Swatinem/`) | 7 | moving major tag |
| `mozilla-actions/sccache-action@v0.0.7` | 6 | exact tag (still movable) |
| `actions/upload-artifact@v4` / `download-artifact@v4` | 4 | moving major tag |
| `github/codeql-action/{init,analyze}@v3` | 2 | moving major tag |
| `tauri-apps/tauri-action@v0` | 1 | moving major tag |
| **SHA-pinned** | **0** | — |

Four of the eleven distinct actions are third-party. All of them execute inside
jobs holding `secrets.GITHUB_TOKEN`, and `release.yml` additionally holds
`SENTRY_AUTH_TOKEN` and the signing secrets. `renovate.json:14` already declares
`matchUpdateTypes: ["patch","pin","digest"], automerge: true` — the configuration
for digest pinning is present and has never executed (7.E).

Same class, different markup, same file set: `release.yml:361,365,371` run
`npx @sentry/cli@latest`, and `audit.yml:38` / `ci.yml:310` /
`security-audit.sh:53` install cargo tooling with no `--version`.
**Compliant instances in the whole tree: 1** —
`docs/devops/guide-android-dev-setup.md:103` `cargo install tauri-cli --version "^2"`,
and that is a range in a document, not a pin in a workflow.

### 7.D — P1. The lockfile carries the one source the policy forbids, and the policy's scope is undeclared

`src-tauri/Cargo.lock`, counted two ways (a `grep -c` over `source = "git+` and a
block-splitting parse of all 1,010 `[[package]]` stanzas — agreeing):

```
packages            1,010
crates.io + checksum  1,004
local path (no source, no checksum)  5   personas-{core,db,desktop,engine,macros}
git+                 1   pumper-core 0.1.0 @ rev 7e13f31
```

`deny.toml:61-64` — `unknown-git = "deny"`, `allow-git = []`. `pumper-core` is
optional behind the `scraper` feature (`src-tauri/Cargo.toml:79,108` and
`engine/Cargo.toml:40,113`), and **`deny.toml`'s `[graph]` declares `targets`
and nothing about features** while `src-tauri/Cargo.toml`'s `default = []`. So
whether the policy examines this dependency — or any of the **38**
`optional = true` declarations across the four manifests (21 root, 14 engine,
2 db, 1 core), which is where `ort`, `fastembed`, `quinn`, `mdns-sd`,
`ed25519-dalek` and `rcgen` live — depends on a feature resolution the config
never states. **Unresolvable from the config alone, and unobserved:** nobody has
seen this command's output since it was written.

The credit where due: `pumper-core` **is** pinned to an immutable `rev`, which
is the correct way to take a git dependency. The defect is the undeclared scope
and the un-run check, not the dependency.

### 7.E — P1. Renovate: configured 2026-06-11, never enabled, cited as coverage

| probe | result |
|---|---|
| PRs authored by Renovate (of 13 lifetime PRs, all states) | **0** |
| issues titled *"Dependency Dashboard"* (all states) | **0** |
| `renovate.json` last commit | `cf5d26434`, 2026-06-11 |

`:dependencyDashboard` guarantees that issue on first run; its absence is a
*positive* proof of non-execution, not merely a failure to find one. Two
downstream claims are therefore false:

- `renovate.json:23` — *"cargo-deny already gates supply chain on every PR"*.
  Wrong twice: cargo-deny gates nothing (7.A/7.B), and `ci.yml:4-7` records that
  **development lands directly on `master` with no PRs** — **13 pull requests
  have ever been opened on this repository, against 7,417 commits since
  2026-01-01** — so a `pull_request`-scoped policy would be a gate on 0.2% of
  the change stream even if it worked.
- `.claude/CLAUDE.md` — *"Dependency bumps come in via Renovate (`renovate.json`):
  the agent reads the changelog / breaking changes and evaluates — never
  blind-merges."* There have been no bumps to evaluate.

### 7.F — P1. The npm lockfile is desynchronised, and the desync sits on the four entries with no integrity hash

```
package-lock.json   lockfileVersion 3
  packages                          707
  resolved outside registry.npmjs.org  0        <- clean
  entries with NO integrity           4        <- all under @tailwindcss/oxide-wasm32-wasi
  entries with hasInstallScript       5        better-sqlite3, sharp, lefthook,
                                               fsevents x2  (npm ci runs these)
package.json  postinstall: node scripts/patches/fix-frozen-intrinsics.mjs
              prepare:     lefthook install || true
```

`npm ci` fails with `Missing: @emnapi/runtime@1.11.3, @emnapi/core@1.11.3`. The
lock pins the `@emnapi` family at 1.10.0/1.2.1 across four sibling wasm32-wasi
bundles, and the three `@tailwindcss/oxide-wasm32-wasi/node_modules/@emnapi/*`
entries plus its nested `tslib` are **the only four entries in the file with
neither `integrity` nor `resolved`** — bundled-dependency stubs whose real
resolution floats upstream. **The one family npm cannot verify is the one that
broke the install.**

`8766c6c41` (2026-08-15, *"fix(ci): both named causes of the 0-of-260 CI
failure"*) attempted a repair; the count is now 0-of-327. **Not applied** — a
lockfile regeneration changes what every future install resolves.

### 7.G — P2. The Gradle wrapper: a tracked jar and an unpinned distribution

```
src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar          59,203 B, TRACKED
  sha256  e996d452d2645e70c01c11143ca2d3742734a28da2bf61f25c82bdc288c9e637
src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties   TRACKED
  distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.3-bin.zip
  distributionSha256Sum   ABSENT
```

Two artifacts, two different failures of the same principle. The `.jar` is 59 KB
of executable bytecode committed with **no recorded provenance anywhere in the
repository** — no hash, no upstream reference, no note of which Gradle release it
came from; the sha256 above is this document's, computed today, and is the first
time it has been written down. The `.properties` names a distribution by URL and
supplies no `distributionSha256Sum`, so the wrapper will fetch and execute
whatever is served. Both files are **tracked** — 40 files under
`src-tauri/gen/android/` are — while the header comment inside the properties
file still reads `#Tue May 10 19:22:52 CST 2022`, a template timestamp four years
older than the distribution it names.

**Not applied.** Adding `distributionSha256Sum` changes whether an Android build
starts.

### 7.H — P2. Cleared

- **npm registry hygiene is sound**: 0 of 707 lockfile entries resolve outside
  `registry.npmjs.org`; 703 of 707 carry an sha512 `integrity`.
- **Cargo registry hygiene is sound**: 1,004 of 1,010 carry a `checksum`; the
  five without are this workspace's own path crates.
- **`codeql.yml` is 14 runs, 14 successes** — the only workflow in this
  repository that is unambiguously green. It is SAST rather than dependency
  policy, so it does not cover this leaf, but it establishes that the failure
  mode here is specific (anything needing `npm ci` or `cargo build`) rather than
  ambient.
- **`security-audit.sh` records a *failure* testcase when `cargo-audit` is
  absent** (`:63-64`, `record_test … "fail" "cargo-audit binary not available"`)
  rather than skipping green — the correct fail-closed shape, and the thing to
  keep when the script is repaired. It also carries `set -euo pipefail` at
  `:13`, which is the guard `audit.yml:44` lacks.

---

## §9 — The missing gate: a decline, and a limitation of the census worth recording

**Declined — with numbers**, and the reason generalises beyond this leaf.

The obvious rule writes itself: *a `uses:` reference in `.github/workflows/**`
whose ref is not a 40-character commit SHA.* It has everything a census rule
wants — a stable anchor, a trivially precise pattern, **hand-verified precision
56/56** (all 56 opened; every one is a mutable ref), a natural floor, and a
condition that only ever gets worse silently.

**It cannot be shipped, and the reason is structural.** A census rule must carry
a positive control: the same anchor pointed at the compliant form, which must
also match. The compliant form here is `uses: <action>@<40-hex>`, and it occurs
**0 times in this repository — and 0 times in all five siblings** (§12.3).
`scripts/census/lib/engine.mjs:264` classifies a zero-match rule as a
**structural** failure, correctly, so the control cannot be registered.

> **A new limit, offered upward for the doctrine.** The doctrine records that
> the census **cannot express "must be zero"** and **cannot assert an absence**.
> This is the third member of that family and it is the mirror of the first:
> **the census cannot ratchet a condition at 100% prevalence**, because the
> mandatory positive control has nothing to match. A condition at 0% and a
> condition at 100% are both unratchetable, for symmetric reasons — and the
> second is the more dangerous, because it is exactly the shape of a practice the
> project has never adopted at all.

The other candidates, each measured before rejection:

- *`cargo install X --locked` without `--version`* — **3 violating** (`audit.yml:38`,
  `ci.yml:310`, `security-audit.sh:53`), plus 2 in docs; **1 compliant**, in a
  markdown file, and it is a range (`^2`) not a pin. A 3-site rule whose control
  is a doc line is not a ratchet.
- *`npx <pkg>@latest`* — **3 violating**, all `@sentry/cli` in one file;
  **0 compliant** anywhere. Same wall as the main candidate, smaller.
- *the deprecated `deny.toml` keys* — 1 file, 3 lines, and the *right* fix
  deletes the condition rather than counting it.

**Checked for overlap** across all 191 registered rules: four touch `.github` or
YAML (`env-default-conflates-unset-with-empty`,
`config-value-frozen-at-compile-time`, `unverifiable-generated-artifact`,
`verification-that-cannot-fail`); none matches a `uses:` line, and none has this
leaf as its `goldenPath`. Nothing to extend.

**The instrument that would work — specified, not written.**
`scripts/check-action-pins.mjs`, in `npm run check`:

```
parse every .github/workflows/*.yml
for each `uses:` value:
    ref := part after the last '@'
    if ref does not match /^[0-9a-f]{40}$/  -> violation (unless allowlisted with a reason)
assert  refs_seen  >= FLOOR      # else: "the parser is broken, not the workflows clean"
exit 2 if refs_seen == 0
```

The `refs_seen >= FLOOR` precondition is the load-bearing part and is copied
from the census engine's own floor assertion, for the reason
[`adding-a-ci-gate`](./adding-a-ci-gate.md) documents at length: this repository
already contains a secret scan that exits 0 when its scanner is absent. A pin
checker that finds no workflows reports perfect pinning.

**And the type that outranks the gate.** Per the contract: the strongest fix does
not count violations, it makes the wrong reference unspellable. GitHub offers
this directly — an **organisation/repository ruleset restricting Actions to
SHA-pinned references** refuses the workflow at run time, needs no script, and
cannot go stale. Where that is unavailable, Renovate's `pin`/`digest` rule
(already written at `renovate.json:14`, already set to `automerge: true`) does
the same job continuously — which makes 7.E the highest-leverage fix in this
document: **enabling one GitHub App would close 56 of the findings above without
anyone writing a gate.**

---

## §12 — Corrections

### 12.1 — Owed to [`release-pipeline`](./release-pipeline.md) §5/§7: the disarmed pipe has never been reached

That path records — correctly — that `audit.yml:44` runs
`cargo deny check 2>&1 | tee security-results/cargo-deny.txt` and that GitHub's
default shell is `bash -e {0}` with **no `pipefail`**, so the pipeline's exit
status is `tee`'s. I verified the shell independently: the raw job log of run
`32025966929` prints `shell: /usr/bin/bash -e {0}` for every `run:` step.

**The sharpening: that step has never executed.** It is `skipped` on **23 of 23**
lifetime `audit.yml` runs, because `Run security audit` fails first and nothing
in that workflow carries `if: always()`. So the defect is real in the source,
would fire the moment the workflow is repaired, and has contributed **zero** to
the current outage. The dispatch brief presented it as the leaf's disarming
mechanism; the actual mechanism is 7.A (a config the engine cannot parse) and
7.B (a step ordering that never reaches it). **A latent defect and an active one
look identical in a source read and completely different in a run log.**

### 12.2 — Correcting my own brief: "test whether anything enforces that Renovate bumps are evaluated"

The brief asked whether anything enforces the *"evaluated, never blind-merged"*
posture. The question does not arise: **Renovate has never run** (7.E), so there
is nothing to evaluate and nothing to blind-merge. The enforceable half of the
config — `automerge: true` for `patch`/`pin`/`digest` — is the part that would
have merged *without* evaluation, and it too has never fired. Both halves of the
policy are inert, in opposite directions.

### 12.3 — `convergence: converged` fails — and it fails by INVERSION: the fleet has the answer and this repo is behind

The label is wrong, and it is wrong in the rarest and most useful direction the
oracle produces. Cohort established at measurement time (2026-08-17):

**On action pinning, the fleet converged on the disease.** `uses:` references
that are SHA-pinned, across all six repos:

| repo | `uses:` refs | SHA-pinned |
|---|---:|---:|
| personas | 56 | **0** |
| brainiac | 19 | **0** |
| vibeman | 17 | **0** |
| personas-web | 5 | **0** |
| ascent | 4 | **0** |
| **total** | **101** | **0** |

Per the doctrine: *perfect agreement on an omission is evidence the situation is
universal and evidence against an answer existing to adopt.* Report it as
silence; do not read 5/5 as confirmation.

**On dependency policy, the exact opposite — and this is the finding.**
`../brainiac/deny.toml` (written `a5b553b`, 2026-07-30; refined `67e4ef1`,
2026-08-05 — **four months after** this repo's, by the same author) answers
**every** defect in §7.A and §7.D, explicitly and with reasons:

| this repo's `deny.toml` | `brainiac`'s |
|---|---|
| `[graph]` — targets only | `all-features = true`, `exclude-dev = false`, and a paragraph on why the four targets are a pruning and not a suppression |
| `vulnerability = "deny"` (key removed upstream) | absent — modern schema |
| `unmaintained = "warn"` → **parse error** | `unmaintained = "all"` — the enum, with the reason ("unmaintained transitive crypto/parsing crates are exactly the risk here") |
| `yanked = "warn"` | `yanked = "deny"`, with the reason |
| `ignore = []` | one entry: RUSTSEC-2023-0071, dated, with a reachability analysis naming the single call site and the condition for removal |
| `allow = [12 licenses]`, no attribution | 14 licenses, each annotated with the crate that needs it, *"derived from `cargo deny list`, not from a template"* |
| `[bans] deny = []` | two named crate bans (`openssl-sys`, `openssl`) with architectural reasons |
| `wildcards = "deny"` | `"warn"` with a written, verified justification and the exact edit that would restore `"deny"` |
| no `allow-registry` | explicit |

And its workflow is the design this leaf needs, twice over:

- **`taiki-e/install-action@v2 with tool: cargo-deny`** — a prebuilt binary
  rather than `cargo install --locked`, so the compile is not on the critical
  path (7.A's failure mode is still latent there, since `@v2` is mutable).
- **its `npm-audit` job runs no `npm ci` at all**, with the reason recorded and
  marked verified: *"`npm audit` resolves the tree from the lockfile, so there is
  no `npm ci` here."* That single design choice **immunises it against precisely
  the failure that has taken this repo's weekly audit offline for 23 consecutive
  weeks** (7.F).

Outcome: `brainiac`'s `security.yml` is **39 runs, 12 successes**. This repo's
two supply-chain paths are **350 runs, 0 successes**.

Three consequences, stated as the doctrine requires:

1. **This is not "Personas is ahead of the fleet."** It is the inverse, and the
   inverse is rarer and more actionable: the operator already solved this
   problem, later, elsewhere, and never backported it. Per the contract's
   *"prefer the primitive that exists"* — the fix for 7.A is not to invent a
   policy but to **port `../brainiac/deny.toml`'s schema and its two workflow
   choices**, which is why deferred fix **#106** names that file.
2. **`brainiac` is a sibling, not a witness, on the registry side** (it consumes
   this repo's tooling elsewhere — see
   [`documentation-sync`](./documentation-sync.md) §12.3) — but here it is
   neither. It is a **cost/failure/inversion** observation: the same engineer,
   given the same problem four months later, wrote something materially better
   and left the original to rot. That is the strongest evidence class the oracle
   produces, and shared authorship does not weaken it.
3. **A single enum field cannot carry this verdict**, for the same reason the
   doctrine already records: `converged` is *true* about action pinning (on the
   disease) and *inverted* about dependency policy. Add to the ledger as the
   **fifteenth tested `converged` and the fifteenth failure**, in a mode worth
   naming: **the fleet's best answer is in a sibling and the leaf's home repo has
   the worst copy of it.**

### 12.4 — `sides: "server"` — upheld, and the mechanism is worth naming

Every artifact in this leaf is a build-time or CI-time control: two workflows, a
TOML policy, two lockfiles, a shell script, a Renovate config, a Gradle wrapper.
**No part of a supply-chain policy can live on a client**, for a structural
reason: the client is the artifact the policy exists to protect, and a control
that ships inside the thing it guards can be removed by whoever removes the
thing. Named here because the doctrine asks for the mechanism whenever the label
survives — this is the third `sides` upholding, and the first that is not about
the DOM.

### 12.5 — Two implementations, and where they disagreed

- **Cargo.lock** counted by `grep -c '^\[\[package\]\]'` (1,010) and by a
  block-splitting parse tracking `checksum`/`source` per stanza (1,010; 1,004
  with checksum; 5 path crates; 1 git). Agreement, including membership.
- **`uses:` references** counted by `grep -rho 'uses: *[^ ]*' | sort | uniq -c`
  (56, 11 distinct) and by a per-file line enumeration across the 7 workflows
  (56). Agreement. Hand-verified all 56 for the pinning claim — precision 56/56.
- **The one genuine disagreement was with myself, and it was the useful one.**
  My first oracle pass concluded *"no sibling has a `deny.toml`"* from the shape
  of the problem, before running the sweep. `brainiac` has one, and it is better
  than this repo's in nine distinct respects (§12.3). The claim was drafted, then
  measured, then inverted. **A sweep you did not run returns whatever you already
  believed** — and it returns it in the confident register of a measurement.
