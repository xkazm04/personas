# Team Engagement — Soft Motivation & Business Validation

**Status:** DRAFT — spec for review (no code). Two feature ideas turned into reviewable requirements.

Personas today optimize for *isolated perfect execution*: each run sees its own prompt, its capability scope, and (since the May-2026 structured-shared-memory work) a compact digest of the team's settled decisions — but it does **not** know who its teammates are, what the team's goal is, or what product the team is building toward. Separately, the only signals we have on whether a delivered increment is *good* are code-centric (build/lint/test, Director health scores) or self-assessed by the executing LLM (`business_outcome`) — there is no independent product/market/UX judgment anywhere in the loop. This doc specifies two complementary features: **3a — soft team motivation / cooperation context** (low-cost, do first) and **3b — a Product Critic capability for business/UX validation** (higher-effort, advisory-only, do after).

---

## Idea 3a — Persona "soft motivation" / team cooperation

### Problem

A member persona runs in near-total isolation from its team. Concretely, at execution time `src-tauri/src/engine/runner/mod.rs` injects only two team-scoped things:

1. **Workspace shared instructions** — `persona_teams.shared_instructions` from the persona's `home_team_id` (runner `mod.rs` ~184–188).
2. **Structured team memories** — a compact top-15 digest of `team_memories` (decisions/constraints) via `team_memory_repo::get_for_injection(&pool, team_id, 15)` (runner `mod.rs` ~778–796).

The single-persona build prompt (`src-tauri/src/engine/build_session/session_prompt.rs`) is likewise team-agnostic. As a result a persona does **not** know:

- **its teammates** — roster, roles, one-line capabilities (it cannot reference "the reviewer will catch X" or "hand this to the security role");
- **the team goal** — only the orchestrator reads `team_assignments.goal` (`src-tauri/src/db/models/team_assignment.rs`); the executing member never sees it;
- **the product vision / north-star** — *no such field exists anywhere* in the schema today (confirmed: no `vision` / `north_star` column on `persona_teams`, `dev_goals`, or elsewhere);
- **peer workload or in-flight duplication** — there is no "what is the rest of the team doing right now" signal.

Personas therefore re-do work, work around weak dependencies silently, and burn budget when blocked rather than surfacing it — because nothing in their context frames them as *one node in a team pursuing a shared outcome*.

### Proposed design

Inject a **compact TEAM-CONTEXT BLOCK** into each member execution, assembled in the runner alongside the existing team-memory injection (`runner/mod.rs` ~778). One bounded block, four parts:

| Part | Source | Bound |
|---|---|---|
| **Teammate roster** | `persona_team_members` (role) + the linked persona's name + a one-line capability summary | top-N members (see open Q), one line each |
| **Active team goal(s) + progress** | `team_assignments.goal` / `title` / `status` for the team's non-terminal assignments; optionally the soft-linked `dev_goals.progress` (0–100) via `team_assignments.goal_id` | 1–3 active goals, title + status + % |
| **Top-N recent team decisions** | *Reuse the existing* `team_memory_repo::get_for_injection` digest — do not add a second memory query | unchanged (existing top-15 cap) |
| **Product vision / north-star** | NEW field (see below) | one short paragraph, hard char cap |

The teammate one-line capability should be derived from existing persona data (e.g. `description` or the first `DesignUseCase` label) — **do not add a `capability_tags` column**; `team_assignment.rs` already documents the deliberate decision not to add one.

**A short COOPERATION DOCTRINE** (static prompt text, authored once like the Director rubric in `director.rs`), appended to the block. Four rules:

- **Build, don't redo.** If a teammate already produced an artifact this block references, extend or correct it rather than re-deriving from scratch.
- **Flag weak dependencies as a team memory, don't silently work around.** If an upstream output is wrong/missing, write a `team_memories` decision/constraint (existing path) so the team converges — don't patch locally and move on.
- **Don't duplicate in-flight work.** If the roster + goal make clear another role owns this, defer to them rather than producing a parallel version.
- **Surface when blocked rather than burn budget.** If a precondition is missing, stop and emit the blocker (existing `business_outcome = precondition_failed` + a team memory) instead of spending turns guessing.

**The "slight user involvement" surface.** Two user touchpoints, no per-run babysitting:

- **Set/edit the product vision + top goals** — a small editor on the team (vision field) and the existing goals UI (`dev_goals`). This is the *only* recurring human input the doctrine depends on.
- **High-level "needs you" items only** — reuse the existing Attention registry (`src/lib/attention/registry.ts`). The doctrine's "surface when blocked" rule should land as a `pending_reviews` / `memory_actions` attention item, not a new always-on surface. No new attention domain unless review shows a genuine gap.

#### Where the product vision lives — options

| Option | What | Pros | Cons |
|---|---|---|---|
| **A. New `vision` field on `persona_teams`** | Add `vision: Option<String>` to `PersonaTeam` + `UpdateTeamInput` (three-state `double_option`, mirroring `shared_instructions`) | Team-scoped, exactly the injection scope; trivial additive migration; reuses the existing update plumbing | A team spanning multiple projects has one vision; duplicated if you clone teams per project |
| **B. A `dev_goals` row flagged as "vision"** | Reuse `dev_goals` with a `kind`/`is_vision` flag; link via `team_assignments.goal_id` / project | Project-scoped; integrates with goals UI + progress; Athena can already propose goal updates | Indirection — runner must resolve team→project→vision-goal; vision is not a "goal with progress"; semantic mismatch |
| **C. Both — team `vision` field that *defaults from* a project vision-goal** | A on the team, optionally seeded from B | Flexible | Most plumbing; likely over-engineered for v1 |

**Recommendation:** Option A for v1 — it matches the injection scope (team), is the smallest additive change, and reuses the proven `shared_instructions` update path. Revisit B if teams routinely span projects.

### Data model & files touched

- **Schema (additive):** `persona_teams.vision TEXT NULL` (incremental migration in `src-tauri/src/db/migrations/incremental.rs`).
- **Models:** add `vision` to `PersonaTeam`, `UpdateTeamInput` (three-state `double_option`) in `src-tauri/src/db/models/team.rs`; regenerate ts-rs bindings (`src/lib/bindings/`).
- **Runner:** assemble + inject the TEAM-CONTEXT BLOCK in `src-tauri/src/engine/runner/mod.rs` near the existing team-memory injection (~778); reuse `get_for_injection`, add bounded roster + active-assignment queries.
- **Doctrine text:** a new constant (co-located with the team-context assembly), authored declaratively.
- **Frontend:** vision editor on the team settings surface (`src/features/agents/**` team views) — i18n keys under `persona_teams`/`teams` in `src/i18n/locales/en.json`; reuse `forms/FormField`.
- **Docs sync:** `docs/features/personas/README.md` (team behavior is user-visible) and `feature-doc-map.json` if a new source area is introduced.

### Cost & risk

The hard constraint is the **run-10 cost finding** (`docs/tests/autonomy-eval/runs/FINDINGS.md`): before the structured-shared-memory fix, team-memory bloat compounded cost **+115% (≈2.2×) across 3 iterations**; the fix flattened it to **+5.7% (≈flat)**. Any added per-execution context risks reintroducing that slope. Guardrails:

- **Strict top-N + hard char caps** on roster (N members), goals (1–3), and vision (one capped paragraph). The block must be a *fixed-size* digest, not a growing one.
- **Reuse the existing memory query** — no second top-N memory scan.
- **Measure before/after** with the existing longitudinal harness (`scripts/test/longitudinal.mjs`, 3× same seed, memory persists). Acceptance: per-run cost delta from the block stays within noise (≈±5%), no compounding slope across iterations.
- **Risk:** the doctrine could make personas *over*-defer ("the reviewer will catch it") and under-deliver. Mitigate by keeping doctrine rules about *coordination*, not *scope reduction*, and watch `business_outcome` distribution before/after.

### Open questions

- **Roster size before bloat?** How many teammates can we list before the block stops being compact (3? 6? all)? Truncate by what — role priority, recency of collaboration?
- **Vision scope:** team-scoped (Option A) or project-scoped (Option B)? Do any current teams span multiple projects?
- **Opt-in per team?** Should the team-context block / doctrine be a per-team toggle (some teams are single-persona or pipelines where it's noise), or always-on for teams with ≥2 members?
- **Goal visibility:** inject *all* active assignments' goals, or only the one the current execution belongs to?

---

## Idea 3b — Business / product validation ("is the output actually good?")

### Problem

Nothing in the system independently judges whether a delivered increment is **competitive, vital to users, or intuitively usable**. The signals that exist are either code-centric or self-assessed:

- **`persona_executions.business_outcome`** (`value_delivered` / `partial` / `precondition_failed` / `no_input_available` / `unknown`, in `src-tauri/src/db/models/execution.rs`) is **self-reported by the executing LLM** — it answers "did I do my task", not "is this good for the market".
- **The Director** (`src-tauri/src/engine/director.rs`) scores personas 0–5 and emits verdicts across categories `prompt | health | triggers | credentials | memory | usefulness` — this is about **persona health and code-correctness**, explicitly *not* market/competitive/UX validation.
- **The autonomy-eval harness** (`scripts/test/`, rubric in `docs/tests/autonomy-eval/evaluation-rubric.md`) and the **live-app test-automation harness** (:17320, ~23 IPC tools — navigate/click/fill_field/snapshot/eval_js — `docs/development/test-automation.md`) measure **build/lint/test/grounding**. No UX or business evaluation data is captured today.

So a team can ship a perfectly-built feature that nobody needs, that loses to a competitor, or that has a confusing flow — and every signal we collect says "green".

### Proposed design

A **Product Critic** capability that, for a delivered increment, produces a **structured, researched, ADVISORY critique**. Output is a fixed-shape verdict object, not prose:

```
ship | hold | iterate   +   rationale
├─ Competitive research   — who else solves this; where this is ahead/behind  (WebSearch / WebFetch)
├─ User-value argument    — who needs it, how often, what pain it removes
├─ UX heuristic review    — Nielsen's 10 heuristics + conformance to .claude/Design.md tokens
└─ Confidence + caveats   — what the critic could NOT verify (see honesty section)
```

**New persona vs extended reviewer — present both, lean new persona.** Two paths:

- **Extend the Release Manager / reviewer role** — the SDLC team already runs a reviewer + release role (per the autonomy-eval runs). Adding a product-critic pass here keeps the team shape unchanged.
- **A dedicated "Product Critic" persona** (recommended) — distinct system prompt (Nielsen heuristics, competitive-research doctrine, the Design.md token reference), distinct capability/use-case, runs as a late DAG step on an assignment. Cleaner separation: code-review and product-critique are genuinely different judgments, and a separate persona's verdicts don't pollute the reviewer's health scoring.

**Honesty / calibration — this is advisory data, not ground truth.** An LLM critic can *research* (read competitor pages, cite sources) and *argue* (reason about user value and heuristics) but it **cannot validate market fit**. Real validation needs usage telemetry — adoption, retention, task-completion, churn — which a **local-first desktop app mostly does not have** and arguably should not collect (cf. the project's credentials-stay-local stance). The spec must frame every Product Critic output as:

> *Advisory evaluation data — a researched, reasoned argument about likely product quality. It is NOT a measurement of real-world fit. Treat `ship/hold/iterate` as a recommendation to weigh, not a gate to trust.*

Being candid here is a requirement, not a disclaimer: the value is forcing the *questions* (who needs this? how does it compare? is the flow clear?) into the loop, not manufacturing false certainty.

**Live-app UX evaluation data (optional, phase 2).** Extend the :17320 harness to capture UX signals that the critic reasons over — "evaluation data on top of static code analysis":

- **Screenshots** of the changed surface (the harness already has `snapshot`).
- **Steps-to-complete / click-depth** for a target task (instrument the existing navigate/click tools to count interactions).
- **Design.md-token conformance** — scan rendered DOM (`eval_js`) for raw Tailwind classes that have semantic equivalents (the same drift ESLint's `custom/no-raw-*-classes` warns on), reported as a conformance %.

This feeds the critic concrete signals instead of pure speculation — but it is a real harness investment and should be gated on whether 3b proves valuable from research+heuristics alone first.

**How the critique attaches.** Two integration points:

- **Autonomy-eval scorecard** — emit a `product_critique` section in the run scorecard alongside the existing code-centric rubric (`docs/tests/autonomy-eval/evaluation-rubric.md`), clearly labeled advisory.
- **Director verdicts** — *optionally* add a new verdict category (e.g. `product`) so a critique surfaces in the same observability UI as health verdicts. Risk: muddies the Director's "persona health" semantics. Alternative: keep product critiques in their own store/surface and only cross-link. Decide at design time.

### Data model & files touched

- **Persona/template:** a new Product Critic persona template (`add-template` skill) with the critic system prompt; or a new use-case on the reviewer.
- **Critique storage:** a new table (e.g. `product_critiques`: increment ref, verdict, rationale, competitive/value/ux sections as JSON, confidence, sources) or extend the assignment-event audit trail (`team_assignment_events`). Additive migration.
- **Harness (phase 2):** new tools/metrics in the :17320 test-automation server (`docs/development/test-automation.md`) for screenshots/click-depth/token-conformance.
- **Scorecard:** extend the autonomy-eval rubric + scorecard emitter in `scripts/test/`.
- **Connectors:** WebSearch / WebFetch must be available to the critic persona (verify against the connector catalog).
- **Docs sync:** `docs/features/execution/README.md` and/or a new `docs/features/*` entry; `feature-doc-map.json`.

### Cost & risk

- **Cost:** competitive research (multiple WebSearch + WebFetch round-trips) plus a long reasoning pass is **materially more expensive than a normal execution**. Run the critic *once per delivered increment*, not per execution. Budget-cap it explicitly.
- **Risk — false confidence:** the headline risk. A confident `ship` verdict with no telemetry behind it could be trusted as validation. The honesty framing above is the structural mitigation; it must be visible in the UI, not buried.
- **Risk — research quality:** WebSearch results can be stale, wrong, or competitor-marketing. The critique must cite sources so a human can audit.
- **Risk — harness investment:** UX-signal capture is real engineering on the test harness for uncertain payoff. Gate it behind phase 1 proving useful.

### Open questions

- **New persona vs extend Release Manager/reviewer?** (Leaning new persona for clean verdict separation — confirm.)
- **How to source competitor lists?** User-provided per goal/vision? Critic-discovered via search? A field on the team/vision?
- **Is UX-signal capture worth the harness investment now**, or ship critique-from-research-only first and instrument later?
- **Does the verdict ever gate** (block a "ship" in an assignment DAG), or is it strictly advisory and human-read? (Spec leans strictly advisory.)
- **New Director category vs separate surface** for attaching critiques?

---

## Recommended sequencing

1. **Do 3a first.** Low-cost, high-value, mostly additive: one nullable column, reuse of the existing team-memory query, a static doctrine, and a small vision editor. It directly attacks the "personas don't cooperate" problem and the cost guardrail is well-understood (run-10). Ship it, measure cost delta with the longitudinal harness, iterate the doctrine.
2. **Then 3b, phased.** Higher-effort and *advisory-only* by nature.
   - **Phase 1:** Product Critic from research + heuristics (no harness work). Validate that the researched/heuristic critique is actually useful and honestly framed.
   - **Phase 2 (gated on phase 1):** extend the :17320 harness for UX-signal capture and feed it to the critic — only if phase 1 proves the critique earns its cost.

3a makes every round more efficient by *coordination*; 3b adds an *honest second opinion* on whether the coordinated output is worth shipping. Neither should ever be trusted as ground truth where the project's signals are self-assessed (3a doctrine) or telemetry-free (3b verdict) — both are framed as decision support, not gates.
