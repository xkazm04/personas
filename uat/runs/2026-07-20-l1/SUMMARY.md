# UAT L1 — Synthesis (2026-07-20)

**Scope:** the core product loop — **create → execute → refine** — walked by 8 characters spanning 8 distinct business areas. 5 journeys × 20 character-journey walks, theoretical/code-grounded only (no live app). `refine-in-lab` is new this run; the Lab had never been covered by a UAT journey.

**Scorecard**

| Journey | Verdicts | Reached |
|---|---|---|
| `build-persona-from-intent` | 5× L1-conditional | clean to L2 with majors carried |
| `adopt-template` | 1× L1-conditional, 2× **L1-fail** | fail for sales + content |
| `run-and-review-execution` | 4× L1-conditional | clean to L2 with majors carried |
| `set-trigger-automate` | 1× L1-conditional, 2× **L1-fail** | fail for marketing + support |
| `refine-in-lab` | 1× L1-conditional, **4× L1-fail** | **worst journey in the sweep** |

15 blocker-severity findings, ~40 majors. Six claims were independently re-verified by the orchestrator (see `findings.json` → `orchestrator_verified`).

---

## The one theme that explains most of this run

**The product computes the right thing, shows it to a human, and then drops it before it reaches the next step.** This is not a metaphor — it is the same literal defect shape in eleven independent places, found by characters who never spoke to each other:

| What is computed | Where it dies |
|---|---|
| Judge `rationale` + `suggestions` (why a version scored badly) | declared in `labFeedbackLoop.ts:28-29`, never read |
| The resolved prompt sent to the model | logged as `Prompt length: N characters`, never persisted |
| Tool call inputs/outputs | truncated to 500/200 chars before persistence |
| `execution_config` (model, budget, turns, timeout) | persisted, typed, bound — rendered by no component |
| Judge-fair A/B comparator (`run_ab_test`) | correct, tested, zero callers |
| Improvement engine (`lab_improve_prompt`) | fully wired backend, `labImprovePrompt` has zero call sites |
| Version-comparison report (`abHtmlReport`) | implemented, `ExportReportButton` hardcoded to `mode="arena"` |
| `UserRating` → `lab_user_ratings` | component + command + table exist; `ArenaHistory.tsx:146` omits the props |
| Output-assertion guardrails | backend + typed API; `outputAssertions.ts` has zero importers |
| Self-service trigger UI (`TriggerConfig`/`TriggerList`) | zero importers; only reachable via a modal that locks the type |
| `input_schema` renderer (`UseCaseExecutionPanel`) | sole renderer of declared inputs; imported by nothing |
| `healthcheck_last_success`, `persona_recipe_links.config` | exist, never read |

This is not a backlog of missing features. **Most of the missing capability is already built and merely unwired.** That is the single most actionable fact in this report — the fix cost is far below what the finding count implies.

## Four structural findings that change what the product *claims*

**1. The Lab's central instrument is unsound.** Measuring a version swaps its prompt onto the persona; the prompt is hashed into the scenario cache key; so v3 and v4 are graded on **different LLM-invented exams**, and the Δ column subtracts those means matched on model only — under a doc comment reading "apples-to-apples". Every downstream Lab affordance (baseline pin, regression flag, ★, activation decision) inherits the unsoundness. `refine-in-lab` is the only journey to draw four L1-fails, and this is why.

**2. There is no confidence concept anywhere, but three surfaces advertise one.** `on_low_confidence` maps to `ReviewPolicy::On` — byte-identical to `always`. No execution or review model carries a confidence value. Worse, the *same label* inverts on the recipe-adoption path: `reviewModeToSetting()` maps it to `trust_llm`, which dispatch gives precedence and which auto-resolves the review row so it never reaches a human. **Two users picking identically-worded options get "review everything" and "review nothing".** This is the most dangerous finding in the run.

**3. Safety boundaries compile to prose, not interlocks.** `review_policy: always` appends a sentence asking the model to emit `manual_review`; the CLI underneath runs `--dangerously-skip-permissions` (`cli_args.rs:107`, `:282`); dispatch only reacts *after* the tool already ran. There is no denylist/allowlist field in `agent_ir` at all, so blast radius is unrepresentable. The pre-promote probe composes curl against real APIs with `BLOCKED_CURL_FLAGS` covering only file-IO — `-X POST` and `-d` pass.

**4. "Unattended" is a claim the architecture doesn't keep.** The only scheduler loop is in-process; `personas-daemon` is a Phase-0 scaffold behind `default = []` and ships in no build; there is no autostart or tray persistence. And nothing discloses this — `TriggerCountdown` renders a confident "next fire in 4h 12m" with no mention that closing the lid stops everything.

## Tier gating is a product decision that is currently invisible

Starter loses **Lab, Activity, and the entire Events/trigger surface**. Gated tabs are `filter`ed out of the DOM — there is no shown-but-locked state and no upgrade affordance anywhere for any `minTier` gate. So a non-technical Starter user doesn't conclude "I need to upgrade"; they conclude **the product cannot do this**. Meanwhile prompts are silently auto-versioned on every save into a history they can't read or restore.

Separately: **a large share of the seeded template catalog never loads in a shipped build** — sales 3 published / 8 not, finance 5/6, email 0/1. The Explore UI advertises categories (`outreach`, `growth`, `collections`) with zero templates behind them.

## Prioritized backlog

**P0 — the product misleads the user about safety or correctness**
1. `on_low_confidence` label inversion (`trust_llm` on the adoption path) — same words, opposite safety behaviour. *Fix the mapping, or remove the option until confidence exists.*
2. Lab Δ/baseline computed across different scenario sets — either pin the scenario set per persona-version-family, or wire the already-correct `run_ab_test` comparator and retire the Δ column.
3. `long_text` question type falls through to a single-line `<input>` — one renderer branch; blocks the only brand-voice grounding input in the marketing template.
4. `UseCaseExecutionPanel` unwired — users cannot pass a declared `input_schema` input to their own persona.
5. Draft test auto-passes `db_query` with `latency_ms: 0` while claiming to execute "against live APIs".
6. Promote reports "ready to use" while discarding `connectors_needing_setup`/`entity_errors`.

**P1 — already built, just unwired (cheapest value in the report)**
7. `labImprovePrompt` call site → makes "Improve" actually improve, and reconnects judge `rationale`/`suggestions`.
8. `onRate`/`userRatings` props in `ArenaHistory.tsx:146` → makes `lab_user_ratings` writable, which is the *sole* human-judgement feed into the improvement engine.
9. `ExportReportButton` mode plumbing → unlocks the version-comparison report.
10. `outputAssertions.ts` consumer → the only configurable quality gate.
11. Mount the self-service trigger UI (`TriggerConfig`/`TriggerList`), or delete it and own the Studio-only path.
12. Point `get_version_economics` at the same UNION `get_version_ratings` uses (or trigger eval) — panel is empty for 100% of users while the tour advertises it.

**P2 — evidence & operability**
13. Persist the resolved prompt (the Companion already does this to `~/.personas/debug/prompts`).
14. Raise/΄remove tool-call truncation, or store full payloads out-of-band.
15. Notification `execution_failed` split + delivery retry + fix `use_case_id: None` silently dropping scoped channels.
16. Tool-call idempotency on timeout/rate-limit retries (currently re-applies side effects up to 3×).
17. Disclose the app-must-be-running contract at arm time; distinguish a dead trigger from a new one.
18. Promote baseline pin from `localStorage` to SQLite; carry `persona_prompt_versions` through duplicate/export/publish.

**P3 — segment reach**
19. Shown-but-locked tier gating with an upgrade path.
20. Publish the template backlog, or stop advertising empty categories.

## Strengths worth protecting (do not touch while fixing the above)

- **The production learning loop genuinely closes.** Verified on *both* the write path (reviewer notes → memory row) and the read-back path (`get_for_injection_v2` → `pack_by_budget` → `## Agent Memory — Recent Learnings`). Two independent characters confirmed it. This is the best thing in the product.
- **Scheduler semantics are senior-grade**: overlap skip-with-signal, O(1) drift-free interval anchoring, startup catch-up, invalid timezones *refuse* rather than replay, chain hops carry `chain_trace_id` with quarantine + dead-letter.
- **Failure taxonomy + retry ladder**: 11 typed categories, real usage-limit reset parsing, durable retries surviving restart, per-persona storm cap.
- **Honest-failure contract**: the build injects a mandatory anti-fabrication clause, and `simulate_build_capability` is a *real* dry-run through `execute_persona_inner`.
- **Lab score-degradation disclosure**: `degraded_count`/`partial_coverage` amber warning, and Ollama's `$0` shown as "not tracked" rather than "free". Ironically the most careful provenance work in the app — applied to the one number that turned out not to matter.
- **Nothing self-mutates in a shipped build** (AI healing is dev-gated).
- **`duplicate_persona`** clones triggers *disabled* and reports what it couldn't copy.

## Panel verdict — winning and losing segments

**Winning: nobody outright, but the technical segment gets closest.** Sam (IT) and Marcus (dev) both found the *engine* better than they expected — and both stopped at the same wall: they can't get evidence out of it. "Great orchestration, blind autopsy." "Great engine, don't trust the pager yet."

**Losing structurally: the entry tier.** Dani (marketing, Starter) drew **L1-fail on two of three journeys** and cannot reach a refinement surface at all. She is the clearest signal in the run: the app can build her an agent, cannot show her how it's doing, cannot let her improve it, and never tells her a better tool exists one tier up.

**Losing on the core promise: the refinement loop.** Four of five Lab walks failed. The Lab is the surface that makes iteration possible, and Yuki's verdict — *"a student writing their own exam"* — is precisely right at the code level: scenarios are generated from the persona's own prompt, graded by an LLM with no source of truth, with human ratings unwritable and real corrections invisible.

**One-sentence panel verdict:** *the engine underneath is genuinely strong and getting stronger, but the product currently cannot show a user what it did, cannot let most users improve it, and in three places tells them it is safer than it is.*
