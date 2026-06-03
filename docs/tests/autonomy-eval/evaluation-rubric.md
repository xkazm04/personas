# Evaluation Rubric — what "production quality" means

**Parent:** [`README.md`](./README.md) · **Consumed by:** EVAL layer (4.3/4.4) and the pre-run health gate (4.1)

This rubric turns the word "production-quality" into numbers that can refute the autonomy claim. **Bias: strict.** Ambiguity rounds *down*. A dimension with no positive evidence scores 0, not "benefit of the doubt." The rubric grades **artifacts and behavior**, never self-report.

---

## §0 Verdict bands

A Run Scorecard rolls per-persona + team + autonomy + decay into one of four verdicts:

| Verdict | Meaning | Gate |
|---|---|---|
| `PRODUCTION` | A user could trust this team unattended on this class of work | Team ≥ 80, **no** dimension < 60, autonomy-cost ≤ budget, **no decay** (trajectory flat/up), health lint clean, **AND (code-track) a Delivered Increment — §1.A.1** |
| `PROMISING` | Real value, but needs a named fix before trust | Team ≥ 60, ≤ 1 dimension < 60, decay mild |
| `NOT-READY` | Does not yet produce trustworthy output | Team 30–59, or any core dimension < 40, or notable decay, or **(code-track) no Delivered Increment** |
| `BROKEN` | Could not honestly be measured | Health lint failed, run stalled unrescued, or output was no-op/echo |

**Certification** (README §6) = **3 consecutive independent `PRODUCTION` runs** on held-out seeds. One green run is noise. **A certification run MUST ship a Delivered Increment (§1.A.1)** — the point of "works for weeks" is a team that produces *merged, shippable* value, not just green analysis. Across the cert window the team may also leave work in the dev/idea pipeline (scoped-but-unmerged branches, backlog candidates, ADRs awaiting build) — that is healthy and does NOT fail certification — but **zero merged quality increments DOES**.

### §1.A.1 Delivered Increment — the shippable-deliverable gate (code-track)
The acceptance question that separates "a team that talks" from "a team that ships": **did the run land at least one valuable increment that BUILDS, PASSES TESTS, and is MERGED TO `master`** (the pinned repo's default branch — not left on a `dev-clone/*` feature branch)?

- **Satisfied** when the repo's `master`/`main` advanced during the run window with a commit whose tree builds + tests-green (§1.A), and the change is a real feature/fix/test increment (not a version-bump-only or docs-only commit). Evidence pointer: the merge/commit SHA on master + the green build/test record.
- **Not satisfied** when all the run's code lives on un-merged `dev-clone/*` branches, or master only moved by a release/version bump with no underlying feature merge, or build/tests fail on master.
- **Partial pipeline is fine:** N tasks may be scoped; only *some* need to merge. One green merged increment satisfies the gate; the rest can remain in-dev (branches) or idea-stage (backlog/ADRs) without penalty.
- **Effect:** for a code-track seed, no Delivered Increment caps the verdict at `NOT-READY` regardless of how good the analysis was — and a certification run that ships nothing to master cannot count toward the 3-consecutive streak. (Doc-track-only seeds — pure ADR/analysis — are exempt; their deliverable is the grounded document.)
- **Why merged-to-master, not just committed:** a branch nobody merged is indistinguishable from abandoned work over weeks. Trust requires the team to carry quality work *through* review/security/release *into* the trunk (behind the human-approval gate when one is configured).

### §1.A.2 Self-veto cap — respect the team's own quality bar

Any execution in a code-track run that completed with `business_outcome=precondition_failed` is the team telling us *in its own words* that the run is **not ready to ship** — typically a release manager refusing to bless a red trunk, or an engineer refusing to implement against a broken precondition. The team's own quality bar **outranks the deterministic dims**. A run with one or more `precondition_failed` outcomes caps at **`PROMISING`**; work may be on local master (Delivered Increment can still fire) but the team didn't bless it, and certification can't override a team that vetoed itself.

- **Distinct from §1.A.1:** the Delivered Increment gate measures whether *something* shipped to master; the self-veto cap measures whether the *team* believes what shipped is ship-worthy. Both can hold simultaneously (work delivered locally + release manager held → PROMISING).
- **Why a cap, not a hard fail:** a self-veto is the team behaving *correctly* under its own rules — that's worth rewarding above NOT-READY. But a green release-bless is what production-readiness means; an honest team-internal hold is `PROMISING`, not `PRODUCTION`.
- **Effect:** a self-vetoed cert run cannot count toward the 3-consecutive PRODUCTION streak — by definition, since it caps at PROMISING.

### §1.A.3 Rescue-aware cascade-stall cap

The cascade-stall cap (`personasExecuted < memberCount || failedExecsNotRescued > 0`) treats a failed execution **with a successful retry** as the team RECOVERED — not as a stall. A failed exec rescued by P3 healing retry (engine: `spawn_delayed_retry`; detected via `retry_of_execution_id` linkage from a `status=completed` successor) is a positive autonomy signal: the team observed the transient, retried, and continued.

- **A failure WITHOUT a successful retry still caps NOT-READY** — that's a true stall.
- **A failure WITH a successful retry is credited** (surfaced in scorecard `facts.rescued_failures: [exec_id, ...]`) and does NOT trigger the cap.
- **Why:** without this credit, the engine's own retry mechanism punishes the team for the very thing it was designed to do (recover from transients). Cert-3 #3 (run-2026-05-28T21-56-02) reached 6/6 cascade with every chain trigger firing including the post-retry one, but raw `failedExecs > 0` would have capped NOT-READY — masking that the team genuinely recovered.

Scores are 0–100 per dimension. **Round ties down.** Every score carries a one-line *evidence pointer* (execution id / file path / diff hunk / review id) — a score with no pointer is invalid and scored 0.

---

## §1 Per-persona output quality (the core)

Each member is graded on the **track** its role implies. The `sdlc-lifecycle` roster maps as:

| Role | Track | Primary artifact | Scored by |
|---|---|---|---|
| Solution Architect | doc | ADR / design decision | rubric §1.B |
| Code Reviewer | doc + behavior | review verdict + `learned` memory + (if it edits) diff | §1.B + §1.A |
| Security Auditor | doc | findings (grounded in real code) | §1.B |
| Release Manager | code + doc | changelog / version bump / tag / release notes | §1.A + §1.B |
| Docs Writer | code + doc | README/docs files in repo | §1.A + §1.B |

A persona may straddle both tracks; score each track it produced and take the **lower** as its output grade (a docs writer who commits broken markdown fails on §1.A even if the prose reads well).

### §1.A Code-track (deterministic — no LLM judge)
The artifact is the **git diff of the pinned repo over the run window**. Scored mechanically:

| Dim | 0 | 60 | 100 |
|---|---|---|---|
| **Exists & non-trivial** | no diff, or whitespace/no-op | a real change touching real files | substantive, scoped change matching the goal |
| **Builds** | repo no longer builds | builds with warnings | builds clean (repo's own build cmd) |
| **Lint/format** | introduces lint errors | neutral | passes repo lint/format |
| **Tests** | breaks existing tests | existing tests still pass | adds/extends passing tests where apt |
| **Coherence** | unrelated churn / reverted-next-step | on-topic | atomic, reviewable, matches the stated intent |

Run the **repo's own** build/lint/test commands (discovered per-repo, recorded in the seed/repo manifest). "Builds clean / tests pass" is binary truth — this is the part of the rubric that *can't* be gamed by eloquence. If a repo has no test suite, the Tests dim is N/A (excluded from the mean, noted).

### §1.B Doc-track (LLM-judge + grounding checks)
The artifact is the produced text (ADR, review, findings, release notes). Mechanical **grounding checks first**, then a judge:

- **Grounding (mechanical, gate):** does the artifact reference *real* entities from the repo/context (file paths that exist, functions that exist, actual code lines)? An ADR that cites `src/auth/middleware.ts:42` is checked against the repo. **Hallucinated references cap the artifact at 40** regardless of prose quality. This is the single most important doc-track guard — a beautifully-written design grounded in nothing is the most dangerous false positive.
- **Judge dims (0–100 each, fixed rubric prompt — §7):**
  - **Correctness** — is the technical content right for *this* codebase?
  - **Actionability** — could a competent engineer execute it without re-deriving everything?
  - **Specificity** — concrete to this repo/goal vs generic boilerplate ("add error handling" = low).
  - **Role fidelity** — does it do the job its role implies (a security audit finds security issues, not style nits)?
- Persona output grade = `min(grounding_gate, mean(judge_dims))`.

---

## §2 Team-level quality

The team is more than its members. These catch the failure modes from README §2–3.

| Dim | What it measures | 0 | 100 |
|---|---|---|---|
| **Goal closure** | Did the seed goal actually get *done*? | goal open / abandoned / fanned-out-never-closed | goal demonstrably satisfied by real artifacts |
| **Convergence** | Goal sprawl vs focus | active goals exploded, no closure (README §2.5) | bounded goal set, each resolved or explicitly dropped |
| **Handoff health** | Did work flow across the graph as designed? | stalled at member 1; B never fired | clean A→B→C traversal matching the team's connections |
| **Work density** | Substantive work / total executions | mostly retries, echoes, no-ops | high ratio of value-producing executions |
| **Memory hygiene** | Did the team *learn* correctly? | no memories, or wrong/contradictory `learned` items | review verdicts produced correct, reusable `learned` memories injected downstream |
| **No-collision** | Members didn't clobber each other | conflicting edits / contradictory decisions | coherent combined output |
| **Portfolio balance** | Is the team's work balanced, or only feature-pushing? | 100% net-new features; zero tests/cleanup/stabilization; tech-debt accumulating | a healthy mix of build + **test coverage + cleanup/refactor + stabilization/bugfix + docs**; the backlog it works from is itself balanced, not a feature pile |

Team score = weighted mean (Goal closure + Convergence + **Portfolio balance** weighted highest — a team that only ships features, never stabilizes or tests, will rot a codebase over weeks and is **not** production no matter how good each feature is).

### §2.1 Portfolio balance — detail (user mandate)

Sustained autonomy is not "ship features forever." A team that only pushes will, over weeks, accumulate untested code, unaddressed tech debt, and instability — the opposite of trustworthy. So we classify every run's artifacts into a **work taxonomy** and score the mix:

`feature` · `test` (new/extended coverage) · `cleanup` (refactor, dead-code, lint/format, dependency hygiene) · `stabilization` (bugfix, error-handling, resilience, perf) · `docs` · `security` · `release/ops`

- **Per-run**: classify each persona's output; flag a run that is ≥80% `feature` with no `test`/`cleanup`/`stabilization` as **unbalanced** (caps Portfolio balance < 50).
- **Across runs (trend)**: a team is balanced only if, over its run history, it *also* picks up cleanup/test/stabilization work — not just whatever new feature the seed implied. This is partly a property of the **backlog** the team works from: a backlog that is all features produces all-feature work. Balancing the backlog (the architect/orchestrator should surface debt + coverage gaps as backlog items, not only features) is a first-class steering target for the **React phase** (template/prompt tuning to make the team self-balance).
- The judge (§7) assigns the work-taxonomy labels and the balance score; the deterministic layer can pre-classify obvious cases (a `*.test.*` diff = `test`, a dependency bump = `cleanup`, a CHANGELOG/tag = `release/ops`).

---

## §3 Trajectory / decay (README §4.4)

Slice the run by **chain-depth** (1–8) and by **wall-clock thirds**. Re-score §1/§2 per slice. Emit a decay curve per dimension.

- **Flat or rising** → no penalty.
- **Mild decay** (late slices 10–20% below early) → caps verdict at `PROMISING`.
- **Sharp decay** (late slices >20% below, or hard failure late) → `NOT-READY`, with the decay vector named: context bloat, memory pollution, goal drift, or handoff degradation.

Decay is the proxy for "weeks" — a team that can't hold quality for 30 minutes will not hold it for weeks.

---

## §4 Persona-health lint (PRE-RUN GATE — not scored, gating)

Run **before** every run. If any member fails a `BLOCKER`, the run aborts as `BROKEN` (we refuse to grade a degraded team). Grounded directly in the metadata flaws (README §2.1):

| Check | Severity | Detect |
|---|---|---|
| `structured_prompt` present **and parses** | BLOCKER | parse it; a corrupt structured_prompt silently falls back to `system_prompt` (prompt assembly) |
| `design_context` parses; `use_cases` non-empty & well-formed | BLOCKER | parse; empty/garbled use_cases ⇒ persona has no capabilities at runtime |
| **Event subscriptions wired** | BLOCKER for non-entry members | `persona_event_subscriptions` rows exist for the events the team's connections require — the §2.1 silent-drop bug; a member with no subscription can never receive handoff |
| Codebase pin resolves | BLOCKER (code-track) | `design_context.dev_project_id` → a real `dev_projects` row whose `root_path` is the intended repo (the §2.1 wrong-repo bug) |
| Connectors/credentials present | WARN | `setup_status='ready'`; pinned connectors have credentials |
| Tools/triggers resolve | WARN | `persona_tools` / `persona_triggers` configs parse |
| No orphan memories dominating | WARN | memories with dead `use_case_id`/`home_team_id` (never injected) |
| Prompt assembles without fallback | WARN | reconstruct the would-be system prompt; flag if it took any silent-fallback branch |

The lint is also a **standalone deliverable** (README P1): pointed at the existing 7 teams it answers "are these teams even structurally sound right now?" — almost certainly surfacing real degradation before any run.

---

## §5 Autonomy cost (the anti-puppet meter)

A team that only "works" because we resolved 40 gates is not autonomous. The orchestration layer (4.6) logs every intervention; this converts them to a cost:

| Event | Cost |
|---|---|
| Auto-approved a **safe/whitelisted** op | low (expected — a CI bot does this) |
| Auto-resolved a human-review to keep flow | low–medium (counts: a team queuing endless reviews is leaning on the human) |
| **Escalated/denied** a destructive op | medium (the team *tried* something it shouldn't have unattended — noteworthy) |
| Stall **rescued** by the watchdog | high (the team got stuck and we unstuck it — anti-autonomy) |
| Goal-cap **enforced** | high (the team was sprawling) |

Autonomy score = `100 − normalized_cost`. A `PRODUCTION` verdict requires autonomy ≥ budget threshold (set at P3 from observed baselines). **Interventions are not free passes — they are the measurement of how far from autonomous the team is.**

---

## §6 Roll-up

```
persona_output = min(track grades produced)          # §1, lower track wins
team_quality   = weighted_mean(§2 dims)              # closure & convergence weighted
trajectory     = decay penalty cap (§3)
autonomy       = 100 − normalized_intervention_cost  # §5
health         = pass/fail gate (§4)

verdict = bands(§0) applied to {team_quality, min(persona_output), autonomy, trajectory, health}
```

The verdict takes the **worst** binding constraint — a team with great ADRs (§1.B=90) that never closes its goal (§2 closure=20) is `NOT-READY`, not "mostly good."

---

## §7 Judge protocol (doc-track §1.B dims + portfolio balance §2.1)

**The judge is the Claude Code agent running the framework** (user mandate: "you will be LLM as judge", unlimited runtime). The judge reads a run's artifacts **in-conversation** — the ADR/review/diff text from the bundle, against the real repo — scores the §1.B dims + the work-taxonomy/balance labels, and records them in `docs/test/runs/<run>/judge.json`. `evaluate.mjs` merges `judge.json` (when present) with the deterministic dims to produce the **final, non-provisional** verdict; without it the verdict is `*-provisional`.

To keep the judge honest:
- **Evidence-required:** every judge score carries a quoted snippet (artifact text / diff hunk) justifying it. A score with no quote is invalid.
- **Grounding pre-check is mechanical** (§1.B), computed by `evaluate.mjs` — the judge never *assumes* a cited path is real; it inherits the mechanical grounding %.
- **Strict, round down:** ambiguity scores low (rubric §0). The judge must actively look for the failure modes in §8 and §3 — eloquence-without-grounding, intentions-without-artifacts, feature-only portfolios.
- **Self-preference caveat:** the judge (agent) did not *produce* these artifacts — the personas (separate Claude CLI executions with their own prompts) did — but it IS the same model family. Mitigations: evidence-required quoting, the mechanical grounding gate the judge can't override, and the deterministic floor. A future human spot-check (1-in-5) remains the drift backstop before any *certification* (3 consecutive PRODUCTION) is trusted.
- **`judge.json` shape:** `{ rubric_version, personas: [{persona_id, role, work_labels:[...], dims:{correctness,actionability,specificity,role_fidelity}, evidence:[...] }], portfolio_balance: {labels_histogram, score, note}, judge_notes }`.

---

## §8 What this rubric refuses to reward

- Eloquent but ungrounded designs (capped at 40).
- "I would do X" intentions with no artifact (0 — intentions aren't output).
- Passing because gates were auto-approved (autonomy cost).
- A strong start that decays (capped at `PROMISING`).
- Self-reported `value_delivered` (ignored as a grade; correlated as a signal only).
- One lucky run (certification needs 3 consecutive on held-out seeds).

---

## §6 Resilience & Escalation (resilience-track seeds only)

"Works unattended for weeks" is not only "ships features" — it is also "recovers from a real blocker without a human babysitting it." §6 grades the resilience machinery shipped in P0–P2. It applies **only** to seeds whose `tracks` array includes `"resilience"`; for every other seed it is a strict no-op (no facts, no caps, no scorecard subtree, no stdout segment — the evaluator stays byte-identical, protected by the golden-diff invariant). Like §1.A.1 Delivered Increment and §1.A.2 Self-veto it is a **cap + reported facts only** — **never folded into `team_score`** or the roll-up divisors.

### The four capability areas

1. **Durable execution queue** — a queued/running execution survives an app restart (P1a `requeue_persisted_executions`) instead of being silently dropped. (Asserted live by the C2 chaos/restart driver, not in the offline §6 facts.)
2. **Load management / concurrency cap** — at most N concurrent executions, none dropped (`engine/queue.rs` `ConcurrencyTracker`, default 4). (Asserted live by the C2 load driver.)
3. **Incident escalation + auto-continuation** — a persona `raise_incident` writes an `audit_incidents` row (`source_table='persona_blocker'`, `source_id` = blocked execution id); on resolution the `IncidentContinuationSubscription` re-runs the blocked work **exactly once** (`continued_at` stamped via the race-safe `claim_continuation`), creating a retry execution (`retry_of_execution_id` = blocked exec) that must reach `completed`.
4. **Review/incident resolution events** — `incident_resolved` and `review_decision.*` events fire and are **delivered** on the bus (P1b/P2.3a).

### Deterministic signals (computed by `lib/eval/resilience.mjs` from the bundle's `incidents.json` + `executions.json` + `events.json`)

| Fact | Asserts |
|---|---|
| `raised` | blocker incidents the team escalated (`source_table='persona_blocker'`) |
| `resolved` | blocker incidents reaching `status='resolved'` |
| `continued` | blocker incidents auto-continued (`continued_at` stamped — fire-once) |
| `continuationExecsCompleted` | retry executions (`retry_of_execution_id` = resolved blocker's `source_id`) that reached `completed` |
| `incidentResolvedEvents` | delivered `incident_resolved` bus events (§6.4) |
| `reviewDecisionEvents` | delivered `review_decision.*` bus events (§6.4) |
| `escalationClosed` | `raised>0` **and** every blocker resolved **and** every blocker auto-continued **and** `continuationExecsCompleted >= resolved` — the core "recovered unattended" assertion |
| `recoveryScore` | 0–100 reported-only mix of resolved/continued/completed ratios; `null` when `raised===0`. **Reported, not scored** — never folded into `team_score`. |

### The two caps

- **§6.1 — escalation must close.** A resilience-track run that **raised** a blocker incident but did **not** auto-resolve + continue + complete it (`raised>0 && !escalationClosed`) caps the verdict at **`NOT-READY`** — the team could not recover from a blocker unattended, which is the whole point.
- **§6.2 — no incident raised is inconclusive.** A resilience-track run that raised **no** incident at all (`raised===0`) caps at **`PROMISING`** — the run did not exercise the path the seed is meant to test, so it is inconclusive, not a pass. (The held-out resilience seed is constructed so the engineer hits a genuine missing precondition and must escalate rather than fabricate a workaround.)

Both caps are gated on `isResilienceTrack` and only ever lower the verdict (worst-binding-constraint, like every other cap in §0/§1.A) — they can never raise it, and they have zero effect on non-resilience runs.

## §7 Standards & branching compliance (code-track seeds with a standards policy)

"Production quality" is not only "the build is green" — it is also "the team followed the
standards the project told it to follow." A Dev Tools project can declare a **standards
policy** (the pipeline's Standards stage → `dev_projects.standards_config`): which pre-commit
gates must pass (lint / docs-required / code-quality), which branch PRs open against
(`pr_base`), and whether GitHub-native auto-merge is enabled. `engine/runner/team_context.rs`
injects that policy into every team-member execution's prompt, so Dev Clone / QA Guardian are
*told* to honor it. §7 is the eval-side counterpart: **did the team's artifacts actually honor
the policy it was given?**

§7 applies **only** to seeds whose `tracks` array includes `"code"` **and** whose bound
project carries a non-null `standards_config`. For every other run it is a strict no-op (no
facts, no cap, no scorecard subtree, no stdout segment — byte-identical, protected by the
golden-diff invariant, exactly like §6). Like §1.A.1 / §1.A.2 / §6 it is **a cap + reported
facts only — never folded into `team_score`** or the roll-up divisors.

### Per-rule signals (computed by `lib/eval/standards.mjs`, reusing already-gathered signals)

The scorer is **pure** — it re-uses signals `evaluate.mjs` already computes (the §1.A code-track
build/lint/test results, whether docs were touched in the increment, and the §1.A.1 delivered-
increment fact) rather than running anything new. A rule is **scored** (`pass`/`fail`) only when
the policy requires it; rules that can't be observed from a local clone are reported **`na`**
(informational, excluded from the percentage).

| Rule | Scored when | Pass means |
|---|---|---|
| `precommit.lint` | `precommit.lint` is on | code-track lint = `pass`. (Note: a code-track lint fail is only a §1.A *warn*; when the policy **requires** lint, that same failure becomes a real §7 violation → caps PROMISING.) |
| `precommit.code_quality` | `precommit.code_quality` is on | code-track build **and** test did not fail (a gate that didn't run is `na`, not a false pass) |
| `precommit.docs_required` | `precommit.docs_required` is on | the increment touched docs (`.md`/`.adr` in the patch) |
| `branching.pr_base` (`main`) | `pr_base = 'main'` | the §1.A.1 increment reached the main base (work wasn't stranded on an un-merged `dev-clone/*` branch) |
| `branching.pr_base` (`test`) | `pr_base = 'test'` | **`na`** — the test base isn't observable from the local main/master clone |
| `branching.automerge` | auto-merge enabled | **`na`** — a GitHub-side setting, not observable from local git |

`pct` = passed ÷ scored (`na` rules excluded); `applicable` = at least one rule was scored.

### The cap

- **§7.1 — standards must be fully honored.** A code-track run whose project declares a policy
  but whose artifacts did **not** fully honor it (`applicable && pct < 100` — any scored rule
  failed) caps the verdict at **`PROMISING`**. Good work that ignores the team's own declared
  standard is not production. (A build/test failure already caps **`NOT-READY`** via §1.A, which
  outranks this — so §7's net-new bite is the *policy-required* lint gate, the docs-required
  gate, and the merge-to-base flow.)

The cap is gated on `standards.applicable` and only ever lowers the verdict (worst-binding-
constraint, like every other cap) — it can never raise it, and it has zero effect on doc-track
runs or projects with no declared policy. The full per-rule breakdown is surfaced in
`scorecard.standards_compliance` and rendered in the in-app Certification dashboard's run
detail (`StandardsCard`).
