# Team Autonomy Evaluation Framework

**Status:** design (no harness code yet) · **Created:** 2026-05-26 · **Owner:** this is the existential-bet workstream
**Sub-docs:** [`evaluation-rubric.md`](./evaluation-rubric.md) · [`auto-approval-policy.md`](./auto-approval-policy.md) · [`run-protocol.md`](./run-protocol.md)

---

## 0. The bet

> If we can confidently say a team of personas works without manual intervention for **weeks**, our users will trust it to. That confidence is the product. Everything in this folder exists to **earn or refute** that claim — not to manufacture a green checkmark.

We have 7 teams (the `sdlc-lifecycle` preset, 5 members each) pinned to 7 real repos in `C:\Users\mkdol\xprice`. This framework runs them like real software teams, measures whether their output is **production quality**, and feeds two improvement loops (template + persona-via-lab) until quality stabilizes above the bar across independent runs.

The framework is deliberately **adversarial toward our own app.** A run that "passes" because we auto-approved a team into doing trivial, ungrounded, or no-op work is a *worse* outcome than an honest fail — it's a false positive that would ship a lie to users. Section 3 ("How this could be a sham") is load-bearing.

---

## 1. The falsifiable claim

Everything reduces to one testable statement:

> **Given a team T, a realistic goal G, and the tools/connectors T already has, T autonomously produces production-quality software outputs over a sustained window, without a human resolving gates or correcting course — and quality does not decay as the run deepens.**

Four words in that sentence are where most frameworks cheat. We define each operationally:

- **"production-quality"** → the [evaluation rubric](./evaluation-rubric.md). Mixed reality: code-producing personas are graded by *real repo diff + does-it-build/lint/test*; doc-producing personas by a strict grounded-correctness rubric. Self-reported `business_outcome` is **evidence, not a grade.**
- **"autonomously / without a human"** → the [auto-approval policy](./auto-approval-policy.md) resolves gates by rule, and **every auto-resolution is counted against the autonomy score.** A team that needed 40 auto-approvals to move is not autonomous; it's a puppet.
- **"sustained / does not decay"** → runs measure a *trajectory*, not a snapshot: does output quality at chain-depth 8 / minute 28 match depth 1 / minute 2? Memory growth, context bloat, and goal drift are the decay vectors we watch (Section 4.4).
- **"without correcting course"** → zero human edits to prompts/configs *during* a run. Corrections happen only in the **React** phase (Section 4.5), between runs, and are themselves measured (did the correction improve the next run?).

A run yields a **verdict**: `PRODUCTION` / `PROMISING` / `NOT-READY` / `BROKEN` (rubric §0). The framework's job is done when **3 consecutive independent runs of a team hit `PRODUCTION`** with autonomy-cost below threshold and no quality decay.

---

## 2. Honest current-state assessment (why we are not close yet)

This is the critical baseline. The exploration that grounds this framework surfaced concrete reasons a naïve run would produce a misleading result. **These are pre-conditions the framework must defend against, not bugs to fix first** (though some become React-phase targets).

### 2.1 Personas can be silently degraded
Adoption is "best-effort": `template_adopt.rs` wires the persona atomically but treats parameter population, **event-subscription wiring**, codebase-pin application, and `last_design_result` persistence as optional — each logs a warning and continues on failure. A team can therefore be *adopted and enabled* yet have members that never auto-listen for the events that drive team handoff, or that read the wrong repo. **Implication:** every run MUST be preceded by a **persona-health lint** (rubric §4) that fails the run setup if any member is structurally degraded. Grading the output of a broken team teaches us nothing.

### 2.2 `business_outcome` is self-reported
`persona_executions.business_outcome` (`value_delivered` / `partial` / `precondition_failed` / …) is the model grading its own homework. It is a useful *signal* and a great thing to correlate against, but it is **never** the score. The rubric grades artifacts.

### 2.3 Team handoff is fragile and can stall silently
Work flows A→B via chain-triggers + `persona_event_subscriptions` over the event bus. A run stalls invisibly when: a condition never matches (A failed, B waits on success), B has no subscription row for A's event type, the chain hits `MAX_CHAIN_DEPTH=8`, or a `companion_approval` blocks the next step. **Implication:** the orchestration layer needs a **stall watchdog** (Section 4.6) — a stalled run that the auto-approver "rescues" into busywork is a fail, and a stalled run we don't *detect* is a measurement hole.

### 2.4 The learning loop is half-built
The review→memory loop exists (approved/rejected `persona_manual_reviews` → importance-5 `learned` memories, injected next run). But **healing→memory** and **execution-knowledge→memory** loops do not exist, and `get_recent_resolved` reviews are not injected at runtime. So "improve from executions" today means *only* "improve from human review verdicts." The framework's React phase both *uses* this loop and *tests whether it's sufficient* — if quality won't climb through review-memory alone, that's a finding that justifies building the missing loops.

### 2.5 Goal spread is unconstrained
Athena/teams can emit unbounded `write_goal` approvals; there is no cardinality cap, no conflict detection, no goal↔team coupling. Over a 30-minute run a team can fan its goal into a sprawl it never closes. **Implication:** the orchestration layer caps active goals and the rubric penalizes goal-sprawl-without-closure (rubric §2, "convergence").

> **Net:** the honest baseline is "we don't yet know if a team produces real value, because we can't yet (a) guarantee the team isn't degraded going in, (b) keep it from stalling, or (c) tell real output from self-congratulation." This framework builds exactly those three capabilities and *then* measures.

---

## 3. How this could be a sham (and the guardrail for each)

| Cheat / false-positive | Why it would fool us | Guardrail |
|---|---|---|
| Auto-approve everything → team "completes" trivially | Autonomy looks total; output is noise | Autonomy **cost** is scored; rubric requires *substantive, grounded* artifacts; no-op/echo outputs score 0 |
| Self-report `value_delivered` | Model grades itself | Rubric ignores it as a grade; only artifacts count |
| Run a degraded team | Bad output blamed on personas, not on adoption bug | Pre-run health lint **gates** the run |
| Stall → auto-approver fills 30 min with busywork | Looks busy, produces nothing | Stall watchdog flags; "work density" + "convergence" rubric dims catch it |
| Cherry-pick a goal the team happens to nail | One green run ≠ autonomy | Verdict requires **3 consecutive** independent runs; goals drawn from a fixed, pre-registered seed bank |
| Quality holds for 2 min, decays by min 25 | Snapshot grading hides decay | Trajectory scoring across chain-depth + wall-time |
| React phase over-fits one repo | Template "improves" but only for app X | Template adjustments validated against a *held-out* team/repo before acceptance |
| Human quietly nudges mid-run | Not actually autonomous | Run protocol forbids mid-run edits; harness records a config-hash at start and asserts it unchanged at end |

---

## 4. Architecture

**Shape (locked):** an **external harness** (`scripts/test/`, Node/TS) drives the *live* app through the existing test-automation bridge (`:17320` / `:17321`, `src/test/automation/bridge.ts`) and verifies truth by reading SQLite directly (`personas.db`, `personas_data.db`). This preserves **1:1 user-behavior fidelity** (we exercise the same commands a user's clicks would) and **artifact-truth verification** (we never trust a command's `success:true` — we read the row, the file, the repo diff). Small **in-app additions** are made only where the bridge genuinely can't reach: a policy auto-approve command, a stall-detect query, and the persona-health lint command.

Five layers. Each is independently buildable and testable.

```
┌─────────────────────────────────────────────────────────────────┐
│  EXTERNAL HARNESS  (scripts/test/, Node/TS — drives + verifies)   │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ 4.1 RUN  │→ │4.2 GATHER│→ │4.3 EVAL  │→ │4.5 REACT │→ (loop)  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│        ↑                                          │               │
│        └────────── 4.6 ORCHESTRATE (auto-approve, anti-stall) ────┘│
└─────────────────────────────────────────────────────────────────┘
        │ bridge (:1732x)         │ SQLite read           │ bridge + commands
        ▼                         ▼                        ▼
   live Personas app        personas{,_data}.db      lab / update_persona / adopt
```

### 4.1 RUN — arrange + start + sustain a team
- **Health gate (pre-flight):** run the persona-health lint over every team member; abort + report if any member is degraded (rubric §4). Snapshot a `config_hash` of all members' prompt/design_context/subscriptions.
- **Seed:** pick a goal from the pre-registered **seed bank** (Section 5) appropriate to the repo. Inject it the way a user would (via the team's entry persona's run input, or an Athena `assign_team` — both go through real paths).
- **Sustain:** let the team run for the window. Sustained operation comes from the existing machinery — scheduled triggers + chain cascades + event subscriptions — **not** from the harness manually firing each persona (that would not be the autonomy we're testing). The harness's only mid-run role is the **orchestration layer** (4.6): resolve gates by policy, watch for stalls. The harness records a heartbeat timeline.
- Drivable today: `execute_persona` / bridge `/execute-persona`; team flow via chain-triggers + `persona_event_subscriptions`. (Gap: a clean "start a team on goal G and let it cascade" entry — Section 6 roadmap.)

### 4.2 GATHER — collect everything the run produced
For the run window, collect by **SQLite read** (truth) keyed on the window's time range + team's persona ids:
- **Executions** — `persona_executions` (status, output_data, tool_steps, tokens, cost, duration, business_outcome, model_used, error) + `execution_traces` (span tree, per-tool latency) + log files.
- **Reviews** — `persona_manual_reviews` (+ `review_messages`): what got queued, verdicts, reviewer_notes.
- **Memories** — `persona_memories` created during the window (category, importance, source_execution_id, the `learned` ones from review verdicts) + `team_memories`.
- **Approvals** — `companion_approval` rows created/resolved (who/what/auto-vs-human) — feeds the autonomy cost.
- **Handoffs** — chain trace (`execution_traces.chain_trace_id`), `persona_events`, `pipeline_runs.node_statuses` — the team graph actually traversed.
- **Real artifacts** — for code-track personas: the **git diff** of the pinned repo over the window (the harness `git stash`-safe-snapshots before, diffs after — NEVER touching other working trees per CLAUDE.md parallel-safety). For doc-track: the output_data / produced ADR/spec text.

Output: one immutable `run-<id>/` bundle on disk (raw rows + artifacts + the config_hash + heartbeat timeline). Bundles are the unit of record; everything downstream reads bundles, not the live DB, so a run is reproducible and a scorecard is auditable.

### 4.3 EVALUATE — score the bundle (see [`evaluation-rubric.md`](./evaluation-rubric.md))
Produces a **Run Scorecard**: per-persona and per-team scores across the rubric dimensions, a verdict, and a ranked list of the lowest-scoring dimensions (the React targets). Code-track dims are deterministic (build/lint/test/diff-substance); doc-track and team-level dims use an LLM-judge with a fixed rubric prompt + a human spot-check sample. The scorecard is a committed JSON + a human-readable markdown.

### 4.4 Trajectory & decay analysis (part of EVAL)
Re-score the same run sliced by chain-depth and by wall-clock thirds. Emit a decay curve per dimension. A team that starts strong and degrades is `PROMISING` at best, never `PRODUCTION`.

### 4.5 REACT — the two improvement loops (between runs only)
Targets the lowest-scoring dimensions from 4.3. Two mechanisms, both drivable through the bridge:
1. **Template adjustment** — edit the team's source template(s) under `scripts/templates/`, regenerate checksums, re-adopt into a *fresh* team, re-run. Improves *future* adoptions. **Validation:** an accepted template change must improve the target team AND not regress a **held-out** team adopted from the same preset (anti-overfit, Section 3).
2. **Persona-via-lab adjustment** — for an *already-adopted* persona, use the Lab path (`lab_improve_prompt` → `lab_accept_matrix_draft`, or a direct `update_persona`) to adjust the live persona, then re-run. This both improves the instance AND **tests whether the in-app improvement mechanism actually works** (a first-class goal the user named). Every lab adjustment is a tracked experiment with a before/after scorecard delta.

Each reaction is a logged **experiment**: `{target_dimension, mechanism, change, before_score, after_score, accepted|reverted}`. Reactions that don't move the score are reverted — we don't accumulate cargo-cult prompt cruft.

### 4.6 ORCHESTRATE — policy auto-approval + anti-stall (see [`auto-approval-policy.md`](./auto-approval-policy.md))
Runs *during* a run. Resolves `companion_approval` and `persona_manual_reviews` by policy (whitelist-safe auto-approve, auto-resolve reviews to keep flow, escalate/deny destructive), caps active goals, and watches for stalls (idle heartbeat, dead handoff, approval-age). **Every action it takes is recorded and scored against autonomy.** Its job is to keep the run *moving honestly* — not to manufacture motion.

---

## 5. The seed bank (fixed, pre-registered goals)

To prevent cherry-picking, goals are drawn from a versioned `docs/test/seeds/` bank — realistic SDLC asks appropriate to each repo, tagged by which roles they exercise and whether they're code-track or doc-track. A run cites its seed id. New seeds are added deliberately (and a team must pass on seeds it has *not* been React-tuned against — held-out seeds are the real test). Seed authoring is part of the run-protocol build.

---

## 6. Phased roadmap (each phase shippable + leaves a usable artifact)

1. **P1 — Health lint + Gather (read-only).** Build the persona-health lint (in-app command + harness check) and the SQLite Gather → bundle. Deliverable: point it at the *existing* 7 teams as-is and produce an honest "what state are these teams actually in" report. (This alone will likely surface degraded members per §2.1.)
2. **P2 — Run harness + seed bank.** Clean "start team T on seed G, sustain N minutes" entry; first instrumented run producing a bundle. No scoring yet.
3. **P3 — Orchestration layer.** Policy auto-approval + stall watchdog + goal cap. Now runs can sustain without manual gates. Re-run P2 with it.
4. **P4 — Evaluation.** Rubric implementation (code-track deterministic checks + doc-track LLM-judge + persona-health), Run Scorecard, trajectory analysis. First real verdicts on all 7 teams → the honest baseline scorecard.
5. **P5 — React loops + iteration.** Template + persona-via-lab experiment harness; run the dozens-of-iterations loop; track score deltas; chase 3-consecutive-`PRODUCTION`.
6. **P6 — Certification.** When (if) a team holds, write its certification record: the runs, scores, autonomy cost, decay curves, and the exact template/persona state that achieved it. This is the artifact that backs the "works for weeks" claim to users.

Phases 1–4 build the *measuring instrument*; we do not get to claim anything until P4 produces honest baselines. P5 is where the real (possibly large) implementation effort lands — and where we expect to discover that the missing learning loops (§2.4) and metadata-validation (§2.1) need real product fixes, not just tuning.

---

## 7. Risks, limits, and what would make us stop

- **The instrument is the product risk.** If our scoring is lenient, we certify a lie. The rubric errs strict; ties round down; the human spot-check exists to catch judge drift.
- **30 minutes ≠ weeks.** A bounded run is a *proxy*. We mitigate with decay analysis, but a true "weeks" claim eventually needs a long-haul run (P6+). The framework should be honest that a passing 30-min run is *necessary, not sufficient.*
- **Cost.** Dozens of runs × 5–10 personas × real LLM calls is real money. The harness must record per-run cost and we budget runs deliberately.
- **Determinism.** LLM teams are non-deterministic; a single run is noise. Verdicts require *consecutive* passes precisely because of this.
- **Stop conditions.** We stop tuning a team and call it `NOT-READY` (honestly, to ourselves) if after a bounded experiment budget its scores won't climb or won't hold — and we treat *why* as a product finding (which missing loop / which metadata flaw), not a tuning failure to paper over.

---

## 8. Conventions

- Bundles, scorecards, experiments, and certifications are **committed** under `docs/test/runs/` (or a sibling data dir if they get large — TBD at P2) so results are auditable and a compacted session can pick up the thread.
- The harness **never** `git stash`es or touches working trees other than its own snapshot of a target repo's diff (CLAUDE.md parallel-safety).
- Credentials never leave the machine; runs use the same local-only credential path as a user (memory: `feedback_credentials_stay_local`).
- All app interaction is via the bridge or documented commands — no shortcutting backend internals where a user would click (the one sanctioned shortcut, `execute_persona` run-now, mirrors the in-app Run button).
