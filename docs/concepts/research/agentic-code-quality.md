# Adoption review — Addy Osmani, "Agentic Code Quality"

> Source: <https://addyo.substack.com/p/agentic-code-quality> (2026-08-08, ~2,500 words,
> not paywalled; sponsored by Sonar). Read in full, including the three diagrams — which
> carry more concrete mechanism than the prose does. Assessed 2026-08-13 against `master`
> @ `2a874e692` (a parallel session advanced it to `5dac80f19` mid-review; see §3.3), with
> four ground-truth audits of CI, hooks, lint rules, test tooling, and all 18 golden paths.
> Every repo claim below traces to a file, a script exit path, or a `gh run` query, not to
> memory — one claim that did not is dissected in §3.3.
>
> **Verdict in one line:** his mechanism list is mostly *weaker* than what we already
> designed in golden-path §9 — but the article's framing exposes that our problem is no
> longer gate *design*, it is gate *installation and liveness*, and on that axis we are in
> worse shape than we thought. **Our CI has not passed once in the last 60 runs
> (2026-07-29 → 2026-08-12: 40 failures, 20 cancelled, zero successes).**

---

## 1. His mechanisms, enumerated

The prose names constraint families loosely. The three diagrams are where the concrete
list lives, so they are the primary source below. Grouped as he groups them.

### A. The pipeline — constraints by *when* they apply ("the software factory")

| # | Mechanism | What it is |
|---|---|---|
| M1 | **Scoped subtasks** | Decompose intent into units small enough that one unit's blast radius is knowable before work starts. |
| M2 | **Risk boundaries** | Declare up front which areas a given piece of work is allowed to touch. |
| M3 | **Intent + context supplied to the agent** | Issue/spec/goal plus the repo context the agent needs, so failures are not caused by missing information. |
| M4 | **Sandbox + reproducible build** | An environment where the agent can act, get trustworthy feedback, and fail without doing damage. |
| M5 | **Tests, types, diagnostics available in-loop** | The agent iterates against real signals while working, not after. |
| M6 | **Mechanical back-pressure** | Deterministic checks the model cannot argue with, firing during the work. |
| M7 | **Acceptance + QA at the boundary** | Business-level verification before the change can cross into production. |
| M8 | **Security scanning at the boundary** | Late-stage SAST / deps / secrets before shipping. |
| M9 | **Release gate (CI)** | The last line: CI declines to deploy. Explicitly the *weakest* place to put a check, not the strongest. |
| M10 | **Human reviews the exceptions only** | Escalate on weak evidence, novelty, or risk; do not put a human in the synchronous path of a machine-speed system. |
| M11 | **Incident → new test, monitor, or policy** | Production is monitored and every incident feeds back a durable artefact into the *shape* stage. |

### B. The dimensions — constraints by *what* they protect ("set the constraints")

| # | Mechanism | His named implementation |
|---|---|---|
| M12 | **Correctness** | unit + property + **mutation** testing |
| M13 | **Security** | SAST, dependency scanning, secret scanning |
| M14 | **Performance** | perf budget, load |
| M15 | **Accessibility** | axe, contrast, keyboard |
| M16 | **Maintainability** | coverage, complexity |
| M17 | **Cost efficiency** | token / compute budget |
| M18 | **Comprehensibility** | review, answerability |
| M19 | **Schema contracts** | named in the diagram caption as a first-class deterministic check |
| M20 | **Code-quality metrics** | cyclomatic complexity, line length |
| M21 | **Type safety** | "compilers rejecting invalid code" |
| M22 | **Architecture rules in the linter** | "architecture rules that linting tools like ESLint can enforce", with hooks to pull in agents or humans when they break |

### C. Autonomy — constraints by *who decides* ("autonomy is earned")

| # | Mechanism | What it is |
|---|---|---|
| M23 | **Classify every change into three lanes** | On risk × evidence × track record: *routine/proven* → agent proceeds alone; *non-trivial, real blast radius* → auto-checks + targeted review; *novel/high-risk, weak evidence* → human decides. He names the human-decision set explicitly: **auth, permissions, money, migrations, irreversible**. |
| M24 | **Autonomy ratchets on demonstrated success** | "a property of the task, the evidence and the harness, not the model's reputation, and not a permanent setting." |

### D. Scaling — what to do when verification saturates

| # | Mechanism | What it is |
|---|---|---|
| M25 | **Push verification early and throughout** | Never a single review at the end; that builds a queue moving at human speed. |
| M26 | **Three levers when volume exceeds capacity** | (a) scale the verification system, (b) throttle the rate of agent-generated change, (c) deliberately lower the bar. Be ready to use all three. |
| M27 | **Asymmetric constraint strength** | Tight where you care most, deliberately loose elsewhere — that is how throughput is bought without losing quality. |
| M28 | **Retire constraints serving neither quality nor delivery** | "Don't support them if they're not serving one or both." |

### E. From the Sonar section (sponsored, but the mechanisms are real)

| # | Mechanism | What it is |
|---|---|---|
| M29 | **Quality gate as policy on *new* code** | The screenshot's conditions: Security Rating A, Maintainability Rating A, **Coverage ≥ 80% on new lines**, **Duplications ≤ 3% on new lines**. Not a whole-repo bar. |
| M30 | **Deterministic cross-file analysis instead of an LLM reviewer** | The article's sharpest line: he had an agent review an app twice and got two answers, a third on re-run — "**You can't gate a merge on a coin flip.**" |
| M31 | **Intended architecture vs current architecture → deviations** | An explicit drift ledger as a product surface. |

### F. What he warns against

- **W1** LLM output as a merge gate (M30).
- **W2** A human check inside a machine-speed system — "don't be surprised if that impacts productivity."
- **W3** End-of-pipeline-only verification.
- **W4** Quality as a single metric.
- **W5** Constraints that serve neither quality nor delivery.
- **W6** The shared human/agent failure modes: "brittle environments that don't hold up under script-driven stress, nondeterministic builds, missing permissions, and weak tests."
- **W7** Guillermo Rauch's list (reproduced as a figure): you may skip reading the code if you're a beginner / it's throwaway / prototyping / **no users or revenue** / taking on debt & risk knowingly / problems are basic. Osmani's caption: "every 'yes' is really a statement about how low the stakes are… If it isn't you on every diff then it has to be the constraints."
- **W8** "**A passing test is a claim, not a verdict**" (diagram, boundary stage).
- **W9** Raised in the comments and *not answered by the article*: the comprehensibility trap (humans lose the ability to debug during an outage) and **architectural drift** — "individual changes can satisfy every constraint while, over time, the overall system slowly moves in the wrong direction."

---

## 2. Have it / missing / not applicable

| # | Mechanism | Verdict | Evidence |
|---|---|---|---|
| M1 | Scoped subtasks | **Have, working** | Context map (`context-map.json`), situation spine, per-skill scoping. Genuinely good. |
| M2 | Risk boundaries | **Have as prose, no mechanism** | CLAUDE.md declares worktrees mandatory for multi-file work and "never `git stash`", but **`.claude/settings.json` has exactly one hook (Stop → doc-sync) and `permissions.deny` is empty**. No `PreToolUse` hook exists at project or user level. The 2026-05-09 stash incident that produced the policy could recur today unimpeded — and CLAUDE.md itself records that the *recovery commit for that incident* fell into the adjacent trap (staged 18 files from a parallel session). |
| M3 | Intent + context | **Have, working** | `.claude/conventions.json` is a machine-readable statement of hard gates written precisely so a portable skill can parse it. Ahead of the article. |
| M4 | Sandbox + reproducible build | **Partial** | Reproducibility actively engineered: `ensure-ort-cache.mjs` self-heals the ort machine-type drift, `check-build-cache.mjs` detects host-triple drift. But agents work directly on the checkout (worktrees are prose-mandated, not enforced) and the known-brittle spots (port 1420 orphaned Vite, `cargo test` exit 127) are documented workarounds, not removed hazards. |
| M5 | Tests/types/diagnostics in-loop | **Have, working** | `npm run check`, `tsc --noEmit`, vitest all runnable in-session. |
| M6 | Mechanical back-pressure during work | **Weak** | pre-commit is `npx eslint --quiet --no-warn-ignored --max-warnings 99999` — `--quiet` drops warnings *before* the tally, so the 99999 is dead weight twice over. Only the 3 error-level rules bite. No Rust gate in any hook. |
| M7 | Acceptance + QA at boundary | **Exists, unwired** | 232 Playwright tests drive the real app via :17320; **run by nothing automated**. `e2e-smoke.yml` is `pull_request`-only *and* `continue-on-error: true`. Four whole Vitest lanes (cli/e2e/integration) are wired to nothing. |
| M8 | Security scanning | **Partial, with holes** | `cargo-deny` blocking in `ci.yml` (good); CodeQL blocking on PRs — but **we never open PRs**, so only its weekly cron leg has ever run, and it is `javascript-typescript` only. `cargo audit` / `npm audit` are weekly-cron-only, never gate a merge. `secret-scan.mjs:25` exits 0 when gitleaks is absent. `audit.yml:44` pipes `cargo deny check` into `tee` without `pipefail`, so **`tee`'s exit status is the step's status** — cargo-deny cannot fail that job. |
| M9 | Release gate (CI) | **Broken — see §5.1** | Zero CI successes in 60 runs. `release.yml` has no `needs:` on CI and itself runs no tests, lint, clippy, or typecheck. |
| M10 | Human reviews exceptions | **N/A in form, missing in substance** | There is no second human; the operator *is* the exception queue. But nothing computes *which* changes are exceptions — see M23. |
| M11 | Incident → test/monitor/policy | **Partial, policy-only** | We reliably convert incidents into *prose policy* (the parallel-safety primitives, the `--features desktop` comment in `ci.yml:251-257`). We do **not** reliably convert them into tests: the `/sentry` skill's fix phase (3.4 Apply the fix → 3.5 Commit) has no "add a failing regression test first" step. |
| M12 | Correctness: unit / property / **mutation** | **Unit ✅, property 🟡, mutation ❌** | ~3,688 TS `it()` + ~4,335 Rust tests. `proptest` exists but in exactly one file (`src-tauri/tests/render_plan_proptest.rs`), root crate only. **No mutation testing of any kind** — so the effectiveness of ~8,000 tests is entirely unmeasured. |
| M13 | Security dimension | see M8 | — |
| M14 | Performance | **Have (bundle), missing (runtime)** | `check-bundle-budget.mjs` is a real blocking gate (850 KB/chunk, 5000 KB total) and fails loudly if `dist/assets/` is absent. One hole: an *empty* `dist/assets/` yields 0 chunks, 0 violations → "PASS". Runtime perf tooling exists (`perf-nav-walk.spec.ts` + `render-perf-report.mjs --diff`) with **no threshold and no gate**. |
| M15 | Accessibility | **Partial** | `check-themes.mjs` enforces WCAG AA on 4 text pairs (blocking) — genuinely good, and better than "contrast" in his diagram. But no `eslint-plugin-jsx-a11y`, no axe. `role-button-requires-keydown` is error-level (and **untested**). A token that fails to resolve renders `n/a` and is counted as neither pass nor fail — a deleted token silently leaves the audit. |
| M16 | Maintainability: coverage + complexity | **Both missing** | **Zero coverage instrumentation** in either language — no `@vitest/coverage-*` installed, no `cargo-llvm-cov`, no thresholds, no reporting. Notably `.ai/doctor.mjs:84` *knows* how to check a `coverage` control and `.ai/manifest.yaml:50-52` simply omits it, so the conformance gate passes green over the absence. **Zero complexity or size limits**: no `max-lines`, no `complexity`, no `clippy.toml`. `commands/core/data_portability.rs` is 12,704 LOC. |
| M17 | Cost efficiency (token/compute budget) | **Not applicable as a merge gate** | We have cost observability as a *product* feature (model+thinking stamping, per-capability tiers). There is no shared agent fleet whose budget a gate would protect; the dev loop is one operator's subscription. Skip. |
| M18 | Comprehensibility | **Missing, and he offers nothing** | "review, answerability" is not a mechanism. See §3.5. |
| M19 | Schema contracts | **Have — our strongest area, ahead of him** | `check-command-contract.mjs`, `check-event-registry.mjs`, `check-error-registry-parity.mjs`, `check-tauri-configs.mjs`, the `command-name-drift` and `binding-drift` CI jobs, and the `render_plan` golden-fixture approval tests. Real hole: `binding-drift` uses `git diff`, which **cannot see untracked files**, so a brand-new `#[ts(export)]` type escapes it. (`check-event-registry.mjs` is *not* a hole — see §3.3.) |
| M20 | Cyclomatic complexity / line length | **Missing** | Same as M16. |
| M21 | Type safety | **Have, strong, one gap** | `strict: true` + `noUncheckedIndexedAccess` (unusual and valuable); only 51 `any` and 2 `@ts-expect-error` across `src/`. Gap: `tsconfig.json` **excludes `src/test`**, so 401 test files are never typechecked by the gate. |
| M22 | Architecture rules in the linter | **Have the rules, they enforce nothing** | 21 custom rules: **3 error, 17 warn, 1 off**. CI runs bare `eslint src/` with no `--max-warnings`. The shared/-layer boundary rules are `warn` with a config comment reading "This is an ADVISORY warning, not a build gate". `check:catalog-boundary` *would* exit 1 and is wired to nothing. |
| M23 | Three-lane risk classification | **Missing — and it is the biggest conceptual gap** | CLAUDE.md's PR self-review says "Security-sensitive edits (crypto/vault/connectors/IPC commands) are flagged for human review" — a policy with no mechanism, no lane definition, and no escalation path. His human-decision set (auth, permissions, money, **migrations**, irreversible) maps almost exactly onto our highest-risk surfaces. |
| M24 | Autonomy ratchets on evidence | **Missing** | Agent autonomy here is uniform and permanent regardless of the change's blast radius. |
| M25 | Verification early and throughout | **Have the intent, inverted in practice** | Our heaviest real gate is CI (the latest possible point) and our earliest gate (pre-commit) is the most neutered. |
| M26 | Three levers at saturation | **Missing — see §3.2** | We are visibly saturated and have not pulled any lever. |
| M27 | Asymmetric constraints | **Have, implicitly** | The 3 error-level rules are roughly the right 3. But it is asymmetry by accident, not by policy. |
| M28 | Retire non-serving constraints | **Missing** | Live orphans: `check-literal-parity.mjs` (**no `process.exit` anywhere — pure report, always 0**, and called by nothing), `check-route-sections.mjs`, `verify-resource-scoping.mjs`, `check:catalog-boundary`, `check:dead` (knip), `test:rust`, `test:rust:crates`, 3 Vitest lanes, 5 Playwright scripts. |
| M29 | Quality gate on **new** code | **Have the pattern, missing the metrics** | We invented this independently and better — §9's baselines "fail up *and* down", ratchets, `WRAPPER_EXEMPT` tables with mandatory prose reasons. We just don't have coverage or duplication as the *quantities* being ratcheted. |
| M30 | Deterministic analysis, not LLM review | **Have, by design** | Our LLM outputs are proposal-gated (knowledge library, idea funnel, KPI adjustments all require human accept). Correct posture — with one caveat in §3.3. |
| M31 | Intended vs current architecture → deviations | **Have, and richer than his** | Golden-path §7 Deviations → `violating` cells in `workspace_practice_context_state`. ~766 deviation entries across the 18 paths. This *is* Sonar's architecture view, hand-built, with better evidence (`path:line`). |

---

## 3. Where he and §9 disagree — adjudicated

### 3.1 Gate-per-*situation* (us) vs gate-per-*dimension* (him) — **split the difference; this is the real adoption**

His model is a handful of universal engines applying one policy everywhere: coverage %,
duplication %, complexity, security rating. Ours is one bespoke gate per situation:
across 15 of 18 paths, §9 proposes **12 ESLint rules, 13 standalone check scripts, 8
tests, 4 hook wirings, 0 new CI jobs**.

**We are right about precision and he is right about scale.** Our own numbers settle the
first half: generic, broadly-scoped rules score terribly here —
`custom/no-unmanaged-effect-resources` is **precision 0/3, recall 0/3** over 4,829 files;
`custom/enforce-base-modal` has **recall ≈1/46 and precision 0/8**. Situation-specific
signals score near-perfectly: `#[requires(…)]` adjacency is **237/237**, `role="columnheader"`
4 true positives in 6 files, the `X instanceof Error ? X.message : String(X)` shape 176
exact hits with near-perfect precision. A generic complexity threshold would never have
found the async-`#[requires]` hole. **Do not trade our signal discipline for his generality.**

But the scaling arithmetic is against us. `situation-spine.json` declares **247
situations**, each destined for one golden path. We have written 18. At the current rate
of ~2 gates per path that is **~460 bespoke gates** — and we cannot presently keep *13*
wired scripts alive next to *~9* orphaned ones. 460 hand-maintained `.mjs` files is the
exact "verification system that cannot consume the volume" he describes.

**Adjudication:** keep §9's per-situation signal discovery unchanged. Change the
*mechanism* clause: a golden path should not propose a new standalone script when it can
propose a **declarative rule entry** — pattern + floor + allowlist + baseline + fail-loud
assertions — consumed by one shared census runner. Installing gate #37 should cost a JSON
entry, not a new file with its own argv parsing and its own way of exiting 0.

### 3.2 He says relax and retire constraints; §9 has no verdict for "not worth it" — **he wins, add the fourth outcome**

§9 permits "if no gate is possible, say so and say why", and 8 paths correctly use it. But
no path may currently conclude *a gate is possible and we decline it*. Every path must
propose. That produces the queue we are in: 18 paths have generated ~33 gate proposals and
**zero are installed**, while ~9 previously-written checkers sit unwired.

That is precisely his M26 saturation state, and we have pulled none of his three levers.
**Adopt M28 explicitly:** add a fourth §9 outcome — *gate declined (cost > value)* — with
the same evidentiary burden as the other three. And adopt M26(b): **throttle golden-path
composition until the installation lane is drained.** Composing path #19 while 33 gates
queue unbuilt is generating verification artefacts we cannot consume.

### 3.3 "You can't gate a merge on a coin flip" — **we agree, and must extend it one step further than he does**

Nothing in our blocking path calls an LLM; ingestion is proposal-gated. Correct.

But his warning generalises past merge gates in a way that touches us directly: **the ~766
deviations, and every precision/recall figure in §9, are LLM-produced censuses.** The
`form-field-and-validation` path already carries a dated correction retracting its claim
that `eslint-rules/` has no tests (12 of 21 are covered). Two golden paths currently
justify choosing `"error"` severity by citing a **~10,086-warning lint baseline that is
~20× stale** — the real figure was ~493 as of 2026-07-02 (`ship-loop/state/state.md`),
measured at ~700–1,300 today, because `no-raw-spacing-classes` was switched off. A gate's
*severity* was chosen from a stale number.

**This review demonstrated the failure on itself, live.** The first draft of §2 (M19)
repeated a claim taken from `client-state-persistence.md` §9 — that
`check-event-registry.mjs` prints `Event registry OK (0 Rust events…)` and exits 0 when
its Rust regex matches nothing. **It is false.** Reading the script: if `rustEvents` is
empty, every TypeScript event falls into `missingInRust`, and it `process.exit(1)`s at
`:50`. It fails correctly. (The only vacuous path requires *both* sides to parse to empty
simultaneously, and the TS side is separately guarded at `:24-27`.) A parallel session
caught and corrected the same false claim in commit `5dac80f19` while this document was
being written — the composer had asserted it, a reviewer had repeated it to the operator
twice as evidence, and this review inherited it a fourth time without opening the file.
Four independent agents propagated one unverified sentence. That is precisely the coin
flip he warns about, one level upstream of the merge gate.

**Adjudication:** make it a §9 rule that **the gate must mechanically re-derive its own
counts**, and that **no apply-wave may act on a §7 deviation list its §9 gate has not
reproduced**. Most paths already do this via floor assertions; make it explicit rather
than incidental. Add the corollary the incident above teaches: **a §9 precedent citation
is a claim about a specific file's exit path and must be verified by reading that file** —
citing another path's finding is not evidence.

### 3.4 "A passing test is a claim, not a verdict" — **we are ahead of him, keep our position**

§9's fourth clause ("how it fails loudly if its own precondition is absent") **has no
analogue anywhere in the article.** His entire model presumes gates work when green. We
have empirical proof they do not, and our best paths encode defences he never considers:
`ipc-command-authorization` demands *separate* `sync_checked >= 70` and `async_checked >= 80`
counters because "a single combined counter would let the async walk break silently";
`timestamp-storage` makes its behavioural test **throw when `getTimezoneOffset() === 0`**
so it cannot pass vacuously on a UTC runner; `schema-change` insists success print its
audited totals because "a gate whose success output is silence is a gate nobody notices
going hollow."

Mutation testing (his M12) validates *tests*. Nothing in his article validates *checkers*.
§9 does. **This is our contribution and we should not dilute it — we should export it:**
every mechanism we adopt from him gets a §9-style precondition assertion bolted on before
it lands. Diff-coverage that reports 100% because it saw zero changed lines is the same
bug as a secret scan exiting 0 without gitleaks.

### 3.5 Comprehensibility and architectural drift — **he ducks it; we have half the answer**

The top comment asks how to preserve comprehensibility and prevent architectural drift.
The article does not answer. We are further along: golden-path §7 → `violating` cells is a
working drift ledger, and it is closer to Sonar's "intended vs current architecture" than
anything he prescribes. What we lack is the *trend* — drift is currently a snapshot per
path, with no measure of whether it is widening. That is the natural second use of the
census runner in §3.1.

### 3.6 Guillermo's list, applied honestly

Every "yes" on that list is a statement of low stakes: beginner, throwaway, prototype, no
users, no revenue, basic problems. This repo has users, an AES-256-GCM credential vault,
irreversible migrations, and a signing surface. **Every item is false here.** So by his
own test something must read every diff. There is no second human. Therefore the
constraints must — and today they are red, decorative, or unwired.

---

## 4. What's missing, ranked by value ÷ cost

| Rank | Adopt | Value | Cost | Why this ratio |
|---|---|---|---|---|
| **1** | **Make CI report at all.** Fix the `npm ci` lockfile drift; add `if: always()` to every gate step in `ci.yml` so one red step stops hiding the other eleven; get master green. | Extreme | Hours | Nothing else on this list matters while the boundary gate is dark. §5.1. |
| **2** | **`PreToolUse` deny hook for the parallel-safety primitives** — block `git stash`, `git add -A`, `git add .`, `git add -u`; warn when `git diff --cached --stat` exceeds explicitly added paths. | Very high | ~1 hour | Converts our most safety-critical prose policy into the only kind of thing that has ever held a line here. A documented data-loss incident *and* a documented recurrence during its own recovery. This is his M2 and "fail without doing much damage" for the price of one hook. |
| **3** | **`--workspace` on `cargo test`; `--workspace --features desktop --all-targets` on `cargo clippy`.** | Very high | 2 lines + the fallout | Reactivates four crates' unit tests and the Rust tree's *only* static analysis. Two golden-path gates (`boot-migration-step`, `schema-change`) say outright their gate "runs nowhere" without it. |
| **4** | **Duplication metric on changed files** (M29). | High | Low — one dev-dep + threshold | Aims directly at our #1 measured failure mode. "Thousands of hand-rolls" *is* a duplication number, and we have never once measured it. Ratchet on new code only, exactly as §9 already does with baselines. |
| **5** | **Three-lane risk classification of the diff** (M23). A script mapping touched paths → lane; `crypto/`, `vault/`, `ipc_auth.rs`, `db/migrations/`, `signing/` → *human decides*. | High | Low–medium | We already own the path list in prose. This is the mechanism that makes "the operator is the exception queue" real instead of aspirational, and it is the article's best idea. |
| **6** | **Wire or delete every orphan** (M28). | High | Low | ~9 live orphans. `check-literal-parity.mjs` audits exactly the failure mode `ipc-command-authorization` §7-D describes and **has no exit code at all**. Either it gates or it goes. |
| **7** | **Diff coverage** (`@vitest/coverage-v8` + threshold on changed lines only, plus the same for Rust later). | Medium–high | Medium | His 80%-on-new-lines, adapted. Do **not** adopt a whole-repo threshold — with ~8,000 tests and zero instrumentation that is a months-long project with unclear payoff. |
| **8** | **Scoped mutation testing** (`cargo-mutants` over `ipc_auth`, `crypto`, `db/migrations` only). | Medium–high | Medium | The one mechanism of his we lack entirely that measures something we cannot otherwise see: whether ~8,000 tests actually catch anything. Scope it to the surfaces where a silent test is most expensive. |
| **9** | **`max-lines` / complexity ceilings on newly-added files only.** | Medium | Low | Won't touch `data_portability.rs` (12,704 LOC) and shouldn't try. Prevents the *next* one. |
| **10** | **Promote earned rules to `error` + `--max-warnings 0` on changed files.** | Medium | Medium — must fix precision first | Sequencing is load-bearing: promoting `no-hardcoded-jsx-text` or `enforce-base-modal` as they stand would enforce a rule that measurably does not work. Fix, then promote. |
| **11** | **Regression test as a required output of every incident fix** (M11) — one step in `/sentry` §3.4. | Medium | Very low | We already do incident → *policy* well; this closes the loop to incident → *test*. |
| **12** | `eslint-plugin-jsx-a11y` (M15). | Medium | Low–medium | Genuine gap, but contrast is already gated and the app is single-user desktop. Real, not urgent. |
| **13** | Frontend property testing (`fast-check`). | Low–medium | Medium | `proptest` earns its keep on `render_plan`; there is no comparable invariant-dense frontend surface yet. |
| — | Token/compute budget (M17), load testing, canary/progressive rollout | **N/A** | — | No agent fleet budget to protect; no server fleet to canary. The desktop analogue (staged installer rollout + Sentry) already exists. |

---

## 5. What we are currently doing wrong — the highest-value section

Ordered by severity. Each is something the article explicitly warns about.

### 5.1 CI has not passed once in 60 runs — and its topology hides which gates would have passed

`gh run list --workflow=ci.yml --limit 60`: **40 failures, 20 cancelled, zero successes,
spanning 2026-07-29 → 2026-08-12.** `audit.yml` likewise has no success in its last 40
runs. The only green workflow anywhere is CodeQL's weekly cron.

Worse than the redness is the **topology**: GitHub Actions steps are sequential, and no
gate step in `ci.yml` carries `if: always()`. On run `31586012551`, `npm ci` failed on
lockfile drift (`Missing: @emnapi/runtime@1.11.3`) and **all eleven downstream frontend
gates were skipped** — typecheck, lint, i18n, error-registry, themes, tauri-configs,
tiers, build, bundle-budget, unused-bindings, vitest. In `rust-tests`, `cargo test` failed
and **clippy and cargo-deny were skipped**. The single green job was `command-name-drift`.

So the effective merge gate on this repo today is one drift check — and a permanently-red
signal is indistinguishable from no signal, because nobody can act on it. This is his W6
("brittle environments… an agent can get feedback it can trust") and M9 failing together.

**And the production boundary is open:** `release.yml` declares no `needs:` on CI and runs
no tests, no lint, no clippy, no typecheck of its own. A red CI does not block a release.

### 5.2 The i18n rule that CLAUDE.md marks MANDATORY is blind to most of what it claims to catch

`eslint-rules/no-hardcoded-jsx-text.cjs:83`:

```js
if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed) && trimmed.length <= 20) return true;
```

**Any single word of ≤20 characters is exempt.** `<button>Save</button>`,
`<span>Failed</span>`, `<h2>Settings</h2>` — invisible. Only multi-word strings are
caught. This is the rule CLAUDE.md's most emphatic section is built on ("Hardcoded English
strings in JSX are a bug, not a shortcut"), it is `warn` and therefore cannot fail
anything anyway, and it does not detect the most common case. A textbook §9 "gate that
manufactures confidence" — sitting in our most-cited convention.

### 5.3 Three workflows are `pull_request`-only in a repo that never opens pull requests

`ci.yml:4-7` documents that development lands directly on master. Therefore
`ai-conformance.yml` (never runs), `e2e-smoke.yml` (never runs, and `continue-on-error`
regardless), and CodeQL's PR leg (never runs) are dead. Combined with clippy never
executing, **the Rust tree currently has zero static analysis of any kind** — CodeQL is
`javascript-typescript` only by design, deferring Rust to the clippy step that does not run.

Even if it ran, `ci.yml:261` is `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:
no `--features desktop`, so every `#[cfg(feature = "desktop")]` block is invisible and the
build script aborts on `updater:default` before linting a line; no `--workspace`, so the
four extracted crates are unlinted. There is also no `cargo fmt --check` anywhere.

### 5.4 Our conformance meta-gate certifies gates by substring match

`.ai/doctor.mjs` is blocking on pre-push and is the thing that tells us our controls are
wired. Its pre-push check (`doctor.mjs:84-90`) is a lowercase **substring match against
the hook file**: the `test` control is satisfied by the literal text `test:evals`; `lint`
by the substring `eslint`; `scan-secrets` by the word `gitleaks` — **regardless of whether
gitleaks is installed on the machine**, which `secret-scan.mjs:25` then exits 0 without.
It runs without `--run`, so declared capabilities are checked for the existence of a
non-placeholder string and never executed; `.ai/manifest.yaml:20-25` still carries
`verified: false` on all six. And `doctor.mjs:84` demonstrably knows how to check a
`coverage` control that `manifest.yaml:50-52` simply omits — so the gate that audits our
gates passes green over zero coverage, an uninstalled scanner, and unverified capabilities.

A meta-gate that cannot distinguish "wired" from "present as a string" is the highest-order
version of the failure §9 was written against.

### 5.5 We are documenting mechanisms as automatic that are not installed

CLAUDE.md states that operator selects are "captured automatically by a PostToolUse hook,
and every prompt he types plus what your turn did with it by a UserPromptSubmit + Stop hook
pair — **no session action needed for either**." No such hooks exist in
`.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`, or
`~/.claude/settings.local.json` — the only registered hook in the project is Stop →
`check-doc-sync.mjs`. The ledger's most recent entry is 2026-08-08.

Because the doc says no action is needed, no session takes any. This is the same
documentation-does-not-hold-a-line thesis one level up: the doc asserted a *mechanism*
rather than a *duty*, and the mechanism isn't there.

### 5.6 The warn tier is decorative, and pre-commit neuters it twice

3 of 21 custom rules are error-level; 1 is off. CI runs bare `eslint src/`. Pre-commit runs
`--quiet --no-warn-ignored --max-warnings 99999` — `--quiet` already removes warnings from
the tally, so the cap is redundant belt-and-braces on a rule set that cannot fire. The
shared-component boundary rule's own config comment reads "This is an ADVISORY warning, not
a build gate." Meanwhile `check:catalog-boundary`, which *does* `exit 1`, is wired nowhere.

Compounding it: **9 of 21 rules have no tests**, including `role-button-requires-keydown`,
which is one of only three that can fail anything. `src/test/eslint-rules/customRules.test.ts`
asserts "all 12 custom rules" — so the drift from 12 → 21 is invisible from inside the test
that exists to catch drift.

### 5.7 Two golden paths chose their gate severity from a stale number

CLAUDE.md's "~10,086 warnings" baseline (2026-04-17) is roughly 20× the current figure
(~493 measured 2026-07-02; ~700–1,300 estimated today), because `no-raw-spacing-classes`
was turned off. `form-field-and-validation` and `dropdown-and-select` both repeat it, and
`form-field-and-validation` uses it as the *reason* to ship at `"error"`: "warn is
invisible against a ~10,086-warning baseline." The conclusion may still be right; the
evidence is not. §9's own rule — "ground truth, never memory" — was violated by citing
CLAUDE.md instead of measuring.

### 5.8 Smaller vacuity holes worth fixing while we are in there

- `audit.yml:44` — `cargo deny check | tee …` without `set -o pipefail`: **`tee`'s exit
  status is the step's**, so cargo-deny cannot fail that job. (`ci.yml:266` gets this right.)
- `binding-drift` (`ci.yml:365`) — `git diff --quiet src/lib/bindings/` **cannot see
  untracked files**, so a brand-new `#[ts(export)]` type escapes the gate entirely. Only
  modifications to existing bindings fail.
- `commit-lint` (`ci.yml:26-90`) — an empty `COMMITS` prints "All commit messages follow…"
  having linted zero commits; a force-push collapses the range to `HEAD~1..HEAD`, linting
  only the tip regardless of how many commits were pushed.
- `check-themes.mjs` — a token that fails to resolve yields `ratio === null`, renders `n/a`,
  and is counted as neither pass nor fail. A renamed or deleted token silently leaves the audit.
- `check-bundle-budget.mjs` — correctly `exit 1`s when `dist/assets/` is missing, but an
  *empty* `dist/assets/` gives 0 chunks, 0 violations → "PASS: All chunks within budget."
  One `assert(files.length > 0)` closes it.
- `check-unused-bindings.sh` — `grep -rw` counts a mention **inside a comment or unrelated
  string** as usage.
- `check:i18n` in CI is the non-strict variant: **missing keys only warn**. The strict
  variant that CLAUDE.md treats as the no-gaps guarantee runs only in pre-commit, and only
  when a `locales/*.json` file is staged. Adding a `t()` call without touching a locale file
  triggers nothing.
- `.ai/maintain.mjs check` on pre-push runs without `--strict` and **can only ever exit 0**.
- `tsconfig.json` excludes `src/test` — 401 test files are never typechecked.
- `page-loading.md` carries 43 deviations and **proposes no gate at all** — the one §9 lapse
  among the 15 paths that have a §9 (the other two omissions, `modals` and `tables`, are the
  pre-contract probes).

---

## 6. Recommendation

Adopt **M23** (three-lane risk classification), **M29's two missing metrics** (duplication
and coverage, on changed code only), and **M28** (retire or wire non-serving constraints).
Adopt **M2** in the specific form of a `PreToolUse` deny hook, which is the cheapest
high-value item on the list.

Reject his **gate-per-dimension** model as a replacement for §9's per-situation signal
discipline — our precision data says generic rules do not work here — but adopt the
*consolidation* it implies: one census engine consuming declarative rule entries, so that
gate #37 costs a config line rather than a bespoke script with its own way of exiting 0.

Keep §9's fail-loud clause unchanged and apply it to everything we import from him. It is
the part of our doctrine the article has no answer to, and it is the reason we can see the
problems in §5 at all.

**Before any of it:** fix CI. A gate ladder that has not reported a pass in two weeks is
not a safety net, and every mechanism above is worthless bolted onto it.
