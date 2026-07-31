# Batch 3 Design — "Self-Improvement" (2026-07-30)

> Five moonshot v1 slices in parallel: **"Everything that runs, learns."** Branch:
> `vibeman/moonshot-batch3-2026-07-30` (off batch-2 tip). Baselines (batch-2 tip, green):
> tsc 0 · cargo check --features desktop,ml clean · vitest 2977/2978 (sole fail =
> pre-existing master camelCase ratchet) · eslint clean · i18n strict clean.

## The package story

1. **Darwin Mode** — evolution finally MEASURES its children: fixture/workload replay fitness,
   promotion as a human-approved proposal (the selection pressure).
2. **Director's Lab** — verdicts become typed hypotheses that compile into registered A/B
   experiments under a budget ledger (the scientist).
3. **Self-Tuning Fabric** — routing/budget/healing policy proposed from lived cost/quality/
   reliability evidence, human-consented, provenance-stamped (the economist).
4. **Self-Evolving Team** — assignments end in outcome records, Brier-updated trust, and a
   budget-capped retrospective that writes team lessons (the organism).
5. **Self-Wiring Fabric** — the event bus mines its own traffic and proposes ghost patch-cables
   with an evidence drawer (the electrician who noticed).

## ⚠ THE ZONE MAP (this batch's hard problem — all five orbit Lab/evolution/telemetry)

| Machinery | Owner | Everyone else |
|---|---|---|
| `engine/evolution.rs`, `engine/genome.rs`, `genome_critique.rs`, `core/src/models/{genome,evolution}.rs`, `commands/execution/evolution.rs`, new fitness driver | **Darwin** | call-only |
| `engine/director.rs`, `director_brain.rs`, `db/src/repos/lab/ab.rs`, `sub_director` UI | **Director's Lab** | call-only |
| `db/src/model_routing.rs`, metrics/spend repos (reads), new policy-proposals surface, `settings/sub_engine` UI | **Self-Tuning** | read-only |
| `engine/team_assignment_*.rs`, `commands/teams/**`, `engine crate optimizer/topology`, teams UI | **Self-Evolving Team** | — |
| `engine/src/composite.rs` sibling `pattern_miner.rs`, `engine/src/autopilot.rs` (Capability enum append ONLY), triggers Studio UI + commit path | **Self-Wiring** | — |
| Lab RUN commands (`commands/execution/lab.rs`, matrix/arena drivers) | nobody edits; all call-only | — |

Cross-dependency rule: **no builder depends on another builder's new code this batch.**
Director's Lab materializes variants by CALLING existing genome/critique APIs; if a needed
function doesn't exist, register the experiment in an `awaiting_variant` state and say so in
your reply — do NOT add functions to Darwin's files. Darwin's measured fitness feeding
Director experiments / Self-Tuning shadow-validation is a documented follow-up, not built now.

## Shared contracts (ALL builders)

- Everything from BATCH-1/2 design docs applies: blessed catalog + `AthenaComposedBadge`,
  honest empty/loading states (sparse-data honesty is load-bearing this batch — "not enough
  signal yet" beats a stretched inference, everywhere), one action grammar, Athena
  first-person copy, i18n per surrounding convention, AppError envelope, camelCase on new
  exported ts-rs structs.
- **The learning grammar** (batch-3): every learned change is (a) *evidenced* — the proposal
  carries its raw evidence (runs, co-occurrences, cost triples) inspectable in the UI;
  (b) *proposed, not imposed* — v1 is review-each everywhere; NO auto-apply/auto-commit/
  auto-promotion in this batch; (c) *provenance-stamped* — applied changes record what
  evidence produced them; (d) *reversible* — via persona_change_log / trigger disable /
  routing-rule revert; (e) *budget-capped* — any LLM step has a hard cap and a skip path.
- Feedback-loop hygiene: anything a learner creates is TAGGED and excluded from its own
  evidence (mined triggers, challenger runs, retrospective turns).

## Slices, owners, file zones

Read your source report section FIRST.

### 1. Darwin Mode v1 — `agent-platform.md` #2 (steps 1-3)
**Slice**: (a) measured fitness: after a breeding/evolution cycle, replay the use-case fixture
set through each offspring as lab runs; score assertion pass-rate + cost + latency from the
trace into the EXISTING `fitness_json`/`fitness_overall` fields, replacing the mid-parent
prediction (mark records `fitness_source: measured|inherited`); (b) challenger harness:
`EvolutionPolicy.enabled` personas get a shadow variant evaluated on the last N real inputs,
replayed under hard budget caps, outputs discarded; (c) promotion-as-proposal: "winner beats
incumbent by improvement_threshold" files a review proposal (mirror the memory_review_proposal
pattern), logged to `persona_change_log` on approval. NO auto-promotion. Defer population
board, trait extraction, autopilot tier.
**Owns**: the evolution/genome machinery row of the zone map + a new fitness-driver module.
Lab run commands call-only; budget enforcement read/call-only.

### 2. Director's Lab v1 — `agent-quality-governance.md` #2 (steps 1-2, 4, 6-min)
**Slice**: (a) structured verdicts: extend the `DIRECTOR_VERDICT:` parse with an optional
typed `hypothesis` block `{segment_target, proposed_change, success_metric, metric_source}` —
tolerant parse, absent block = today's behavior; (b) verdict→experiment compiler: an approved
hypothesis materializes a variant via EXISTING genome/critique APIs (call-only; if the API
surface is insufficient, register the `lab_ab_experiments` row as `awaiting_variant` and note
it) with the verdict as provenance; (c) budget ledger: per-week evolution spend allocated
across personas by attention score, enforced against existing RunBudgetState caps — the
Director declines to commission when the ledger is dry; (d) minimal campaign report panel in
the Director tab: hypotheses tested / experiments running / spend, honest empty state.
Production canary fitness + promotion loop deferred (documented as riding Darwin's proposal
path later).
**Owns**: the director row of the zone map. Genome/evolution files are Darwin's — call-only.

### 3. Self-Tuning Fabric v1 — `execution-engine.md` #2 (steps 1-2, 4-5 review-each)
**Slice**: (a) evidence aggregator: read-only repo query joining executions × spend × lab
scores × healing effectiveness into per-(category, model, operation) cost/quality/reliability
triples, with an evidence floor (decline to propose below it — honest sparse-data state);
(b) proposal generator: candidate `ModelRoutingRule` diffs with quantified claims + budget-
ceiling + healing-strategy-weight proposals persisted to a `policy_proposals` table;
(c) "Proposals" feed in `ModelRoutingSection.tsx` — review-each ONLY (no auto-apply tiers in
v1), evidence drawer per proposal; (d) apply = write the rule with full provenance (evidence
snapshot id) so every active rule is auditable; decline logs feedback. Shadow matrix
validation + failover/BYOM extension deferred.
**Owns**: the routing row of the zone map. quality_gate call-only; lab call-only.

### 4. Self-Evolving Team v1 — `team-collaboration.md` #1 (steps 1-4)
**Slice**: (a) post-assignment hook: on terminal status write a structured
`assignment_outcome` record (per-step matched persona, strategy, confidence, duration, result,
review interventions); (b) trust-score feedback: Brier-style updater from outcome vs.
confidence WITH decay + floor (a persona cannot death-spiral off the roster from a few bad
runs — test this); (c) auto-retrospective: completion seeds a `team_deliberation` with the
outcome record + failed/reviewed-step agenda, run to a SMALL fixed budget via the existing
moderator tick, skippable for trivial runs (threshold: steps < 3 and zero failures);
(d) distillation: resolutions write `team_memories` tagged `lesson` with importance; matching
prompt gains a retrieved "team lessons" section. Rewire proposals + autonomy dial deferred.
**Owns**: the teams row of the zone map. (Batch-2's Crew Foundry touched `team_synthesis.rs` +
`sub_factory` — different files; don't drift into them.)
**Retro turns are tagged and excluded from their own outcome evidence.**

### 5. Self-Wiring Fabric v1 — `automation-pipelines.md` #1 (steps 1-3)
**Slice**: (a) `pattern_miner.rs` next to `composite.rs`: background tick scanning
`persona_events` × `executions` for co-occurrence (event E → manual execution of persona P
within window W, ≥N times), writing candidates to a new `automation_suggestions` table;
mined-route tagging so a committed suggestion's own executions are excluded from future
evidence; high initial threshold + honest "not enough signal yet" state; (b) extend
`autopilot::Capability` with `AutomationSuggestion` (+ reserve `AutomationCommit`, NOT
exercised in v1) — this is an append to batch-2's `autopilot.rs`, keep it to the enum +
gating table; (c) ghost patch-cables in the Studio patchbay for candidates, dashed, with an
evidence drawer (the N historical co-occurrences); accept routes through the EXISTING
`studioCommit.ts` path (dry-run first), reject logs to the suggestions table. Near-miss/
dead-letter mining + full auto-commit deferred.
**Owns**: the triggers row of the zone map.

## Coordination rules (identical — hard)

Same tree, strict zones, new-files-preferred. Shared files ONLY as one-line/append edits
(lib.rs invoke_handler/startup, mod.rs, `incremental.rs` migrations — next free id, renumber
on collision; en.json append + regen). NO cargo (orchestrator gates after last edit). NO git.
`npx tsc --noEmit` allowed; `npm run check` is not. Unit tests for the pure logic (fitness
scoring, Brier updater w/ floor, co-occurrence miner, evidence aggregator, hypothesis parse).
Reply <150 words: zone, shipped vs spec, files, exact shared-file edits, migrations, NOT-done
+ why, registrations to verify.

## Acceptance bar

Slice complete; learning grammar holds (evidenced / proposed-not-imposed / provenance /
reversible / budget-capped); zone map respected — especially Darwin↔Director; no
self-feeding evidence loops; sparse-data honesty everywhere; tsc 0; cargo clean at harvest;
vitest ≥ 2977/2978 with no new structural violations; i18n gates clean.
