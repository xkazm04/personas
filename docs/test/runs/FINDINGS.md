# Run Findings & Iteration Log

Chronological reflection on real runs + the upgrades each one drove. Newest first.

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
