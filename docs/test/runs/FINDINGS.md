# Run Findings & Iteration Log

Chronological reflection on real runs + the upgrades each one drove. Newest first.

---

## Phase 1 structured-shared-memory — RE-MEASURED: cost curve FLATTENED +115% → +5.7% (2026-05-27) ✅

After wiring Phase 1 (route review-feedback to the bounded shared `team_memories` ledger as typed decisions/constraints + inject a compact team digest on the cascade path — commit 3d72e7c60), re-ran the SAME longitudinal protocol (3× `local-seo/parallel-utils`, 6-role team, repo reset each iter, reviews resolved).

| | iter 1 | iter 2 | iter 3 | rise across 3 |
|--|--|--|--|--|
| **Before Phase 1** | $3.82 | $5.35 | $8.23 | **+115% (2.2×, compounding)** |
| **After Phase 1** | $5.44 | $5.51 | $5.75 | **+5.7% (≈flat)** |

**The compounding is gone** — per-run cost stabilized (~$5.5) instead of doubling. Quality held flat at PRODUCTION 96 (task at ceiling). Verified the mechanism actually fired: the 6-role team accumulated **9 shared `decision` records** in `team_memories` (deduped by title, eviction-bounded) and the digest injected into every member once populated (`[TEAM-MEM] Injected …` in 6 logs/run from iter-2 on; iter-1 had 0 because the ledger started empty). This is the LONGEVITY property the design targeted: durable knowledge now lives in the bounded shared ledger, so **knowledge compounds without cost compounding**.

**Honest caveats (→ what's left):**
- **Absolute cost is elevated** (~$5.5 vs the original $3.82 first-run) because the pre-existing **per-persona memory pile** (learned=86, access=499 at start, from all prior runs) is large and still grows slowly via the personas' own `agent_memory` writes (+6 learned/iter). Phase 1 stopped the *slope* from compounding; it did NOT shrink the existing L1 pile. **Phase 2 (L1 hygiene — token-budgeted injection + dedup-by-meaning + aggressive archive)** is what brings the absolute level down.
- **L3 (Obsidian graph) not yet reachable by the team:** vault is connected, but the SDLC personas run with `mcp_servers:[]` (personas-mcp unwired) + the vault-tools gate is off → graph read/write needs MCP wiring (Phase 1b).
- Harness metric `review_loop_converted` updated to count `team_memories` (the conversion now lands in L2, not per-persona).

**Verdict:** Phase 1 delivered its core promise — the works-for-weeks cost-compounding curve is flattened. Phase 2 (hygiene) reduces the absolute cost; Phase 1b (L3 wiring) adds relational graph recall.

---

## Longitudinal run (3× same seed, memory persists) — 🔶 CAUGHT a real "works-for-weeks" degradation: MEMORY BLOAT → cost compounds with flat quality (2026-05-27)

First cross-run measurement (`scripts/test/longitudinal.mjs`): ran `local-seo/parallel-utils` 3× on the 6-role team, repo reset to a clean base each iteration (same task fresh) while MEMORY persists, resolving the run's reviews each time (feeding the now-wired review→learned loop). This is the long-running-team axis the rubric never measured (its trajectory/decay was within a single run).

**Result — the loop fires, but the trajectory is BAD:**
| iter | verdict | cost | execs | mem total | learned | reviews→learned |
|--|--|--|--|--|--|--|
| 1 | PRODUCTION 96 | $3.82 | 6 | 64→99 | 31→60 | 23 |
| 2 | PRODUCTION 96 | $5.35 | 6 | 99→115 | 60→70 | 4 |
| 3 | PRODUCTION 96 | **$8.23** | 11 | 115→142 | 70→86 | 5 |

- **Quality flat** (96/96/96 — task is identical + team at ceiling).
- **Cost RISING 2.2× over 3 runs** ($3.82→$8.23), driven by **memory bloat**: the `active` tier grows unbounded (64→142 in 3 runs, nothing archived), so EVERY role's injected-memory prompt grows every run → per-role cost ~tripled (Reviewer $0.53→$1.46, Security $0.53→$1.28, Release $0.73→$1.62, Docs $0.60→$1.38); iter-3 also spawned extra executions (6→11).
- **Learning loop confirmed working** (32 reviews→learned over the run; `access` +365 = memories are being injected/reused), but accumulating memory + prior-feedback is a **pure cost regression** here — it does NOT lift quality (already at ceiling) and steadily inflates cost.

**The finding (and why it matters):** a team that gets ~2× more expensive every few runs while not improving is NOT "works for weeks" — it's economically unsustainable, and a single-run eval (every run is PRODUCTION 96!) would never reveal it. The longitudinal eval exists precisely to catch this, and did on run one. **Root cause = missing memory hygiene:** the working→active→archive lifecycle doesn't prune/demote, near-duplicate `learned` memories pile up (the review-loop synthesizes one per resolution — many near-identical "Human approved …"), and injection is count-capped (40 active) but not TOKEN-budgeted, so growing content still inflates cost.

**Next product fix (tracked):** memory hygiene for long-running teams — aggressive archive/demote of stale + low-access memories, dedup of near-identical `learned` items, and a TOKEN-budgeted injection (not just a count cap). Re-run the longitudinal after to confirm cost flattens (or falls) while quality holds — THAT is the "works for weeks" bar. Also: drive longitudinal with a VARYING workload (not the identical task) so quality has room to show improvement, not just ceiling-flat.

---

## Runs 13–14 — Dev Clone PARALLEL TASKS (Phase A) validation (2026-05-27) — ✅ clean environment, sound judgment; true fan-out = engine work

Validated the parallel-engineer mechanism (commit aa3d55a6e): `max_concurrent` 1→4
+ a PARALLEL TASKS discipline (per-task git worktree+branch → merge → full-suite
green → clean, no orphans). Both runs on the 6-role local-seo team:

- **Run-13 (test-coverage, interdependent tasks):** 6/6, $3.81, 28 tests green,
  **environment clean**. Dev Clone: *"one cohesive work order on shared files
  (interdependent tasks, not parallel-isolatable)"* → implemented directly. Correct.
- **Run-14 (3 file-disjoint utility modules, deliberately independent):** 6/6,
  $4.03, **31 tests green**, all 3 modules (slug/num/str + tests) landed,
  **environment clean** (no `.parallel/`, no orphan worktrees/branches). Dev Clone:
  *"confirmed file-disjoint... isolation moot once integrated + conflict-free, so
  skipped the worktree/merge flow."* Also correct.

**Conclusion:** the worktree-isolation path earns its keep ONLY under genuine
CONCURRENT contention (multiple executions writing the same repo simultaneously);
for sequential file-disjoint work in a single execution there's no contention, so
skipping it is right — and Dev Clone reasons to that correctly. The
clean-environment guarantee (the user's "merge/clean the environment" ask) holds
across both runs. **True `one-breakdown → N-concurrent-executions` fan-out is an
ENGINE concern, not promptable:** (1) execution cwd is the per-persona workspace,
not the repo root (prompt-level `git worktree` is awkward); (2) chain layer has
cycle-detection + depth-8 + no join primitive. Phase B (ADR): an engine fan-out
with automatic per-execution worktrees + a join-barrier trigger that fires the
integrate+clean once all N tasks finish. Phase A (shipped) = discipline + clean-env
+ concurrency capacity + correct judgment.

> Side note: in run-14 the *architect* implemented the three modules directly
> (concrete "implement X,Y,Z" seed), and Dev Clone found them and committed —
> the same "architect implements when the seed is concrete" pattern seen in
> immigration. Role-boundary nuance worth watching, benign here.

---

## Runs 11–12 — RESOLVING THE IMPLEMENTER GAP: add Dev Clone to the SDLC team (2026-05-27) — ❌ "add the role" failed → ✅ TEAM MODE fix works

**Why:** run-10 exposed that the 5-role SDLC preset (architect→reviewer→security→release→docs) has **no implementer** — the architect's own template hands off to "a delivery agent" that had been removed, so delegated build work was planned but never built. User direction: the original teams had Dev Clone (development capability) + product/backlog roles; extend the team and re-run. Personas are multi-capability (each use_case independently enable-able), so the fix is to add Dev Clone, not author a single-purpose agent.

**Preset extended (commit b021fa06c):** `sdlc-lifecycle` is now 6 members — **Dev Clone added as the `engineer`** between architect and reviewer (architect→engineer→reviewer→security→release→docs→feedback). Adopted a fresh 6-role team pinned to the local-seo repo (had to pin Dev Clone manually — its codebase question maps to a connector credential, not `devProjectId`).

**Run-11 (add-the-role only) — STILL didn't build.** 6/6 completed, but the repo was untouched (0 changes, no tests). Root cause, precisely: **Dev Clone's build capability (`uc_implementation`) is gated behind its own human-triage + GitHub-PR workflow** (`backlog_scan → triage → human-accept → implement-as-PR`). On a team handoff it fired **`uc_triage`** (which needs a human) instead of implementing. Compounding it, the **architect re-used its ADR from run-10's memory** and re-affirmed the plan rather than driving a build. Lesson: dropping a solo, human-in-the-loop agent into a team cascade does **not** make it a team implementer — its capabilities are wired to its own event chain, not the handoff.

**Fix — TEAM MODE prompt.** Prepended a HIGHEST-PRIORITY instruction to Dev Clone (live persona `structured_prompt`+`system_prompt`, and baked into the `dev-clone.json` template): *a team handoff carrying an architect task breakdown is an approved work order → run `uc_implementation` DIRECTLY: implement each task on the codebase with file_write, run the test command to green, commit; no backlog scan, no human triage, no GitHub required; a plan/ADR is NOT an acceptable deliverable — leave real code/tests on disk.*

**Run-12 (TEAM MODE) — ✅ RESOLVED, judged PRODUCTION (team 96), $3.73, 6/6.** Dev Clone (engineer, $0.60/174s) actually **built**: stood up the `node --test` harness, wired the `test` npm script, wrote `src/lib/format.test.ts` + `src/features/rankings/rank.test.ts` (**27 tests, all green** — real edge cases: U+2212 minus, half-expand rounding, NaN, negative-zero, large values), AND fixed the hidden-rank-drop defect the architect flagged ("Release v0.2.2: fix hidden rank drops + test harness"). The full cascade now delivers working software: plan → **implement (tests + bug fix)** → review → security → release → docs. The implementer gap is closed. (Nuance: Dev Clone committed on a `dev-clone/` branch per its native PR instinct — the work is real + on disk; a future tweak could keep team work on the working tree for cleaner §1.A grounding/diff capture.)

**Also fixed this session (commit 994268a2): premature quiescence** — the handoff-aware quiescence held cleanly across all three 6-role runs ("no owed handoffs" gate).

**Open follow-ups:** the architect re-using a stale memory ADR to re-plan (rather than letting the build proceed) is benign now that Dev Clone builds, but worth watching; the deleted **Artist (UI/brand)** and a true **product/UI backlog** role remain un-restored (Dev Clone's `uc_backlog_scan` covers code/tech-debt backlog only) — separate from the build loop, tracked for a later pass.

---

## Runs 9–10 — parallel corpus: `immigration` ✅ PRODUCTION + `local-seo` 🔴 NOT-READY (2026-05-27) — caught the implementer-gap + a harness quiescence bug

**Higher-traffic test (directive A):** ran immigration + local-seo **concurrently** (2 teams, up to 10 personas) on the validated default+medium composition.

**Run-9 immigration/criteria-stabilization — judged PRODUCTION (team 97, grounding 100%, balance 90, minPersona 85), $3.25/942s, 5/5.** The sharpest defect-find of the corpus: the architect found that `CriteriaTable.tsx` hardcoded `1 partial` while computing `met` from data — the eligibility badge **silently lies** the moment criteria data changes. It extracted a pure `summarizeCriteria` aggregator (excludes malformed rows), wired the table, wrote a 4-case regression test (the repo's first), and verified tsc-clean + byte-identical render. Reviewer independently re-ran tests/tsc/Badge-contract; security found the postcss CVE; release versioned; docs synced (value_delivered — confirming the re-enabled Docs Steward works post circuit-breaker recovery). Default model handled the release cleanly (contrast the Haiku release work-loss in runs 6–8).

**Run-10 local-seo/test-coverage — NOT-READY (team 97, grounding 85%, build+lint pass, TEST=FAIL), $2.60/5-of-5.** §1.A correctly capped it: `npm test` errors **"Missing script: test"** — **no test runner was wired and no test files were written**, even though all 5 personas self-reported `value_delivered`. Root cause is a real **team-composition / seed-phrasing finding**, NOT a model issue:
- The SDLC roster (architect/reviewer/security/release/docs) has **no implementer**. The architect is an *analysis* role; it produced ADR-0001 + a 5-task plan ("recommend node --test via tsx") and handed off via `architecture.analysis.completed`, expecting downstream to build — but downstream only reviews/audits/ships/documents. Nobody wrote the tests.
- **Seed phrasing decides whether work gets built.** immigration ("identify… and **fix it** with a regression test") and apprenticeship ("design and **implement**… a unit test") addressed the architect directly → it implemented (and wrote tests). local-seo ("**have the team** stand up a test runner…") read as delegation → the architect planned and delegated into a void.
- Implication for the autonomy thesis: the team is reliable for stabilization/feature/fix goals (architect self-implements) but **unreliable for goals phrased as "delegate to engineers" when there is no engineer**. Fixes: (a) write seeds/goals that address the entry persona directly (and re-run local-seo to confirm it then delivers); and/or (b) the SDLC preset likely needs a dedicated implementer role, or the architect's contract must explicitly own implementation, not just analysis. This is a candidate REACT/preset change, tracked but not yet made.

**Harness bug fixed (commit 994268a2): premature quiescence under parallel load.** immigration first gathered at **2/5** while its cascade was *still alive* — security started at the exact second the harness quiesced. Cause: between a role finishing and the next *starting*, there is a brief `running===0` gap; under concurrent load the handoff→spawn latency exceeds the no-change window, so the harness stopped while work was in flight. Fix: quiescence is now **handoff-aware** — it will not stop while a delivered/pending `team_handoff.*` is owed to a member that hasn't executed, and keeps the window open while one is outstanding. Added `scripts/test/regather.mjs` to rebuild a bundle after the team truly finishes (used to recover immigration's real 5/5). local-seo completed within-window even in parallel, so its bundle was already complete.

**SCOREBOARD (judged):** ai-paralegal PROD(95) · ai-bookkeeper PROD(92) · grant-writing PROD(91) · apprenticeship PROD(97) · immigration PROD(100→97) · local-seo NOT-READY(test-coverage undelivered). 5 PRODUCTION across 5 distinct teams + 1 honest NOT-READY that exposed a real team-composition gap.

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
