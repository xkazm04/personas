# Run Findings & Iteration Log

Chronological reflection on real runs + the upgrades each one drove. Newest first.

---

## Run 4 — `grant-writing/test-coverage` (2026-05-27, test-coverage seed) — 🔴 BROKEN, caught a 3rd blocker: the 5-min EXECUTION TIMEOUT is too short for code work

**Headline:** another distinct, real blocker — **not the team's fault.** The grant-writing architect did *outstanding* work: it found the highest-damage untested path (`grantsGov.ts` normalization — the data front door), **wrote 21 unit tests**, **found and fixed 2 real pre-existing data-integrity defects** (a non-deterministic `Math.random()` id fallback that inserted duplicate rows instead of upserting; `toNum` returning `$0` for junk strings, distorting fit scores), ran the **full suite green (194 tests, +21)**, and wrote a thorough grounded ADR. Then the **execution was killed at exactly 300s** (`[TIMEOUT] Execution timed out, killing process` @ 300053ms) **mid-task** → status `failed` → success-gated cascade never started → BROKEN.

`cost:0`/`model:null` on the row are **kill artifacts** (cost is recorded from the final assistant message, which never arrived); the work itself landed on disk (`repoChanged:true` — the new working-tree detection caught it) and the suite was green.

**Root cause:** the persona `timeout_ms` default is **300000 (5 min)** — fine for a chat turn, far too short for autonomous *coding* (writing files + running a test suite). 34/35 SDLC team personas had it. A direct "works for weeks" blocker: productive coding turns get guillotined.

**Fix applied:** bumped all 35 SDLC team personas to **900000 (15 min)** via `update_persona` (verified partial-update — only `timeout_ms` touched; matches the companion's 15-min `TURN_TIMEOUT` precedent). Re-run grant-writing to confirm the cascade completes.

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
