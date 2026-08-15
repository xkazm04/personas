# Golden path — Adding a CI gate

> Situation node: `platform-delivery/gates-and-conventions/adding-a-ci-gate` ·
> [situation spine](../situation-spine.md) · recurrence 22 · risk **HIGH** ·
> sides: **server** · convergence: **mixed** ·
> dimensions: **resilience · code-quality · security · cost · function**
> Composed 2026-08-15 against `master` @ `e611c326d`.
>
> **Sweep size.** Every gate this repo owns: 9 lefthook jobs (4 pre-commit,
> 5 pre-push), 7 GitHub workflows declaring 19 jobs (`ci.yml`'s 5 expand to 7
> per run through the 3-platform matrix), the 9 constituents of
> `npm run check`, 17 bespoke `scripts/check-*` scripts (16 `.mjs` + 1 `.sh`),
> 93 census rules over 239,871 file-visits, 21 custom ESLint rules over 4,828
> files, and 2 Claude-harness hooks. Plus the GitHub Actions API: **260
> `ci.yml` runs and 350 runs across all seven workflows, all-time.**
>
> **Measured by execution, not by reading.** Every gate below was *run*. Nine
> were deliberately broken and re-run to see whether they fail — a gate you
> have not watched fail is a gate you have not tested. The census rule in §9
> was validated in a scratch registry under a filename unique to this
> composer, hand-verified site-by-site, cross-checked by two further
> implementations, and pattern-timed against adversarial input. `cargo` was
> not run (see §12 — the brief's reason for that was wrong, but the
> instruction was right).
>
> ---
>
> ## The headline, up front: `ci.yml` has never once passed. Not "rarely" — **zero times in 260 runs.**
>
> Queried from the Actions API on 2026-08-15, all-time, by workflow:
>
> | workflow | success | failure | cancelled | trigger |
> | --- | ---: | ---: | ---: | --- |
> | **`ci.yml`** | **0** | 184 | 76 | push:master + PR |
> | `e2e-smoke.yml` | **0** | 34 | 4 | PR |
> | `audit.yml` | **0** | 22 | 0 | weekly cron |
> | `release.yml` | **0** | 30 | 0 | tag |
> | `installer-test.yml` | 0 | 0 | 0 | **has never run at all** |
> | `ai-conformance.yml` | 4 | 0 | 0 | PR only |
> | `codeql.yml` | 13 | 0 | 0 | PR + weekly |
>
> Four workflows have a 0% success rate. The two that are green — 17 runs
> between them against `ci.yml`'s 260 — are both `pull_request`-only, and
> `ci.yml`'s own header comment states that *"development lands directly on
> master (no PRs)"*. **The only workflows that pass are the ones that almost
> never run.**
>
> This is not a story about one broken job. It is what happens when a
> repository spends 26 batches adding gates and never once measures whether
> the gates it already has produce a verdict.
>
> ### 1 — `npm ci` has been failing since at least 2026-08-08, and it takes the whole frontend gate with it
>
> `frontend-checks` is the job that runs `npm run check`, i18n parity, the
> error-registry parity check, WCAG contrast, the tier builds, the bundle
> budget, the unused-bindings scan and **the entire 2,400-test Vitest suite**.
> Across the last 20 completed `ci.yml` runs it is **0/20**. Every one dies at
> step 4:
>
> ```
> npm error code EUSAGE
> npm error `npm ci` can only install packages when your package.json and
> npm error package-lock.json ... are in sync.
> npm error Missing: @emnapi/runtime@1.11.3 from lock file
> npm error Invalid: lock file's @emnapi/wasi-threads@1.2.2 does not satisfy @emnapi/wasi-threads@1.2.3
> ```
>
> The lockfile still pins `@emnapi/wasi-threads@1.2.2` today (verified by
> reading `package-lock.json`); it was last committed **2026-07-30**. The
> failure is present in every run sampled from 2026-08-08 through 2026-08-14.
>
> **A dependency install is a gate's precondition, and nothing treats it as
> one.** Every check downstream of it has been reporting on an empty
> `node_modules` — or not reporting at all.
>
> ### 2 — the same day the repo wrote down "assert your instrument", it shipped two gates that only run on one laptop
>
> `npm run check` is the documented self-certification command. Five of its
> nine steps in, it calls `check:corpus`, whose second line of executable code
> is:
>
> ```js
> // scripts/census/check-corpus-integrity.mjs:31
> const ROOT = 'C:/Users/mkdol/dolla/personas';
> ```
>
> `scripts/docs/check-doc-map-paths.mjs:17` is byte-identical. Replayed with
> `ROOT` repointed at a path that does not exist — which is every CI runner,
> every worktree under a different name, and every other machine:
>
> ```
> FATAL: required input missing: \nonexistent\ci\checkout\docs\concepts\golden-paths
> This checker cannot run. Failing loudly rather than reporting a green tree.
> exit=2
> ```
>
> The `exit 2` is correct and admirable — the file's own header says *"THE
> INSTRUMENT IS ASSERTED BEFORE THE RESULT"*. It is also, because
> `npm run check` is a bare `&&` chain, **the reason `tsc --noEmit`,
> `eslint src/` and `npm run census:check` cannot run in CI at all.** They sit
> at positions 7, 8 and 9, behind a step that aborts at position 5.
>
> Nobody has seen this fire, because `npm ci` fails first. It is a loaded gun,
> not a smoking one. It was committed on **2026-08-14**, in the same
> twenty-four hours as the doctrine paragraph telling composers that a gate
> which no-ops is worse than no gate.
>
> Four tooling files hold that literal (§9 counts them); **10 quoted
> user-home absolute paths across 9 files**, two of them inside `npm run check`.
>
> ### 3 — the Rust half fails on all three platforms, for an environment reason, and always has
>
> `rust-tests` is **0/20** on windows, **0/20** on linux, 0/18 on macos.
> Root cause, from the linux log:
>
> ```
> thread 'crypto::tests::test_encrypt_decrypt_roundtrip' panicked at core/src/crypto.rs:1874:
> called `Result::unwrap()` on an `Err` value: KeyManagement("... Master key not available
> (fail-closed): ... DBus error: The name org.freedesktop.secrets was not provided by any
> .service files. Set PERSONAS_ALLOW_FALLBACK_KEY=1 to allow local fallback.")
> ```
>
> The error message *names its own fix*. `PERSONAS_ALLOW_FALLBACK_KEY` appears
> **zero times** in `.github/workflows/`. The crypto suite requires an OS
> keyring; CI runners do not have one. `cargo clippy` and `cargo deny` run
> `if: always()` and fail alongside it, so the job is red three ways at once
> and no single failure is legible.
>
> ci.yml carries 46 lines of comment explaining why `--workspace` and
> `--features desktop` are load-bearing on these steps — a genuinely hard-won
> correction, applied to a step that has never produced a passing result.
>
> ### 4 — nine gates that run, report, and cannot fail on the condition they name
>
> Each verified by execution:
>
> | gate | what it claims | what it does |
> | --- | --- | --- |
> | `gitleaks-staged` (pre-commit) | the D9 secret control | prints `gitleaks not installed — secret scan SKIPPED (commit not blocked)`, **exit 0**. gitleaks is not on this machine |
> | `eslint-staged` (pre-commit) | lint the staged diff | `--quiet` strips warnings *before* `--max-warnings 99999` counts them. **17 of 21 custom rules are warn-level** |
> | `eslint src/` (in `npm run check`) | lint the tree | no `--max-warnings`. Measured on the clean tree: **1,135 problems — 1,135 warnings, 0 errors → exit 0**, in 99 s. (Self-check: the same run with a deliberate 3-warning probe file present reported exactly 1,138, and still exited 0.) |
> | `ai-context-freshness` (pre-push) | CONTEXT.md freshness | printed `[WARN] CONTEXT may be stale for "root"` and **exited 0**. `--strict` exists; the hook does not pass it |
> | `.ai/doctor.mjs` (pre-push + PR) | conformance | never executes a capability without `--run`, which neither caller passes. See §5 — it passes `scan-secrets` on a *string match* |
> | `check:corpus` / `check:doc-map` | corpus + doc-link integrity | **exit 2 on any machine but one**, aborting `npm run check` before typecheck, lint and census |
> | `check:tiers` | tier builds compile | spawns `npx vite build` only. **A type error passes** — no `tsc` anywhere in it |
> | `check-doc-sync` (Stop hook) | docs kept in sync | satisfied by editing **any** file under `docs/features/`; `process.exit(0)` silently if the transcript is unreadable or the map won't parse; dismissible with one sentence |
> | `e2e-smoke` smoke step | live-app smoke | `continue-on-error: true`, and the job's own comment records **38 runs, 34 failure, 4 cancelled, zero success — born broken** |
>
> ### 5 — the conformance gate is satisfied by the *word* "gitleaks" appearing in a file
>
> `.ai/manifest.yaml` declares `controls.prePush: [lint, typecheck, scan-secrets, evals]`.
> The doctor verifies that claim like this (`doctor.mjs:84-89`):
>
> ```js
> const ALIAS = { lint: ['lint','eslint',…], 'scan-secrets': ['gitleaks','trufflehog',…] };
> if (!al.some((a) => hookText.includes(a))) add('warn', …);
> ```
>
> `hookText` is the whole of `lefthook.yml`, lowercased, with no notion of
> which hook a job belongs to. So:
>
> - **`scan-secrets` passes** because the string `gitleaks` appears — in a job
>   *name* (`gitleaks-staged`) and in three comment lines. The command behind
>   it exits 0 unconditionally when gitleaks is absent.
> - **`lint` passes as a pre-push control** because the string `eslint` appears
>   — in the *pre-commit* section. There is no lint job in pre-push at all.
>
> Verdict: **`Conformance: 92% (0 fail, 1 warn)`**. Two of the four declared
> pre-push controls are not where they are declared to be, and one of them is a
> documented no-op. The declared `ciHardPass: [test, sast, merge-gate]` includes
> `test` — the Vitest suite, which has never reached execution in CI. The
> manifest also points `paths.guardrails` at `.ai/guardrails.yaml`, **which does
> not exist**; the doctor checks `contextIndex`, `memory` and `evals`, and not
> that one.
>
> This is the contract's fifth failure mode — *the gate that points at a broken
> destination* — in its purest form. The instrument fires correctly and reports
> the truth about a proxy that does not carry the property it stands for.
>
> ### 6 — the only gate nobody can run is the one that is actually red
>
> `scripts/check-unused-bindings.sh` (CI-only, not in `npm run check`, not in
> any hook) loops 1,033 binding files, running a full recursive grep over 4,828
> source files for each. Measured on this checkout:
>
> > **exit 1 in 680 s (11 min 20 s) — 98 unused bindings.**
>
> It is correct. It found a real, live defect. And nobody has ever seen its
> output, because it is behind `npm ci` in CI and behind eleven minutes
> locally. `CLAUDE.md` estimates "19 orphan bindings"; the measured number is
> **98**, 5× higher.
>
> ### 7 — the cost of the gate everyone is told to run
>
> `npm run check` is the PR-self-review command in `CLAUDE.md`. Every
> constituent timed individually on this machine, warm:
>
> | # | step | time | fails on its condition? |
> | ---: | --- | ---: | --- |
> | 1 | `check:contracts` | 3.3 s | not exercised |
> | 2 | `check:tiers` | **216 s** | only on a *bundling* failure, never a type error |
> | 3 | `check:tauri-configs` | 1.7 s | not exercised |
> | 4 | `check:csp-hosts` | 2.5 s | ✔ **verified exit 1** on a disallowed fetch host |
> | 5 | `check:corpus` | 2.0 s | ✔ here, **exit 2 everywhere else** |
> | 6 | `check:doc-map` | 2.1 s | same hardcoded ROOT |
> | 7 | `census:check` | **37.1 s** | ✔ **verified exit 1** on one added `<select>` |
> | 8 | `tsc --noEmit` | **218 s** | ✔ **verified exit 2** on an injected type error |
> | 9 | `eslint src/` | **99 s** | ✔ on errors; ✖ on 1,135 warnings |
> | | **total** | **582 s ≈ 9 min 42 s** | |
>
> Two steps — a triple Vite build and a full typecheck — are **75% of the
> wall-clock**, and the first of them cannot catch the thing the second exists
> for. Pre-push adds another 218 s of `tsc --noEmit`, duplicating step 8. A
> developer who runs the documented sequence honestly pays **~13 minutes**
> before pushing, and gets no Vitest, no i18n parity, no theme contrast and no
> error-registry check for it — those are CI-only, in the job that has never
> run.
>
> ### 8 — `if: always()` turned one failure into seven
>
> `ci.yml` carries **17** `if: always()`, **7** `continue-on-error` and **9**
> `|| true`. The `if: always()` block landed 2026-08-13 in a commit titled
> *"stop red steps hiding each other"*. Measured effect: on 2026-08-12 the
> `frontend-checks` job reported **1 failing step and 11 skipped**; on 2026-08-13
> the identical root cause reported **7 failing steps**. The intent was good —
> a later step's regression should not be masked by an earlier one. The result
> is that the actual cause (`npm ci`) is now the first of seven red lines
> instead of the only one, and each of the other six is a check running against
> an empty `node_modules`.
>
> Neither `personas-web` (87% green) nor `ascent` (63% green) uses `if: always()`
> **anywhere**. See *Convergence*.
>
> ### What the corpus should take from this
>
> Twenty-six batches of golden paths have proposed enforcement. The enforcement
> mechanism that works — `scripts/census/` — works precisely because **its
> authors do not write the walk, the exit code, or the report.** Every gate in
> this document that no-ops is a gate whose author wrote its verdict by hand.
>
> ## 1 Trigger
>
> - "This keeps regressing — let's add a check so it can't happen again."
> - "Add a CI step for X." / "Wire this into pre-commit."
> - "Add a lint rule / a script that fails the build if …"
> - "Why didn't CI catch this?"
> - "Is `npm run check` green?"
> - "Ship the §9 gate from this golden path."
>
> If you are about to write a new `scripts/check-*.mjs`, append a step to
> `.github/workflows/*.yml`, add a job to `lefthook.yml`, extend the `&&` chain
> in `package.json`'s `check` script, or add an entry to
> `scripts/census/rules.json` — you are in this situation.
>
> **Not this path:** *writing the ESLint rule itself* is
> [custom-lint-rule](./custom-lint-rule.md) (its §9 rule `unlooking-lint-rule`
> measures rules that buy precision by not looking). *Keeping two generated
> artifacts in step* is `cross-artifact-drift-gate` (unwritten). *Secret
> scanning specifically* is `secret-leak-scanning` (unwritten — but §7 P1 here
> is its opening evidence). *Bundle budgets* is `bundle-size-budget`
> (unwritten). This path owns **the act of adding enforcement, and whether the
> enforcement enforces.**
>
> ## 2 The one way
>
> **Before you write a gate, prove it can fail; after you write it, prove it
> did.** Concretely, in this order. **(a) Break the thing first.** Introduce
> the defect the gate is for, run the gate, and watch it exit non-zero. A gate
> you have not seen fail is a hypothesis. Nine of the gates in this repo do not
> fail on the condition they name, and every one of them was written by someone
> who never ran that experiment. **(b) Reach for the census before you reach
> for a file.** If the signal is countable, it is an entry in
> `scripts/census/rules.json` — you get floor-assertion, zero-match assertion,
> stale-exclude detection, drop detection and a printed count on success for
> free, and you cannot write them wrong because you do not write them. Only
> write a bespoke script when the condition is a *completeness* claim the
> census cannot express (`check-csp-hosts.mjs` is the model). **(c) Assert your
> instrument before your result, and exit 2 — not 1 — when it fails**, so
> "could not run" is distinguishable in a build log from "ran and found
> nothing". **(d) Resolve every path from `import.meta.url` or
> `CLAUDE_PROJECT_DIR`, never from a literal** — a gate keyed to one machine is
> not a gate, it is a personal script that aborts the chain behind it.
> **(e) Place it once, at the earliest point it can afford to run**, and make
> the placement match `.ai/manifest.yaml`'s `controls` block; a gate declared
> pre-push and implemented pre-commit is a lie the conformance checker will
> happily confirm. **(f) Never let a gate mask a precondition** — no
> `continue-on-error`, no `|| true`, no `if: always()` on a step whose inputs a
> prior step produces. **(g) Ship it at error severity or do not ship it**: a
> warn-level rule enforces nothing at any gate in this repo, at any count, by
> construction. **(h) Then go look at the run.** Open the Actions tab. A gate
> added to a workflow that has never gone green has not been added to anything.
>
> If you must pick one: **(a)**. It is the only step whose omission is
> invisible, permanent, and self-congratulatory.
>
> ## 3 Mandated primitives
>
> | primitive | what it gives you |
> | --- | --- |
> | `scripts/census/rules.json` + `npm run census:check` | the ratcheting-count gate, once. A rule is JSON; the runner owns the walk, the exit code and the report. **93 rules, 239,871 file-visits, 37 s.** Verified to fail on a +1 drift |
> | `scripts/census/lib/engine.mjs` — `validateRule` | rejects a malformed rule *before* scanning, so a broken registry cannot scan "successfully" |
> | `scripts/census/lib/engine.mjs` — `assertRule` | the four structural assertions: `floor`, zero-match, stale-exclude, silent-drop. This is the fail-loud contract, implemented |
> | `npm run census:test` | the runner's own self-test — **23/23**, including `zero-width patterns cannot hang the scanner` |
> | `scripts/check-csp-hosts.mjs:151-161` | the model bespoke gate: `exit 2` if it finds zero fetch sites or zero `connect-src` hosts. Its header documents catching **its own brokenness twice** before it caught a real defect |
> | `scripts/check-themes.mjs:196` | `FATAL: could not find :root block` → `exit 2`. The second bespoke gate that asserts its instrument |
> | `scripts/census/check-corpus-integrity.mjs:47-74,155-166` | four `exit 2` preconditions — the best-designed guard set in the tree, welded to a hardcoded ROOT (§7 P2) |
> | `eslint.config.js` + `eslint-rules/*.cjs` | the AST host, when the signal is structural or wants an autofix. **Set the severity to `"error"`** |
> | `lefthook.yml` | the local placement surface. `pre-commit` for staged-scope checks under ~5 s; `pre-push` for whole-tree checks |
> | `.ai/manifest.yaml` `controls:` | the declaration of where each control lives. Update it in the same commit; the doctor reads it |
>
> **Do not reach for:** `scripts/check-unused-bindings.sh` as a model for a
> whole-tree script (1,033 × full-tree grep = 680 s); `.ai/doctor.mjs`'s
> `hookText.includes(alias)` as a model for verifying placement (§7 P6); and
> `if: always()` as a way to surface parallel failures — use separate jobs.
>
> ## 4 Steps
>
> 1. **Write the failing case first.** A file, a fixture, a staged diff that
>    exhibits the defect. Keep it; you will need it in step 8.
> 2. **Ask whether the census already covers it.** 93 rules exist. Read the
>    registry (`node -e` over `rules.json` prints every id in one line). A rule
>    with high file-overlap and a similar signal is a decline, not a gate.
> 3. **Ask whether the primitive can make it unrepresentable** — see *Prefer a
>    type over a gate*. A gate is a ratchet on a condition you could not
>    eliminate.
> 4. **If the signal is countable, write a census rule.** Roots, extensions,
>    pattern, `floor`, `baseline`. Nothing else.
> 5. **Write a positive control** — the same anchors pointed at the *compliant*
>    form, id ending `-positive-control`, **no `baseline`**. If the control
>    returns ~0 your pattern keys on a token, not a shape.
> 6. **Check the pattern for backtracking, not only precision.** Time it against
>    a 200,000-character adversarial string. `(?:\s|//[^\n]*)*` is a nested
>    quantifier and hung a 963-file walk past 120 s.
> 7. **If it must be a bespoke script:** resolve paths from `import.meta.url`;
>    count your inputs; `exit 2` with a message naming *which* input is missing
>    if any count is zero; `exit 1` only on a real violation; and print the
>    surviving counts on success.
> 8. **Break it and run it.** Both directions: the defect must fail, and the
>    compliant form must pass. Record both exit codes. **This is the step.**
> 9. **Place it once.** `lefthook.yml` (pre-commit if staged-scoped and fast,
>    pre-push otherwise) or a CI job — and update `.ai/manifest.yaml`
>    `controls:` to match. Do not add it to `npm run check`'s `&&` chain unless
>    it runs in under ~5 s and works on a foreign checkout; that chain is
>    already 9 min 42 s and two of its members abort on any other machine.
> 10. **Watch one real run finish.** `gh run list --workflow=<file> --limit 5`.
>     If the workflow's all-time success count is 0, your gate is decoration
>     until that is fixed — fix that first.
> 11. **Then stop.** Do not write a runner, a baseline format, a report
>     formatter, or a second registry. `scripts/census/` is the mechanism; a
>     second one is how 460 bespoke scripts start.
>
> ## 5 Anti-patterns
>
> - **The gate nobody watched fail.** *Failure mode:* it exits 0 forever and
>   manufactures confidence. **Measured: 9 of this repo's gates, including the
>   entire D9 secret-scan control.**
> - **Warn severity "for now".** *Failure mode:* `npm run check` has no
>   `--max-warnings`; the pre-commit hook uses `--quiet`, which discards
>   warnings before `--max-warnings` can count them. **Measured: 1,135
>   warnings, 15 rule buckets, every single one warn-level, exit 0 at both
>   gates.** Warn changes authoring behaviour through editor squiggles; it is
>   not enforcement, and the two must never be conflated.
> - **The literal absolute path.** `const ROOT = 'C:/Users/<you>/…'`. *Failure
>   mode:* the gate `exit 2`s on every other machine — and if it sits in an
>   `&&` chain, everything behind it never runs. **Measured: 10 sites, 2 inside
>   `npm run check`.**
> - **Declaring a control somewhere it isn't.** *Failure mode:* the conformance
>   checker string-matches an alias anywhere in the hook file and confirms the
>   claim. **Measured: `lint` declared pre-push, implemented pre-commit;
>   `scan-secrets` declared pre-push, implemented pre-commit as a no-op; doctor
>   reports 0 fails.**
> - **`if: always()` on a step whose inputs an earlier step produces.**
>   *Failure mode:* one broken precondition becomes N red steps and the cause
>   stops being legible. **Measured: 1 failing step → 7, same root cause, one
>   commit apart.**
> - **`continue-on-error` as a stabilisation plan.** *Failure mode:* the
>   promotion criteria are written into a comment and never revisited.
>   **Measured: `e2e-smoke.yml` — 38 runs, 0 success, 3 months, a documented
>   3-step promotion plan at step 0.**
> - **A build step standing in for a typecheck.** `vite build` strips types; it
>   does not check them. **Measured: `check:tiers` = 216 s, 3 builds, and a
>   `const n: number = "x"` passes.**
> - **A gate too slow to run.** *Failure mode:* it moves to CI-only, then CI
>   breaks upstream of it, and its output has never been seen. **Measured:
>   `check-unused-bindings.sh`, 680 s, exit 1, 98 real findings, invisible.**
> - **Adding a gate without opening the Actions tab.** *Failure mode:* you have
>   added a step to a workflow with a 0% all-time success rate. **Measured:
>   `ci.yml`, 0/260.**
> - **A satisfaction condition looser than the intent.** The doc-sync hook is
>   satisfied by editing *any* file under `docs/features/`, and the binding-drift
>   job was satisfied by `git diff --quiet` for a *new* type. *Failure mode:* the
>   cheapest way to make the gate green is not the behaviour it wanted.
>
> ## 6 Evidence
>
> **The ONE site to copy: `scripts/check-csp-hosts.mjs`.**
>
> It is the only bespoke gate in the tree that gets every part right, and its
> own header records how it learned each one:
>
> ```js
> // Instrument-before-result: exits 2 if it finds no fetch call sites or no
> // connect-src hosts. A checker that silently measures nothing passes forever.
> …
> if (sites.length === 0) { console.error("… found ZERO frontend fetch hosts — the scanner is broken, not the code."); process.exit(2); }
> for (const [name, hosts] of csps) if (hosts.length === 0) { console.error(`… parsed ZERO connect-src hosts from ${name} — the parser is broken.`); process.exit(2); }
> ```
>
> - `ROOT` from `fileURLToPath(new URL("..", import.meta.url))` — runs anywhere.
> - Two independent zero-checks, both `exit 2`, both naming which half broke.
> - Its comments record that it **reported zero hosts twice, for two different
>   reasons** (call-scoped capture; a `//` stripper that ate every line
>   containing `https://`) before it found a real 69-day-dead feature.
> - It states why it is not a census rule: *"This is a must-be-COMPLETE
>   condition, which the census runner cannot express."* That sentence is the
>   correct justification for every bespoke gate, and it is the only one in the
>   tree that offers it.
> - Verified live: injecting `fetch('https://evil-not-allowed.example.com/…')`
>   → **exit 1**, naming file, line and both missing CSPs.
>
> Supporting exemplars, each for one property:
>
> | site | the property to copy |
> | --- | --- |
> | `scripts/census/lib/engine.mjs:250-331` `assertRule` | the four structural assertions, written once so 93 rules inherit them. `structural` is fatal in every mode; `drift` only under `--check` |
> | `scripts/census/self-test.mjs` | a gate with its own regression suite — **23/23**, exercising *the same engine* the real run uses, not a re-implementation |
> | `scripts/census/lib/engine.mjs:128-140` | *"matching runs against WHOLE FILE CONTENT, never line by line"* — the bug that read as "4 violations, looks clean" when the truth was 63 |
> | `scripts/check-themes.mjs:196` | `FATAL: could not find :root block in globals.css` → `exit 2` |
> | `.github/workflows/ci.yml:220-237` | sccache degraded-mode: a *cache* must never be able to fail a build. Health-check, then `RUSTC_WRAPPER` or a `::warning::`. Written after a cache outage took the whole Rust gate offline |
> | `.github/workflows/ci.yml:396-401` | the untracked-binding check — `git ls-files --others --exclude-standard` beside `git diff --quiet`, because `git diff` sees tracked files only and a new binding is untracked by definition |
> | `scripts/build/guard-concurrent-cargo.mjs:39-50` | a guard that treats an **empty payload** as "I did not inspect the command", says so on stderr, and documents its fail-open as a deliberate, reasoned exception |
> | `../ascent/scripts/maturity-gate.mjs:52-63` | the same instrument-before-result rule, independently reinvented in a sibling repo — see *Convergence* |
>
> ## 7 Deviations
>
> Every entry is live on `master` @ `e611c326d` and measured on 2026-08-15.
>
> ### P0 — `npm ci` fails; the entire frontend gate is skipped in CI
>
> `package-lock.json` is out of sync (`@emnapi/wasi-threads@1.2.2` in lock;
> `1.2.3` required). `frontend-checks` is **0/20** across the last 20 completed
> runs; the failure is present in every run sampled 2026-08-08 → 2026-08-14.
> Everything behind it — `npm run check`, i18n parity, error-registry parity,
> WCAG contrast, tauri-config validation, tier builds, the production build,
> the bundle budget, the unused-bindings scan, and **all ~2,400 Vitest tests**
> — has not executed.
> **Fix:** run `npm install` and commit the lockfile. Then add a *first* CI step
> that fails with a distinguishable message if install fails, and remove
> `if: always()` from every step that depends on `node_modules` (P5).
>
> ### P1 — the D9 secret scan is off
>
> `lefthook.yml:26` → `scripts/secret-scan.mjs:22-26`: no gitleaks on this
> machine, so the hook prints `secret scan SKIPPED (commit not blocked)` and
> **exits 0**. Verified. There is no CI secret scan to back it up — CodeQL
> (`javascript-typescript`) is not one, and it is PR-only.
> **Fix:** either install gitleaks and make its absence `exit 1` on a machine
> that has ever had it (a marker file, or an opt-out env var), or add a CI job
> that runs `gitleaks detect` on a runner where it is installed by an action.
> A control whose off-state is silent is not a control. *This is the
> `secret-leak-scanning` leaf's opening evidence.*
>
> ### P2 — two `npm run check` steps hardcode one laptop's path
>
> `scripts/census/check-corpus-integrity.mjs:31` and
> `scripts/docs/check-doc-map-paths.mjs:17`:
> `const ROOT = 'C:/Users/mkdol/dolla/personas';`. Both `exit 2` elsewhere —
> verified by simulation. Because `check` is an `&&` chain, `tsc --noEmit`,
> `eslint src/` and `census:check` never run on any other machine.
> Two more tooling files hold the same literal
> (`scripts/census/merge-published-rules.mjs:17`,
> `scripts/docs/measure-shared-facts.mjs:18`), plus six machine-specific paths
> naming a *different user account* (`C:/Users/kazda/…` in three `studio-*.mjs`
> files) and one absolute app-data path (`scripts/templates/__wire_gmail_scout.mjs:12`).
> **Fix — one line each:**
> ```js
> const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
> ```
> **50 tooling files already do exactly this** (§9 positive control). This is
> the census rule below.
>
> ### P3 — the Rust gate fails on all three platforms, and the fix is in the error message
>
> `crypto::tests::*` require the OS keyring; runners have none.
> `PERSONAS_ALLOW_FALLBACK_KEY` appears **0 times** in `.github/workflows/`.
> `rust-tests`: 0/20 windows, 0/20 linux, 0/18 macos.
> **Fix:** set `PERSONAS_ALLOW_FALLBACK_KEY: "1"` in the `rust-tests` job `env:`
> — or, better, make the crypto tests take an explicit key provider so a test
> can never depend on ambient OS state. Then split clippy and cargo-deny into
> their own jobs so a test failure and a lint failure are two red dots, not one.
>
> ### P4 — `check-unused-bindings.sh`: 680 s, exit 1, 98 real findings, never seen
>
> 1,033 bindings × a full recursive grep over 4,828 files. CI-only; behind P0.
> **Fix:** replace the loop with one pass — build the set of identifiers
> referenced anywhere under `src/` (excluding `bindings/`) once, then
> set-difference. That is O(files), not O(files × bindings). Then triage the 98.
> `CLAUDE.md`'s "19 orphan bindings" is wrong by 5×.
>
> ### P5 — 17 `if: always()`, 7 `continue-on-error`, 9 `|| true` in `.github/workflows/`
>
> `if: always()` entered on 2026-08-13 to stop red steps hiding each other; the
> measured effect is that one root cause now paints seven steps red. Neither
> `personas-web` (87% green) nor `ascent` (63% green) uses any of the three,
> anywhere.
> **Fix:** `if: always()` is right *between independent jobs* and wrong
> *between dependent steps*. Split `frontend-checks` into `install` +
> `typecheck-lint` + `build` + `test` jobs with `needs:`, and drop the flag.
>
> ### P6 — `.ai/manifest.yaml` declares controls that are not where it says
>
> `controls.prePush: [lint, typecheck, scan-secrets, evals]`. Actual pre-push:
> `typecheck, i18n-coverage, evals, ai-conformance, ai-context-freshness`.
> `lint` and `scan-secrets` are pre-commit, and `scan-secrets` is a no-op. The
> doctor confirms all four via `hookText.includes(alias)` over the whole file
> and reports **0 fails**. `ciHardPass` lists `test`, which has never run.
> `paths.guardrails: .ai/guardrails.yaml` **does not exist** and is not checked.
> **Fix:** scope the doctor's search to the hook *section* named by the control,
> and check every declared `paths:` entry, not three of four. Then reconcile the
> manifest with reality — the manifest is the only machine-readable statement of
> where enforcement lives, and it is currently fiction.
>
> ### P7 — `check:tiers` costs 216 s and cannot catch a type error
>
> `scripts/check-tiers.mjs:36` spawns `npx vite build` three times. No `tsc`.
> It is step 2 of `npm run check`, ahead of the 218 s `tsc --noEmit` at step 8.
> **Fix:** move it out of `npm run check` into CI only (CI already runs
> `check:tiers starter team` as its own step, so `check` is *duplicating* it),
> or run one tier locally and all three in CI. That alone takes the documented
> self-cert command from 9 min 42 s to ~6 min.
>
> ### P8 — `ai-context-freshness` cannot fail
>
> `lefthook.yml:71` runs `node .ai/maintain.mjs check`. Verified: it printed
> `[WARN] CONTEXT may be stale for "root"` and **exited 0**. The script's own
> header documents `--strict` for exactly this.
> **Fix:** pass `--strict`, or delete the job — a hook that always passes costs
> 1.8 s per push and buys nothing.
>
> ### P9 — `installer-test.yml` has never run; `release.yml` is 0/30
>
> 14,762 bytes of workflow, **zero executions, ever**. `release.yml`: 30 runs,
> 0 success. `audit.yml` (weekly security): 22 runs, 0 success.
> **Fix:** triage or delete. An un-run workflow is a maintained file that
> asserts nothing; a weekly security audit that has never passed is worse,
> because its existence is cited as coverage.
>
> ### P10 — the doc-sync Stop hook has two silent-pass paths and a loose satisfaction condition
>
> `scripts/docs/check-doc-sync.mjs:117` exits 0 when the transcript yields no
> edits (including when the path is missing), and `:134` exits 0 when
> `feature-doc-map.json` will not parse. Its satisfaction condition is *any*
> file under `docs/features/`. It is also a nag, not a gate: `exit 2` shows the
> agent a message it may dismiss in one sentence.
> **Fix:** distinguish "no edits this turn" from "could not read the
> transcript" and say so on stderr in the second case; fail loudly on an
> unparseable map. The loose satisfaction condition is a genuine gap (§8).
>
> ### P11 — 1,135 warnings, 0 errors, and 17 of 21 custom rules at warn
>
> Full breakdown, `eslint src/` (99 s, exit 0): `no-low-contrast-text-classes`
> 705, `no-hardcoded-jsx-text` 226, `no-raw-radius-classes` 128,
> `no-raw-text-classes` 16, `no-restricted-imports` 13, `exhaustive-deps` 9,
> `enforce-base-modal` 8, parse 6, `no-module-scope-en-value` 6,
> `prefer-numeric` 5, four more at ≤3. **Every one is warn-level; the tree
> contains zero error-severity findings.**
> Note the 13 `no-restricted-imports` *warnings*: `CLAUDE.md` says raw `invoke`
> is enforced by that rule, and it is `"error"` — except in
> `src/features/shared/**`, where `eslint.config.js:141` re-declares it at
> `"warn"`. It is warn-level exactly where it is being violated.
> **Fix:** per rule, either promote to `"error"` with the existing findings
> carried by a census baseline, or accept it as authoring-time guidance and stop
> describing it as enforcement.
>
> ## 8 Gaps — what the primitives genuinely cannot do
>
> 1. **The census cannot assert an absence.** A rule with zero matches fails
>    structurally, by design. "This gate does not enforce anything", "this
>    workflow has never passed", "this control is declared in the wrong hook" —
>    all absences. §9 declines to gate the leaf's own central condition for
>    exactly this reason.
> 2. **No static check can read a build log.** The single most load-bearing
>    number here — 0 successes in 260 runs — came from the GitHub Actions API,
>    which no gate in this repo queries. Nothing in the tree knows whether its
>    own CI passes.
> 3. **A gate cannot verify its own placement.** `.ai/doctor.mjs` tries, with
>    substring matching over the whole hook file, and gets both `lint` and
>    `scan-secrets` wrong. A correct version needs a YAML parse plus a mapping
>    from control name to command — which is a second registry, and the repo
>    already has three (`lefthook.yml`, `package.json` scripts, `manifest.yaml`).
> 4. **`npm run check` is a string.** It is a `&&`-joined line in
>    `package.json`. There is no schema, no per-step timeout, no per-step
>    reporting, and no way for a gate to declare "I require a foreign-checkout-safe
>    root". Anyone can append anything; two people did, on the same day.
> 5. **The `floor` is author-chosen and unchecked.** `validateRule` requires
>    `floor` to be a positive integer and nothing more. `floor: 1` passes
>    validation and asserts nothing. Requiredness is not closedness (doctrine
>    Q2): the *presence* of a floor is enforced, its *proportionality to the
>    roots* is not.
> 6. **A Claude Stop hook is not a gate.** It runs in an agent turn, writes to
>    stderr, and is dismissible by one sentence. It never touches a commit, a
>    push, or a build. Two of this repo's enforcement surfaces
>    (`check-doc-sync`, `guard-concurrent-cargo`) live only there.
> 7. **`--quiet` is upstream of `--max-warnings`.** There is no ESLint flag
>    combination that shows errors only *and* counts warnings. The
>    pre-commit hook must choose; it chose quiet.
> 8. **A satisfaction condition is not an intent.** No mechanism here can check
>    that the `docs/features/` file you edited is the *right* one, or that a
>    regenerated binding is *correct*. Every gate keyed on "you touched the
>    destination" has this ceiling — the contract's fifth failure mode.
>
> ## Prefer a type over a gate
>
> Held against all seven qualifications.
>
> **The type exists, it is constructed 93 times, and it is the reason the
> census gates work while the hand-written ones do not.**
>
> `scripts/census/rules.json` is a **factory that owns the dangerous
> parameter**. A gate author supplies a signal and a baseline; the runner
> supplies the walk, the four structural assertions, the exit code and the
> report. It is not possible to write a census rule that silently checks
> nothing — verified by its own self-test (23/23) and by breaking it (a +1
> `<select>` → exit 1, with the file named).
>
> Against the seventeen hand-written `scripts/check-*.mjs`: **three** assert
> their instrument (`check-csp-hosts`, `check-themes`, `check-corpus-integrity`),
> and the third is welded to one machine. The other fourteen — including
> `check-coverage.mjs`, `check-untranslated.mjs`, `check-error-registry-parity.mjs`,
> `check-command-contract.mjs`, `check-event-registry.mjs`,
> `check-bundle-budget.mjs`, `check-tiers.mjs`, `check-doc-sync.mjs`,
> `check-unused-bindings.sh` — have no precondition assertion at all.
>
> Now the qualifications:
>
> 1. **A required prop carries only what it actually encodes.** ✔ And this is
>    the limit. A census rule encodes *"this count must not rise"*. It does not
>    encode "the condition is absent", "this rule is wired into a hook", or
>    "the workflow that runs it passes". `census:check` is green right now on a
>    repo whose CI has never gone green — correctly, because that is not what it
>    claims.
> 2. **Requiredness is orthogonal to closedness.** ✔ `validateRule` makes
>    `floor` **required** and leaves it **open**: any positive integer passes.
>    Requiredness bought the field's presence and none of its meaning (§8 gap 5).
>    Contrast `id`, which is also required — and where the `-positive-control`
>    suffix *is* closed, and drives real behaviour in three separate consumers.
> 3. **A type nobody constructs constrains nothing.** ✔ Inverted here, and that
>    is the finding: the census is constructed **93 times** in eight months and
>    it is the one enforcement mechanism in this repo with no known no-op. The
>    hand-rolled alternative is constructed 17 times and no-ops in 14.
> 4. **A type anyone can construct authenticates nothing.** ✔ Anyone can write
>    `scripts/check-foo.mjs` and append it to the `check` chain. Nothing
>    validates that it resolves its paths portably, that it exits 2 on a missing
>    input, or that it takes less than four minutes. **Two hardcoded-path gates
>    entered `npm run check` on 2026-08-14 and passed review** — the door is
>    public, so the newtype authenticates nothing.
> 5. **Withholding beats requiring.** ✔ Decisively. Requiring gate authors to
>    write a precondition assertion has been the documented rule since wave 1
>    and produced 3 of 17. Withholding the exit code — making it impossible to
>    write one — produced 93 of 93.
> 6. **Withhold the *dangerous freedom*, not the answer.** ✔ The dangerous
>    freedom is *"decide for yourself when to exit 0"*. The census withholds
>    exactly that and hands back full expressive power over the signal (any
>    regex, any roots, any extensions). Withholding the *signal* instead — a
>    fixed menu of detectors — would have made the mechanism useless; that is
>    the wrong half.
> 7. **Withholding a requirement only helps when the requirement was forcing
>    the bad value.** ✔ And this is where the remaining work is. Nobody *forces*
>    a gate author to hardcode `C:/Users/mkdol/…`; they supply it voluntarily,
>    because `package.json`'s `check` is a string that accepts any command. So
>    relaxing a signature is inert — **the construction is what must be
>    withheld**: `npm run check` should not be an `&&`-joined list of arbitrary
>    commands. It should be one runner over a declared array of steps, each
>    with a name, a timeout, and a `portable: true` assertion the runner
>    verifies by executing the step from a temp cwd. Nine steps become nine
>    entries; nobody writes the sequencing, the timing, or the abort semantics.
>
> **Does the type reach the code?** For countable conditions, completely — and
> the corpus should keep routing §9 gates there. For three things it does not
> reach at all, and no type can:
>
> - **Whether a gate is wired into anything.** A census rule that nobody adds to
>   `census:check`'s registry, or a registry nobody runs, is inert; the runner
>   cannot see its own invocation.
> - **The CI YAML.** `if: always()`, `continue-on-error`, a missing `env:` — the
>   workflow file is data consumed by a service, and no type in this repo
>   crosses that boundary.
> - **Whether the run went green.** §8 gap 2.
>
> Cost of the type change proposed under Q7: `scripts/run-checks.mjs` is ~60
> lines; `package.json`'s `check` becomes `node scripts/run-checks.mjs`; the
> nine steps become nine JSON entries. It makes P2 (hardcoded ROOT in the
> chain) a startup failure with a named step rather than a silent truncation of
> the chain, and it makes P7 (a 216 s step ahead of the thing it cannot
> replace) visible as a number in a report every time anyone runs it.
>
> ## Convergence
>
> Checked against `../personas-web`, `../brainiac`, `../personas-cloud`,
> `../vibeman`, `../ascent`. **All five exist**; nothing is reported by omission.
>
> | # | clause | personas | personas-web | brainiac | personas-cloud | vibeman | ascent | verdict |
> | --- | --- | --- | --- | --- | --- | --- | --- | --- |
> | 1 | any local git hook | lefthook, 9 jobs | **none** | **none** | **none** | **none** | **none** | **SILENCE 5/5 — house convention** |
> | 2 | CI exists at all | 7 workflows | 1 | 4 | **none** | 3 | 2 | physics (4/5) |
> | 3 | CI all-time success rate | **0%** (0/184) | **87%** (45/52) | 34% (34/99) | n/a | **0%** (0/36) | 63% (52/83) | **diverged** |
> | 4 | `if: always()` in workflows | **17** | **0** | 2 | n/a | 2 | **0** | **rare (2/5 use it)** |
> | 5 | `continue-on-error` | 7 | **0** | 1 | n/a | 2 | **0** | rare |
> | 6 | `\|\| true` in a workflow | 9 | **0** | **0** | n/a | **0** | **0** | **SILENCE 4/4 — local only** |
> | 7 | ratcheting-baseline gate | 93 rules | **no trace** | **no trace** | **no trace** | **no trace** | **no trace** | **SILENCE 5/5** |
> | 8 | instrument-before-result (`exit 2` on "could not run") | 3 scripts + census | **no trace** | **no trace** | n/a | **no trace** | **`maturity-gate.mjs:52-63`** | **physics (2/2 that have it)** |
> | 9 | hardcoded user-home path in tooling | **16 files** | 3 | **0** | **0** | **0** | 1 | **physics — of the defect (3/5)** |
>
> **Physics — independently reinvented, keep as doctrine:**
>
> - **§2(c) assert the instrument, and exit 2 when it fails.** `ascent`'s
>   `scripts/maturity-gate.mjs:52-63` arrived at the identical rule with the
>   identical reasoning and no shared document:
>   > *"the scan fell back to the deterministic floor. Report it as an ERROR
>   > (exit 2, 'the gate could not run') rather than … Before the gate surfaced
>   > this, a fabricated floor score could pass CI silently."*
>
>   Personas' `check-csp-hosts.mjs` says *"A checker that silently measures
>   nothing passes forever"*; `check-corpus-integrity.mjs` says *"THE WALKER IS
>   BROKEN, NOT THE SPINE"*. Two codebases, two stacks, same conclusion, same
>   exit code. **This is the strongest clause in the path** and the only one the
>   oracle confirms.
> - **§5's "literal absolute path" anti-pattern, confirmed as a defect that
>   recurs.** `personas-web` holds 3 (`scripts/generate-connectors.mjs:19,147`,
>   `generate-voice-data.mjs:18`), `ascent` 1 (`scripts/leonardo-v2.mjs:20`) —
>   and every one of them names `C:/Users/kazda/…`, an account that is not this
>   machine's, so they are already dead where they sit. **The discriminator is
>   not whether the defect occurs — it occurs in 3 of 5 repos — but whether it
>   occurs *inside the gate chain*. Only personas put one there**, and that is
>   the whole difference between a broken helper script and a truncated
>   `npm run check`.
>
> **Diverged — the sharpest result, and it is negative:**
>
> - **`personas-web` is the same operator, the same year, the same
>   `xkazm04` account, and its CI passes 87% of the time.** Its `ci.yml` is 45
>   lines: `npm ci`, `typecheck`, `lint`, `test:unit`, two i18n checks, `build`
>   — plain sequential steps, no `if: always()`, no `continue-on-error`, no
>   `|| true`, no local hooks, no aggregate `check` script. `ascent` is the same
>   shape and passes 63%. **The two repos with 0% success are the two with the
>   most gate machinery**: personas (7 workflows, 33 jobs, 9 hook jobs, 93 census
>   rules, 21 custom lint rules) and vibeman.
>
>   The correlation runs the wrong way from the intuition, and the mechanism is
>   visible in the numbers above: rows 4–6 show that the elaborate repos are
>   also the ones that gave themselves permission to keep going after a failure.
>   A gate suite you cannot get green becomes a gate suite you stop reading.
>
> **Silence — report as silence, do not dress as consensus:**
>
> - **Local git hooks: 5 of 5, no trace.** Personas' entire pre-commit/pre-push
>   layer is a house convention. It is a *good* one — it is where `tsc` and the
>   i18n gates actually produce verdicts, which in this repo is more than CI
>   manages — but nothing outside this checkout reinvented it, so §2(e)'s
>   placement advice is calibration, not doctrine.
> - **The ratcheting-baseline mechanism: 5 of 5, no trace.** 93 rules, and no
>   sibling has anything like it. That is a reason to keep testing it against
>   other repos (the portability test already found it needed a `principle` key
>   to work outside its home), not a reason to promote it.
> - **`|| true` inside a workflow: personas only.** Nine instances. No sibling
>   has one.
>
> ## 9 The missing gate
>
> ### First, the decline — with numbers
>
> **The leaf's central condition cannot be gated by the census, and I am not
> going to pretend otherwise.** "This gate does not fail on the condition it
> names" is an absence, and a census rule with zero matches fails structurally
> by construction. Nor can a regex see:
>
> - that `secret-scan.mjs`'s `exit 0` is reached because a *binary* is missing;
> - that `doctor.mjs`'s `hookText.includes('gitleaks')` matches a job *name*;
> - that `check:tiers` runs `vite build` where a `tsc` was intended;
> - that `ci.yml` has 0 successes in 260 runs.
>
> Two of those need a process spawn, one needs semantic intent, and one needs
> the GitHub API. I checked the five nearest of the 93 existing rules —
> `unlooking-lint-rule` (roots `eslint-rules`, the [custom-lint-rule](./custom-lint-rule.md)
> path's gate), `pinned-harness-endpoint` (roots `tools tests scripts uat`),
> `env-default-conflates-unset-with-empty` (roots `src scripts`),
> `config-value-frozen-at-compile-time`, `shell-vehicle-nonliteral-arg` — and
> none of them covers this condition either. Measured file overlap between my
> candidate and the closest neighbour, `pinned-harness-endpoint`: **0 of 9
> files.**
>
> I also built and rejected a second candidate, `gate-exits-zero-from-catch`
> (`catch {…process.exit(0)}` in `scripts/` + `.ai/`): **1 file, 1 match.** Too
> thin to ratchet, and it misses the real instances — `secret-scan.mjs:26` and
> `check-doc-sync.mjs:117` both exit 0 from a plain `if`, not a `catch`. A rule
> that finds one of the three cases it was written for is a rule that reports
> green while the condition is present, which is the defect this whole document
> is about. Rejected.
>
> ### What the census *can* hold: the portability precondition
>
> One sub-condition is countable, is 100% precise, and is live inside
> `npm run check` today: **a gate that resolves a filesystem location from a
> literal absolute path under a user home.** It is a proxy for the stack-free
> condition *"an enforcement mechanism depends on state that exists only on its
> author's machine, so it aborts — or silently mis-measures — everywhere else."*
> An adopting repo must re-derive its own proxy: a Python gate would spell this
> `Path("/Users/…")`, a shell gate `$HOME`-free absolute paths, a Makefile a
> hardcoded `-C /home/…`.
>
> **Signal** — a quoted absolute path rooted in a user home, in repo tooling.
> **Mechanism** — census rule (`npm run census:check`), plus a positive control.
> **Allowlist** — none. Every one of the ten is a genuine defect; the three
> `studio-*.mjs` files name an account that does not exist on this machine and
> are already dead. An `exclude` for them would be an unexplained exemption, and
> the census fails on a stale exclude anyway.
> **Fails loudly if its own precondition is absent** — inherited from the
> runner: `floor: 120` against 154 walked files fails if `scripts/` or `.ai/`
> stops matching; zero matches anywhere is a structural failure; a silent drop
> is a structural failure.
>
> **Measurement.** Validated standalone in a scratch registry
> (`census-cig-gates.json`, a filename unique to this composer), then
> re-extracted from this finished document and re-run — identical.
>
> | | files | matches |
> | --- | ---: | ---: |
> | **violating** — literal user-home path | **9** | **10** |
> | **compliant** (positive control) — root derived from `import.meta.url` / `process.cwd()` / `CLAUDE_PROJECT_DIR` | **50** | **53** |
>
> A **50-vs-9 partition on the same anchor**: how a tooling script establishes a
> filesystem location. The control returns a healthy non-zero, so the pattern
> discriminates on the *derivation form*, not on a token.
>
> **Precision: 10/10, hand-verified** (every match printed and read):
> 4 × `const ROOT = 'C:/Users/mkdol/dolla/personas'`
> (`check-corpus-integrity.mjs:31` and `check-doc-map-paths.mjs:17` — **both in
> `npm run check`** — plus `merge-published-rules.mjs:17`,
> `measure-shared-facts.mjs:18`); 3 × `const MK = 'C:/Users/kazda/kiro/mk'`
> (`studio-mk-live.mjs:15`, `studio-orb-verify.mjs:13`,
> `studio-orb-exercise.mjs:12`); 2 × env-defaulted `kazda` paths
> (`studio-battle-test.mjs:29,40`); 1 × `const DB = 'C:/Users/mkdol/AppData/…'`
> (`templates/__wire_gmail_scout.mjs:12`).
>
> **Three independent implementations agree at 10**: the census engine, `git grep -nE`,
> and ripgrep. (A fourth attempt returned 1 — a bash-argv backslash mangling,
> which is the doctrine's own warning about putting regexes in argv, earned live.)
>
> **Backtracking check** (the new mechanical hazard): the pattern is a character
> class followed by a fixed alternation — no nested quantifiers. Timed over the
> whole repo at every text extension: **31,573 files, 8.6 s**; four adversarial
> inputs of 200,000–250,000 characters (`'`×200k, `"`+`/`×200k, `'`+`C:`×100k,
> `` ` ``+`/home`×50k) each complete in **≤1 ms**.
>
> The roots are deliberately narrow. Over the whole repo including `.md` and
> `.json` the same pattern matches **910** times — documentation prose is full of
> absolute paths and is not a defect. Scoped to `scripts/` + `.ai/` with
> executable extensions, precision is 100%.
>
> **This rule must be deleted, not baselined at 0, when the count reaches zero** —
> which is achievable: it is ten one-line edits, and 50 files already show the
> compliant form.
>
> ```json
> {
>   "id": "machine-specific-path-in-tooling",
>   "goldenPath": "docs/concepts/golden-paths/adding-a-ci-gate.md",
>   "roots": ["scripts", ".ai"],
>   "extensions": [".mjs", ".js", ".cjs", ".sh"],
>   "signal": {
>     "pattern": "['\"`](?:[A-Za-z]:[\\\\/]Users[\\\\/]|/Users/|/home/)",
>     "flags": "g",
>     "ignoreCommentLines": true,
>     "description": "a quoted absolute path rooted in a user home directory, inside repo tooling. PROXY FOR the stack-free condition: 'an enforcement mechanism depends on state that exists only on its author's machine.' Measured 2026-08-15: 10 matches in 9 files, precision 10/10 hand-verified, agreed by three independent implementations (census engine, git grep, ripgrep). TWO OF THEM ARE INSIDE `npm run check`: scripts/census/check-corpus-integrity.mjs:31 and scripts/docs/check-doc-map-paths.mjs:17 both open with `const ROOT = 'C:/Users/mkdol/dolla/personas'`, and both correctly exit 2 when that path is absent — so on every CI runner and every foreign checkout they abort the `&&` chain at step 5 of 9, and `tsc --noEmit`, `eslint src/` and `npm run census:check` never execute. Verified by simulation: repointing ROOT at a nonexistent path prints 'FATAL: required input missing' and exits 2. THE COMPLIANT FORM IS ALREADY DOMINANT — 50 files / 53 sites derive their root from import.meta.url, process.cwd() or CLAUDE_PROJECT_DIR (positive control below), which is why this is a defect and not a house style; the fix is one line each: `const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')`. Three of the ten name C:/Users/kazda/, an account that does not exist on this machine, so those scripts are already dead where they sit — NOT excluded, because an unexplained exemption is where violations hide and deleting the scripts ratchets the count down honestly. Roots are deliberately narrow: the same pattern over the whole repo including .md/.json matches 910 times, nearly all documentation prose. BACKTRACKING: character class plus fixed alternation, no nested quantifier — 31,573 files in 8.6 s, and four adversarial 200k-character inputs in <=1 ms each. PRECONDITION (re-derive per repo): this proxy assumes tooling is Node/shell and spells a machine path as a quoted literal. A Python gate spells it Path(\"/Users/...\"), a Makefile spells it -C /home/..., and a repo whose tooling only ever receives its root as an argument has the condition in a form this pattern cannot see. DELETE THIS RULE at zero rather than baselining it — ten one-line edits reach zero."
>   },
>   "baseline": { "files": 9, "matches": 10 },
>   "floor": 120
> }
> ```
>
> ```json
> {
>   "id": "machine-specific-path-positive-control",
>   "goldenPath": "docs/concepts/golden-paths/adding-a-ci-gate.md",
>   "roots": ["scripts", ".ai"],
>   "extensions": [".mjs", ".js", ".cjs", ".sh"],
>   "signal": {
>     "pattern": "(?:REPO_ROOT|ROOT|PROJECT_ROOT|repoRoot|repo_root)\\s*=\\s*(?:path\\.)?(?:resolve|join|dirname)\\s*\\(|(?:REPO_ROOT|ROOT|PROJECT_ROOT|repoRoot)\\s*=\\s*process\\.(?:cwd\\(\\)|env\\.CLAUDE_PROJECT_DIR)",
>     "flags": "g",
>     "ignoreCommentLines": true,
>     "description": "POSITIVE CONTROL for machine-specific-path-in-tooling — the same anchor (how a tooling script establishes a filesystem location) pointed at the COMPLIANT form: a root derived from import.meta.url via resolve/join/dirname, from process.cwd(), or from CLAUDE_PROJECT_DIR. Measured 2026-08-15: 50 files / 53 sites, against 9 files / 10 sites for the violating form. A healthy non-zero here is what proves the violating pattern discriminates on the derivation FORM rather than on the token 'ROOT'. Carries NO baseline by design: a ratchet is monotone-downward and this count should RISE as the ten defects are fixed."
>   },
>   "floor": 120
> }
> ```
>
> ### And the instrument the census cannot be: a CI liveness assertion
>
> The finding this path exists for — **0 successes in 260 runs** — is invisible
> to every mechanism in this repo. Specification for the gate that would see it,
> written here so the next session does not have to re-derive it:
>
> - **Mechanism:** a scheduled workflow (or a `scripts/check-ci-liveness.mjs`
>   run from pre-push), not a census rule.
> - **Assertion:** for each workflow in `.github/workflows/`, query
>   `GET /repos/{owner}/{repo}/actions/workflows/{file}/runs?status=success&per_page=1`
>   and fail if `total_count === 0` while `?status=failure` is non-zero — i.e.
>   *"this workflow has run and has never once passed."* Today that fires on
>   **four of seven**.
> - **Instrument-before-result:** `exit 2` if the API returns zero workflows, or
>   if the token is absent — never `exit 0`, which is precisely how
>   `secret-scan.mjs` gets to be a no-op.
> - **Allowlist:** a workflow may be exempted only with a prose `reason` and an
>   expiry date, in the same file. `installer-test.yml` (0 runs ever) is the
>   first case it must handle: never-run is a different state from never-passed,
>   and both are worth a different message.
>
> This is the shape of gate the corpus has not built yet: one that checks
> whether the other gates produced a verdict. Given that 26 batches have now
> added enforcement into a CI that has never gone green, it may be the highest-
> value gate in the repo.
>
> ## 12 Corrections to the brief
>
> Six, of which two matter.
>
> 1. **"The binding-drift job exits 0 for an untracked file, which is the one
>    case it exists for."** **Fixed, and the brief is stale by one day.**
>    `ci.yml:396-401` now runs `git ls-files --others --exclude-standard
>    src/lib/bindings/` before the `git diff --quiet`, and fails on new
>    untracked bindings. Landed in `1f2d425b0`, 2026-08-14. `CLAUDE.md` still
>    carries the old claim in a blockquote. **The gate is fixed; the
>    documentation is not.** (Independently, the job is 5/20 in CI, so it does
>    sometimes pass — it is not among the never-green.)
> 2. **"DO NOT run `cargo` — blocked by a PreToolUse guard because the
>    operator's app is running."** **The premise is wrong; the instruction is
>    right for a different reason.** `scripts/build/guard-concurrent-cargo.mjs`
>    is *conditional*: it enumerates live `cargo.exe` processes and blocks only
>    if one is running and older than 5 s. Verified — `cargo test --help` ran
>    and exited 0. The real reason a developer cannot self-certify the Rust
>    gates locally is documented elsewhere in `CLAUDE.md`: on Windows
>    `cargo test` dies at `0xc0000139` before `main()` for want of a comctl32 v6
>    manifest, so `npm run test:rust` is the only working path — and it, plus
>    clippy, plus cargo-deny, is a multi-minute compile. I did not run heavy
>    cargo, correctly, but the guard is not what stops anyone.
> 3. **"`--quiet --max-warnings 99999` drops warnings before they can be
>    counted"** — confirmed exactly, and worth stating more sharply: the same
>    invocation **does** fail on errors. Verified both directions: a probe with 3
>    error-level findings → exit 1 under `--quiet`; a probe with 3 warn-level
>    findings → exit 0 under both the hook form and `eslint src/`. The hook is
>    not useless, it is *exactly as strong as the severity settings*, and 17 of
>    21 custom rules are warn.
> 4. **The brief asked how many gates "measure themselves" and named two.**
>    The answer is **three plus the census**: `check-csp-hosts.mjs`,
>    `check-corpus-integrity.mjs`, `check-themes.mjs:196` (`FATAL: could not
>    find :root block` → exit 2), and the runner's `assertRule`. Fourteen of the
>    seventeen bespoke check scripts have none. And the third self-asserting
>    script is the one whose self-assertion **fires on every machine but this
>    one** — the property meant to make it trustworthy is what makes it break
>    the chain.
> 5. **"How long does `npm run check` take — what does that do to whether
>    anyone runs it?"** The brief's premise pointed at `check:tiers`. Measured:
>    `check:tiers` is 216 s and `tsc --noEmit` is 218 s — **the typecheck is
>    marginally the more expensive of the two**, and it is paid *again* on
>    pre-push. The framing "three vite builds are why nobody runs it" is half
>    right; the honest number is 9 min 42 s of which 75% is two steps, and
>    `check:tiers` is additionally *duplicated* by a separate CI step.
> 6. **The brief's framing — "measure whether the gates in this repo actually
>    gate" — turned out to understate the problem by one level.** The
>    interesting finding is not that individual gates no-op. It is that the
>    *workflow they live in has never produced a passing run in 260 attempts*,
>    which makes the question of whether any individual CI gate would have
>    caught something academic. I would not have found that by auditing gates;
>    I found it by asking the Actions API a question no gate in this repo asks.
>    **The corpus's §9 sections have been specifying enforcement for a CI that
>    does not run.** That reframes 26 batches of work and is the single most
>    important thing in this document.
>
> ### A seventh, about my own measurement
>
> My first read of `check:i18n:strict` recorded **"prints FAIL, exits 0"** — a
> spectacular finding that was entirely an artifact of my own shell: I wrapped
> the command in `( … | tail -6 )` and then read `${PIPESTATUS[0]}`, which is
> the subshell's exit, which is `tail`'s. Re-measured without the pipe, the gate
> exits **1**, correctly. Same family as the `head -3` error in the doctrine:
> **the tool answered a different question than the one asked, and the answer
> was more interesting than the truth.** Both i18n gates are among the healthy
> ones — they fail when they should, and are green on the real tree
> (19,112 keys × 13 locales, 0 missing, 0 extra, 0 untranslated).
