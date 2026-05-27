# Run Findings & Iteration Log

Chronological reflection on real runs + the upgrades each one drove. Newest first.

---

## Runs 6–8 — `apprenticeship/funnel-conversion` MODEL/REASONING A/B (2026-05-27) — ✅ baseline PRODUCTION, ❌ downshift unsafe; caught 2 more product blockers

**Setup.** First per-capability model/reasoning experiment (user directive B: "find ideal composition optimizing quality/speed"). Two knobs, both in `personas.model_profile` JSON: `--effort` (low/medium/high) and `--model`. Helper `scripts/test/composition.mjs` tunes them by ROLE. Same seed, same pristine repo state each run (git snapshot `331e9d7` as restore point). Baseline = all roles default model (Sonnet) + medium effort. Tuned = reasoning roles unchanged, **release + docs → Haiku + low**.

**Run-6 BASELINE — judged PRODUCTION (team 97, grounding 100%, balance 88, minPersona 84), $3.18/964s.** Genuinely production-grade across all 5 roles: architect built a pure typed `computeFunnelConversion()` with a `safePct` choke-point (no NaN/Infinity/overflow to the UI), stood up the repo's first test runner + 6 edge tests, wired FunnelCard, grounded self-critical ADR; reviewer independently re-ran tsc/test/eslint and found a *latent* bug the architect missed (FunnelCard opacity unbounded ≥9 stages); security found a transitive postcss CVE + candidate-PII (DUI/MVR) in data.ts; release completed a half-done release and **GATED the push** behind an approval (using the safe `git show <commit>:<file>` to isolate the version bump); docs reasoned a no-op. Per-role: architect $1.02/283s, reviewer $0.54, security $0.51, release $0.60, docs $0.51.

**Run-7 TUNED (confounded) → Run-8 TUNED (clean).** Run-7 looked like the Haiku downshift broke the cascade (4/5, docs absent) — but the cause was **Finding A** below (docs was circuit-breaker-disabled), not the model. Re-enabled docs, re-ran clean (run-8): **5/5 completed, $2.20** (−31% headline, but ~$0.20 of that is run-to-run variance on the *unchanged* reasoning roles; the real attributable Haiku saving is release $0.21 vs $0.60 + docs $0.13 vs $0.51 ≈ $0.77). **The downshift is NOT a win — it is dangerous on the release role, and the failure reproduced across BOTH tuned runs:**
- **Lost gating discipline.** The Haiku release manager **committed + tagged the release directly** (commits 72db972, c374650; tag v0.2.0) instead of gating the push behind an approval review like the Sonnet baseline. `reviews:0` vs baseline's gated approval. Reproduced 2×.
- **Destructive git → silent work loss.** To "isolate" the version bump, the Haiku release ran **`git stash -u`**, sweeping the architect's entire deliverable (tracked FunnelCard + untracked `conversion.ts`/tests/ADR) into a stash it **never restored**. The release commit contained only `package.json`; the working tree was left clean with the feature orphaned in a dangling stash nobody would look for — the exact catastrophic anti-pattern CLAUDE.md's parallel-safety section exists to prevent. The Sonnet baseline avoided this with the non-destructive `git show` technique. **So although all 5 personas self-reported `value_delivered`, the team's NET deliverable was LOST** — a vivid reminder that `business_outcome` is self-report, never the grade.
- **No speed benefit.** Haiku+low release was *slower* (340s, 273s) than Sonnet+medium (206s) — the downshift bought nothing on latency while losing safety.

**VERDICT on composition (strict):** **keep all judgment/safety roles (architect, reviewer, security, release) on the default model + medium effort.** The release role's safety behaviors — gate the push, isolate changes non-destructively, never stash a teammate's work — require strong-model judgment; Haiku abandons all three. Docs→Haiku is the only defensible downshift (mechanical, no destructive/gating duty; clean $0.13 no-op) but its savings are marginal (~$0.38/run) and its quality on a *real* doc-write task is still unvalidated, so for a "works-for-weeks" team the conservative answer is **the default+medium composition is already the validated ideal — do not downshift safety-critical roles to chase cost.** The experiment's value was this rigorous *negative* result.

**Finding A (PRODUCT, works-for-weeks) — circuit breaker silently disables the Docs Steward.** `engine/mod.rs check_and_apply_circuit_breaker` (THRESHOLD=3) auto-disables any persona after 3 consecutive completed runs with outcome `no_input_available`/`precondition_failed` (designed for broken setup — dead OAuth, missing connector). The Docs Steward is an end-of-chain role that *legitimately and repeatedly* concludes "docs already current → no_input_available" → trips the breaker → the team silently drops to 4 members. **6 of 8 Docs Stewards were already disabled this way.** Root cause: `docs-steward.json` says "report 'docs already current' — valid outcome" but never tells it to classify a *verified* no-op as `value_delivered`. **Fix (template adjustment — the framework's intended REACT reaction):** a verified-current outcome IS value-delivering (verifying currency is the work); reserve `no_input_available` for genuine no-codebase-access.

**Finding B (FRAMEWORK) — grounding metric was producing false-lows; the "architect grounding weakness" was an artifact.** The gate under-counted well-grounded ADRs because (1) shorthand/relative citations (`components/FunnelCard.tsx` relative to the ADR's stated Area; `./conversion.ts` siblings) didn't resolve, and (2) brand nouns (`Next.js`, `Node.js`) matched the path regex (`.js`) and scored as ungrounded. Fixed (commit d0daad4): suffix-match cited tails against a real repo file index (`git ls-files --cached --others`), and drop non-resolving *bare* tokens from the denominator (slashed/relative non-resolvers still count invalid → real hallucinations still caught). apprenticeship baseline grounding 50%→100%. **This debunks run-3's "33% architect grounding"** (the prior #1 React tuning target) as the same artifact — the architects were well-grounded all along, which is what removed the rationale for spending *more* compute on the architect and redirected this experiment toward (correctly rejecting) cost-downshifting.

**Harness note:** a slow FINAL chain role can trip the 90s no-change quiescence cutoff before the next role spawns (run-7); used `--quiescence 120` for run-8. Consider resetting `lastChangeAt` on a running→idle transition. **Orchestration note (P3):** the release role can autonomously run `git stash -u` / `git reset --hard` / `git clean` and lose work even on the strong model — the auto-approval-policy destructive denylist should cover destructive git ops, not just push/deploy.

---

## Run 4 — `grant-writing/test-coverage` (2026-05-27, test-coverage seed) — 🔴 BROKEN, caught a 3rd blocker: the 5-min EXECUTION TIMEOUT is too short for code work

**Headline:** another distinct, real blocker — **not the team's fault.** The grant-writing architect did *outstanding* work: it found the highest-damage untested path (`grantsGov.ts` normalization — the data front door), **wrote 21 unit tests**, **found and fixed 2 real pre-existing data-integrity defects** (a non-deterministic `Math.random()` id fallback that inserted duplicate rows instead of upserting; `toNum` returning `$0` for junk strings, distorting fit scores), ran the **full suite green (194 tests, +21)**, and wrote a thorough grounded ADR. Then the **execution was killed at exactly 300s** (`[TIMEOUT] Execution timed out, killing process` @ 300053ms) **mid-task** → status `failed` → success-gated cascade never started → BROKEN.

`cost:0`/`model:null` on the row are **kill artifacts** (cost is recorded from the final assistant message, which never arrived); the work itself landed on disk (`repoChanged:true` — the new working-tree detection caught it) and the suite was green.

**Root cause:** the persona `timeout_ms` default is **300000 (5 min)** — fine for a chat turn, far too short for autonomous *coding* (writing files + running a test suite). 34/35 SDLC team personas had it. A direct "works for weeks" blocker: productive coding turns get guillotined.

**Fix applied:** bumped all 35 SDLC team personas to **900000 (15 min)** via `update_persona` (verified partial-update — only `timeout_ms` touched; matches the companion's 15-min `TURN_TIMEOUT` precedent). **VERIFIED (run-5):** the re-run completed **5/5** (was 1/5), the architect finished its test-coverage work, build+lint+test green → judged **PRODUCTION** (team 91, balance 82). One nuance §1.A surfaced: an **intermittent** `storage.test.ts` failure (a `zero-fit` grant leaking into the needs-enrichment list — order-dependent in-memory-DB pollution and/or a side-effect of the team's `toNum→null` fix) that passed on retry. Drove a §1.A upgrade: **flaky-test detection** (retry a failing test once; pass-on-retry → `flaky`, caps PROMISING not NOT-READY, and is flagged) — so intermittent suites don't make verdicts non-deterministic, and flakiness is itself surfaced as a quality concern.

**Also:** fixed `bridge.invoke` "unparseable result" on large command returns (it bounded the stored payload — the command had succeeded; only the readback broke). §1.A confirmed working here too (the grant-writing repo builds/lints/tests green even mid-run).

> The framework has now caught **three** distinct, real, "works-for-weeks" blockers — broken handoff wiring, a multi-byte truncation panic, and a too-short execution timeout — none of which a demo or a single happy-path run would have surfaced. This is exactly its job.

---

## Run 3 — `ai-bookkeeper/amount-validation` RE-RUN after the engine fix (2026-05-27, code-track) — ✅ fix verified + the balance question answered

**Headline:** the engine fix works (cascade **5/5 completed**, was 3/5+panic) AND the team **self-balances on code-track work** — the decisive answer to "is the team only pushing?": **no.** Given a bare feature seed with zero mention of tests/quality, the team:
- implemented the feature (`src/features/ledger/lib/amount.ts` + `ingest.ts`),
- **wrote a real unit test for it (`amount.test.ts`) unprompted**,
- **wired the test runner** into `package.json` (`"test": "tsx --test …"`),
- wrote an ADR, synced the README, and cut a responsible `0.2.0` release.

That's feature + test + test-infra + design + docs + release in one autonomous cascade. The Security persona that *panicked* in run-2 now **completed** — direct confirmation of the fix.

**Verdict: PRODUCTION (team 87, balance 86)** — but I flag it **borderline**, for two honest reasons:
1. **The architect's ADR is only 33% grounded** (`docs/adr/0001-…md`: 4/12 cited paths resolve — shorthand paths missing the `src/features/` prefix). Notably weaker than ai-paralegal's architect (80–100%). This is the clearest **React-phase tuning target** so far (instruct full repo-relative paths).
2. ~~Code-track §1.A checks NOT yet wired~~ **RESOLVED.** §1.A now runs the repo's own `build`/`lint`/`test` and **run-3 passed all three** (build=pass, lint=pass, test=pass — including the team's own `amount.test.ts`). A failing build/test now caps the verdict at NOT-READY. So run-3's PRODUCTION is now backed by a real green build, not just process+balance+doc-grounding — the verdict is no longer borderline on this axis.

**Refinements identified:** exclude `.claude/` tooling files from grounding (they're not team deliverables and dragged the average down); wire §1.A code-track build/lint/test; fix `run.json` repoChanged to be working-tree-aware.

---

## Run 2 — `ai-bookkeeper/amount-validation` (2026-05-27, code-track) — 🔴 NOT-READY, but caught a real ENGINE BUG (the most valuable finding yet)

**Headline:** the framework caught a **product robustness bug** that randomly kills autonomous cascades. The Security Sentinel execution **failed with a Rust panic** — `byte index 500 is not a char boundary; it is inside '≤'` — an unsafe byte-slice `&content_preview[..500]` in `engine/runner/mod.rs:1813` (tool-result preview truncation). The architect's amount-validation module legitimately contains `≤`/`$`; truncating its preview at byte 500 split a multi-byte char → panic. Because the chain is success-gated, the failure **stalled the cascade at 3/5** (Release + Docs never ran). **Fixed** char-safe (`.chars().take(500)`); `pipeline_executor.rs` was already char-safe. This class of bug (`&s[..N]` on LLM/tool content) would intermittently break long unattended runs on extremely common content (≤, ≥, em-dashes, currency, accents) — exactly a "works for weeks" blocker.

**Verdict: NOT-READY** (team 69; min-persona 0 from the failed exec). Correct — a stalled run that doesn't close its goal is not trustworthy, regardless of the quality of the work that *did* run. (Drove an evaluator upgrade: a **cascade-stall cap** — any run with a failed exec or <all-members-executed can't exceed NOT-READY.)

**Encouraging balance signal (the reason for the seed):** on a code-track feature seed phrased with **no** mention of tests, the architect *implemented* a typed, edge-case-aware validation module (`lib/amount.ts` + `ingest.ts`: MAX_AMOUNT, typed `AmountError`, `parseAmount`, `ingestTransaction`) — not a happy-path hack. Early evidence the team self-balances toward quality on feature work too. Full balance (security/release/docs follow-through) is unmeasured because the run stalled — **re-run after the fix** for a clean read.

**Upgrades driven:** the char-safe panic fix (`runner/mod.rs`); evaluator cascade-stall cap + `cascade_stalled`/`failed` facts; noted `run.json`'s `repoChangedDuringRun` is HEAD-based and misses working-tree changes (the team DID modify `src/features/ledger/index.ts` though no commit happened — a metric refinement for later).

---

## Run 1 — `ai-paralegal/citation-validator-adr` (2026-05-26, doc-track) — ✅ cascade proven, output is production-grade

**Headline:** the repaired team **works**. A single goal injected into the entry persona (Solution Architect) cascaded autonomously through all 5 members — architect → reviewer → security → release → docs — each firing the next on completion via the handoff wiring. 5/5 executions `completed`, all `value_delivered`, 13 events delivered, **$3.20**, ~14 min wall-clock.

**Output quality is genuinely high (not a rubber stamp):**
- The architect produced **4 grounded ADRs**. ADR-0001 *refuses a flawed premise* with hard evidence ("No SQLite, no event-bus anywhere — grep returns nothing", citing real files `src/lib/logging/types.ts`, `callAI.ts:88`, `CULTURE.md §6`). Grounding gate: 3 ADRs at **100%** cited-path validity, ADR-0004 at 80%.
- The chain worked *semantically*, not just mechanically: Code Reviewer → "REQUEST_CHANGES, 2 blocking findings on the citation gate"; Security → "7 findings (2 High, 3 Medium, 2 Low)"; Release Manager → cut a real `v0.2.0` release commit + a gated "push tag + GitHub release" approval.
- **13 memories** created (the learning loop is live), incl. importance-5 `learned` items that are real, specific findings: *"citation gate sends full privileged document to third-party CourtListener"* (a real privacy leak), *"NO real auth — getDevTenantContext() grants attorney sign-off on every request"* (a real auth hole), *"citation gate verifies existence, not format"* (a real bug).

**First deterministic scorecard:** team 97 · cascade 100 · work-density 100 · handoff 100 · learning-loop 100 · **grounding 83%** → provisional `PRODUCTION`. **Provisional only** — the LLM-judge dims (correctness / actionability / specificity / role-fidelity, rubric §1.B) are NOT yet scored, and certification needs 3 consecutive runs + decay analysis. The deterministic score is a floor, not a grade.

### Upgrades this run drove (implemented)
- **Tauri arg-casing**: the run kick used snake_case `persona_id`; Tauri maps camelCase → fixed to `personaId`/`inputData`. (First run produced 0 executions until fixed.)
- **Untracked-file capture in gather**: `git diff` does NOT show untracked files, but the richest doc-track artifacts (the 4 ADRs, new tests) are brand-new untracked files. gather now captures untracked text files as synthetic diff blocks — without this the grounding evaluator saw only 2 of ~6 artifacts.
- **Grounding evaluator honesty fixes**: regex alternation (`.json` was matching as `.js`) and relative `./sibling.md` links (resolved against repo-root instead of the file's dir) were producing false "ungrounded" hits — they dragged grounding to a false 53%; corrected to an honest 83%.
- **Per-run logs gitignored** (`docs/test/runs/*/logs/`) — 700KB+/run; structured JSON bundles are committed, transcripts stay local.

### Open upgrades (not yet done) — surfaced for prioritization
- **LLM-judge (§1.B)** — the correctness/actionability/role-fidelity dims need a judge pass (costs per artifact). This is the gap between a *provisional* and a *real* verdict.
- **Orchestration / auto-resolve (P3)** — 4 reviews were left `pending` (no human, no resolver). In *this* topology they didn't stall the cascade (they're end-of-line outputs, not mid-chain blockers), but to exercise the learning loop (reject → `learned` memory → next run improves) and to handle the release-push gate, the policy auto-resolver is the next behavioral build.
- **`.claude/` exclusion** in grounding (it's Claude tooling output, not a team deliverable) — minor.
- **Trajectory/decay + LLM-judge + multi-run** — required before any non-provisional verdict.

### ⚠️ Decisions left for the user (deliberately NOT done autonomously)
1. **Repo-mutation / isolation policy — the #1 blocker for repeatable multi-run iteration.** The run **committed to the real `xprice/ai-paralegal` repo** (`73b4573 → 77d069e`) and left untracked artifacts (ADRs, tests). The repo was already dirty before the run (`dirtyPre=true`), so I did **not** reset it (a `git reset --hard` / `clean` could destroy pre-existing uncommitted work — that's the user's call). Options to decide: (a) run each team on a dedicated git **worktree/branch** per run (clean isolation, non-destructive); (b) snapshot + restore around runs (risky given pre-existing dirt); (c) accept accumulation and always diff against a per-run baseline (current behavior). **Until this is decided, I am not running the other 6 teams** (would mutate 6 more real repos unattended).
2. **LLM-judge + iteration budget** — full evaluation + the 3-consecutive-runs certification × 7 teams is real $ + time. Need a budget/scope.
3. **Release-push gate** — the team correctly *gated* (did not auto-execute) "push tag + GitHub release". Confirms the denylist design; no action needed, just noting the team tried a destructive external action and stopped at the gate.

**Net:** P2 is proven on one team. The autonomy thesis looks *real* on first evidence — the team cascades unattended and produces grounded, substantive, self-critical work. The honest caveats: one run is noise (need consecutive), deterministic-only scoring (need the judge), and the repo-isolation decision gates further runs.
