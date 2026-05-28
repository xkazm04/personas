# Persona Generation Test Scenarios

End-to-end test plan covering the two persona-generation intake paths plus
the shared build / promote / execute lifecycle. Renamed from
"Template Adoption Test Scenarios" on 2026-05-09 — the previous doc
covered adoption only and assumed legacy commands that were retired in
the Stage A1 cleanup.

## Coverage matrix

| Intake path | Doc section | Existing harness |
| --- | --- | --- |
| Glyph from-scratch (free-form intent) | §4 | `tools/test-mcp/e2e_build_from_scratch.py` |
| Template adoption (pre-authored blueprint + questionnaire) | §5 | `tools/test-mcp/e2e_30_adoption.py`, `e2e_template_adoption.py`, `e2e_adoption_userflow.py` |
| Recipe-injected Glyph (planned, Stage D) | §6 | new harness (TBD) |
| Recipe-as-use-case template adoption (planned, Stage B) | §6 | extend `e2e_30_adoption.py` |

Both intake paths converge on the **shared lifecycle** in §3 — same
build session machinery, same scoring criteria, same artifact
verification. The doc is structured to match: intake-specific in
§§4–6, everything downstream is shared.

---

## 1. Scoring criteria (10 points, flow-agnostic)

Every persona produced by either intake path is scored against these
ten criteria. Auto-pointing applies when the *persona's* dimension
declarations make a particular artifact structurally impossible —
this is unchanged from the previous doc and applies regardless of how
the persona was created.

| # | Criterion | Verification | Auto-Point Rule |
| --- | --- | --- | --- |
| 1 | Persona promoted | `buildPhase == "promoted"` | — |
| 2 | No untested connectors | `buildTestPassed == true` | — |
| 3 | Matrix viewable after promotion | `matrix-tab-container` exists in DOM | — |
| 4 | Execution populated | `persona_executions` row with `status == "completed"` | — |
| 5 | Message populated | `persona_messages` count ≥ 1 | — |
| 6 | Human review generated | `persona_manual_reviews` count ≥ 1 | Auto-point if `manual_review` not declared |
| 7 | Event created | `persona_events` count ≥ 1 | Auto-point if `emit_event` not declared |
| 8 | Memory generated (no negative) | `persona_memories` count ≥ 1 with non-error content | Auto-point if `agent_memory` not declared |
| 9 | Value evaluation | Output is substantive; not generic filler | Heuristic — flag if output < 50 chars |
| 10 | Haiku regression | Re-execute with Haiku, output quality maintained | Heuristic — keyword overlap with primary run |

### Auto-point logic

A persona that doesn't declare `manual_review` (etc.) cannot reasonably
produce that artifact, so the criterion auto-passes. All other criteria
must be earned.

For both intake paths, dimension declarations live in the same place:
the final `persona_ir` row written by `promote_build_draft`. The
auto-point evaluator runs after promotion, so the source of truth is
identical regardless of intake.

---

## 2. Tier classification (connector dependency)

Tier assignment is also flow-agnostic — based on which connector
credentials must be configured for the persona to execute. Tiers help
scope automated runs to the credentials available in CI / dev.

| Tier | Connector requirements | Templates | Glyph scenarios |
| --- | --- | --- | --- |
| **0** Dry Run | Local Database only, infrastructure check | `database-performance-monitor` | Local-only intent (e.g. "summarize my SQLite tables") |
| **1** DB-only | Local Database, In-App Messaging | 5 templates | Local + messaging intents |
| **2** Notion | Notion required | 6 templates | Intents naming Notion explicitly |
| **3** Gmail | Gmail required | 8 templates | Intents naming email/Gmail explicitly |
| **4** Multi-connector | Notion + Gmail + DB combinations | 9 templates | Multi-system intents |
| **5** Skip | Connector unavailable (e.g. Salesforce) | `sales-deal-tracker` | (skip equivalent intents) |

Per-template tier assignments live in §7. Glyph-equivalent intents per tier are described in §4.

---

## 3. Shared lifecycle (post-intake)

Both intake paths produce a `build_sessions` row that the same
downstream code drives through promotion, execution, and artifact
verification. These steps are **identical** for Glyph and adoption —
diverging only in the polling timeouts (Glyph builds spawn CLI and
take longer; adoption builds stamp pre-resolved cells and complete
faster on `draft_ready`).

### Step S1 — wait for `draft_ready`

```
GET /state until buildPhase == "draft_ready"
  Glyph timeout: 240 s (CLI must finish behavior_core → capability_resolution → agent_ir)
  Adoption timeout: 30 s (synchronous DB stamp, near-instant)
```

### Step S2 — verify connector readiness

All connector dots in the matrix UI are green (means `vault_credential_id`
is bound for every required connector type). If a connector is missing,
the test fails at S2 — there's no "test passes anyway" path.

### Step S3 — start agent test

```
POST /click-testid {"test_id": "agent-test-btn"}
```

### Step S4 — wait for `test_complete`

```
GET /state until buildPhase == "test_complete"
  Both flows timeout: 300 s (test execution dominates regardless of intake)
```

→ **Score criterion 2** (`buildTestPassed == true`)

### Step S5 — approve & promote

```
POST /click-testid {"test_id": "agent-approve-btn"}
GET /state until buildPhase == "promoted"
  Timeout: 60 s
```

→ **Score criterion 1** (`buildPhase == "promoted"`)

### Step S6 — verify post-promotion UI

```
POST /navigate {"section": "personas"}
POST /select-agent {"name_or_id": "{persona_name}"}
POST /open-editor-tab {"tab": "matrix"}
assert: matrix-tab-container exists
```

→ **Score criterion 3**

### Step S7 — execute the persona

```
POST /execute-persona {"name_or_id": "{persona_name}"}
poll: persona_executions where status == "completed"
  Timeout: 600 s (varies by template — DB-only is fast; Gmail/Notion fetches are slower)
```

→ **Score criterion 4**

### Step S8 — fetch artifact counts

```
POST /overview-counts {"persona_id": "{id}"}
```

Compare against dimensions declared in `persona_ir`. Apply auto-point
rules for `manual_review`, `emit_event`, `agent_memory` if undeclared.

→ **Score criteria 5–8**

Criterion 9 (value evaluation) is scored from the message content
retrieved during S8.

### Step S9 — Haiku regression

Re-execute with `model: "haiku"`. Compare output length and keyword
overlap with the primary run. Threshold: > 60% keyword overlap and
output length within ±50% of primary.

→ **Score criterion 10**

### Step S10 — cleanup

If `--no-persona-cleanup` is not passed, delete the persona via
`POST /delete-agent` and verify cascade — orphaned records in
`persona_memories`, `persona_messages`, `persona_events`,
`persona_healing_issues` must all be removed (regression for the
known cascade bug fixed in §9).

---

## 4. Glyph from-scratch intake (steps G1–G4)

Entry: user clicks "Build from scratch" on the agents page or invokes
the build flow from the Companion. The orchestration component is
`GlyphFullLayout` (`src/features/agents/components/glyph/GlyphFullLayout.tsx`).

### Step G1 — open composer

```
POST /navigate {"section": "agents"}
POST /click-testid {"test_id": "btn-create-agent"} or POST /start-create-agent
wait for: [data-testid="command-panel-composer"]
```

### Step G2 — fill the five intent rows

```
POST /fill-field {"name": "task", "value": "<intent text>"}
POST /fill-field {"name": "when", "value": "<schedule or trigger>"}
POST /fill-field {"name": "output", "value": "<expected output format>"}
POST /click-testid {"test_id": "tools-picker-add"}  # optional, can pre-select
POST /click-testid {"test_id": "review-policy-{value}"}  # optional
```

### Step G3 — submit

```
POST /click-testid {"test_id": "command-panel-submit"}
```

This triggers `handleLaunch` (`UnifiedMatrixEntry:357`) → creates a
draft persona → calls `start_build_session` (`buildSession.ts:33`) →
backend spawns CLI subprocess.

### Step G4 — answer mid-build clarifying questions

If the LLM emits clarifying questions across the four dimensions
(trigger, source, human-review, destination), the test must answer
them. Existing pattern:

```
poll for: pendingQuestions count > 0
for each question:
  POST /answer-question {"answer": "<deterministic answer>"}
wait for: pendingQuestions count == 0
```

After G4, the flow enters the shared lifecycle at **S1**.

### Glyph scenario library

| Scenario name | Intent prompt | Connectors expected | Tier |
| --- | --- | --- | --- |
| `glyph-translate-drive` | "Translate every document I drop into my local drive from English to Czech and save the translated copy next to it" | Local Drive | 0 |
| `glyph-db-summary` | "Summarize my SQLite tables every morning" | Local DB | 0 |
| `glyph-notion-digest` | "Build me a Notion-page digest summary every Friday" | Notion | 2 |
| `glyph-email-classify` | "Classify incoming emails into urgent/normal/spam and tag them in Gmail" | Gmail | 3 |
| `glyph-multi-incident` | "When my service health page reports an incident, log it to Notion and notify me in Slack" | Notion + Slack + DB | 4 |

Each scenario maps to a tier so CI can scope by available credentials.
The reference harness `e2e_build_from_scratch.py` ships
`glyph-translate-drive` (the team's acceptance-criterion scenario).

---

## 5. Template adoption intake (steps T1–T7)

Entry: user navigates to the template gallery (Templates module →
2nd-level sidebar "Recipes & Templates"). The orchestration is
`AdoptionWizardModal` → `MatrixAdoptionView`.

### Step T1 — navigate to gallery

```
POST /navigate {"section": "design-reviews"}
wait for: [data-testid^="template-row-"]
```

### Step T2 — locate target template

```
POST /find-text {"text": "<template_name>"}
POST /click-testid {"test_id": "template-row-<slug>"}
```

### Step T3 — open details, click adopt

```
POST /click-testid {"test_id": "menu-view-details"}
wait for: [data-testid="button-adopt-template"]
POST /click-testid {"test_id": "button-adopt-template"}
```

This opens `AdoptionWizardModal`.

### Step T4 — use case picker (if shown)

`MatrixAdoptionView:1078` shows the picker if `showUseCasePicker &&
!useCasesPicked`. Templates with ≥1 use case land here.

```
for each use_case in template:
  if scenario specifies adoption (default: all):
    leave checked
  else:
    POST /click-testid {"test_id": "use-case-toggle-<uc_id>"}
optionally configure per-UC triggers
POST /click-testid {"test_id": "use-case-picker-continue"}
```

### Step T5 — questionnaire

`MatrixAdoptionView:1099` shows the questionnaire if
`hasFilteredQuestions && !questionsComplete`. Questions are filtered
by selected UC and by template's `adoption_questions[]`.

```
for each question in filtered set:
  POST /fill-field {"name": "<question_id>", "value": "<deterministic answer>"}
POST /click-testid {"test_id": "questionnaire-submit"}
```

The submit invokes `save_adoption_answers` (still wired post-A1) and
proceeds to seed the draft persona.

### Step T6 — seed draft persona (automatic)

Backend creates persona row + calls `create_adoption_session` with
resolved cells. The flow now waits in `draft_ready` phase.

### Step T7 — auto-test triggers

`useMatrixLifecycle` auto-triggers test on `draft_ready` if no
pending questions remain.

After T7, the flow enters the shared lifecycle at **S2** (skipping S1
since `draft_ready` is already entered).

### Per-template scenarios

The 22-step lifecycle that previous doc documented maps to the new structure as:
- Old steps 1–7 (gallery → adopt button) → **new T1–T3**
- Old steps 8 (use case picker, undocumented) → **new T4**
- Old steps 9 (questionnaire, undocumented) → **new T5–T7**
- Old steps 10–22 → **shared S2–S9**

The slug list and dimension declarations have not changed; the
existing harness `e2e_30_adoption.py` runs all 30 scenarios.

---

## 6. Recipe-injection scenarios (Stage B + Stage D, planned)

These scenarios will be authored as Stage B (template→recipe
migration) and Stage D (Glyph recipe matching) ship.

### 6.1 Glyph + recipe match — accept (Stage D, conservative threshold)

```
G1: open composer
G2: type intent that closely matches a known recipe
G2.5 (NEW): wait for similarity match chip with confidence ≥ 0.90
G2.6 (NEW): POST /click-testid {"test_id": "use-recipe-suggestion"}
G2.7 (NEW): verify composer is pre-filled from recipe
G3: submit (build runs with recipe pre-fill as constraint)
S1–S10: shared lifecycle
```

Verification: the resulting persona has a `source_recipe_id` field in
`adoption_metadata` matching the suggested recipe.

### 6.2 Glyph + recipe match — dismiss (no regression)

```
G2.6 (NEW): POST /click-testid {"test_id": "dismiss-recipe-suggestion"}
G3: submit (build runs from intent only, no recipe context)
S1–S10: shared lifecycle (must succeed identically to no-suggestion run)
```

Verification: `source_recipe_id` is null. Persona output equivalent to
the no-suggestion baseline.

### 6.3 Glyph + no match — silent fallthrough (≥ 0.90 threshold)

```
G2: type intent that does NOT match any recipe within 0.90 confidence
G2.5: assert NO suggestion chip appears
G3: submit (normal flow)
```

Per the user-specified conservative threshold: when no recipe scores
≥ 0.90, the matcher must not surface anything.

### 6.4 Template adoption + recipe-as-use-case (Stage B) — **shipped**

After Stage B migration, templates reference recipes by `recipe_ref`
instead of inline use cases. The hydration pipeline lives in
`engine::template_v3::hydrate_recipe_refs` and runs inside
`create_adoption_session` before the v3-flatten pass.

The load-bearing question for this migration is: **does
`create_adoption_session` produce a coherent `agent_ir` from a
recipe_ref-shaped template payload?** If yes, the rest of the
adoption lifecycle (S2–S10 above) is unaffected by the migration.
The wizard's questionnaire is just answer-collection — orthogonal
to whether recipes hydrate.

**Two-layer harness:** [`tools/test-mcp/e2e_recipe_pipeline.py`](../../tools/test-mcp/e2e_recipe_pipeline.py)

- **Layer A — schema-level catalog audit.** For every bundled
  template (~112 today), walks `payload.use_cases[i].recipe_ref.id`
  and verifies each resolves to a recipe in the live catalog (seeded
  by Stage B Phase 2.4 on app boot). Also verifies each recipe's
  `prompt_template` round-trips as JSON — the contract
  `hydrate_recipe_refs` relies on. ~3 seconds total.
- **Layer B — direct-IPC adoption.** Calls
  `get_design_review` → `create_persona` → `create_adoption_session`
  for each scenario in `LAYER_B_TEMPLATES_DEFAULT` (21 templates by
  default, spanning every category folder). Verifies the resulting
  `build_sessions.agent_ir` has hydrated `use_cases[]` with non-empty
  `id` + `title`/`name`, and that v3-flatten hoisted at least one
  `suggested_triggers[]` / `suggested_connectors[]` entry. Skips the
  wizard UI on purpose — the wizard's `createPersona` +
  `create_adoption_session` invocations gate on `useCaseStepDone +
  questionsComplete` (`MatrixAdoptionView:792-794`), so UI-driven
  Layer B can't reach `create_adoption_session` without per-template
  questionnaire knowledge. The IPC path exercises the same Rust
  hydration code with no UI overhead. ~1.2 seconds per scenario.

**Why two layers:** Layer A is wide (every template) and proves the
catalog is internally consistent. Layer B is narrower (sample of 21)
but proves the runtime pipeline actually executes the hydration —
schema validity alone doesn't guarantee `hydrate_recipe_refs +
normalize_v3_to_flat` work in production. Together they answer "is
the migration sound at rest AND in motion?"

**Reference run** (2026-05-09, full 112-template Layer A + 21-template
Layer B): `docs/tests/results/recipe-pipeline-20260509-221004.json`

```
Layer A: templates=112  recipes=291  refs_checked=291  missing=0  malformed=0
Layer B: 21/21 passed (avg 1.22s per scenario, 26s total)
         each scenario: 1–3 hydrated use_cases, 1–3 hoisted triggers,
                        ≥1 hoisted connector
```

Verification per scenario stops short of execute/promote/Haiku
regression — those still belong to `e2e_30_adoption.py`'s full
lifecycle suite. The recipe-pipeline harness only proves the
hydration boundary holds; the existing harness proves the
lifecycle still works end-to-end.

Per-template `source_recipe_id` annotation on `persona_use_cases`
rows lands in a follow-up phase (provenance metadata, see Stage B
docs §3); current verification stops at the build_session boundary.

### 6.5 Negative — recipe versioning drift detection (Stage B+)

```
T1–T7 with template_v1 → persona created with
  use_cases[*].source_recipe_version == "1.0.0"
[recipe catalog updated externally to version 1.1.0]
re-open the persona detail view
assert: "newer version available" badge appears on UC card
```

This scenario is authored only when versioning UI ships (per Stage B
Phase 2 in the parent plan).

---

## 7. Per-template details (preserved)

| Tier | Templates |
| --- | --- |
| 0 | `database-performance-monitor` |
| 1 | `budget-spending-monitor`, `incident-logger`, `service-health-reporter`, `content-performance-reporter`, `research-paper-indexer` |
| 2 | `notion-docs-auditor`, `content-schedule-manager`, `daily-standup-compiler`, `research-knowledge-curator`, `technical-decision-tracker`, `weekly-review-reporter` |
| 3 | `email-morning-digest`, `email-support-assistant`, `email-follow-up-tracker`, `email-lead-extractor`, `email-task-extractor`, `survey-insights-analyzer`, `expense-receipt-tracker`, `invoice-tracker` |
| 4 | `idea-harvester`, `newsletter-curator`, `access-request-manager`, `contact-enrichment-agent`, `contact-sync-manager`, `support-email-router`, `onboarding-tracker`, `sales-deal-analyzer`, `sales-proposal-generator` |
| 5 (skip) | `sales-deal-tracker` (Salesforce unavailable) |

**Auto-point templates** (missing `manual_review` dimension; criterion
6 always passes for these):

`budget-spending-monitor`, `incident-logger`, `service-health-reporter`,
`daily-standup-compiler`, `research-knowledge-curator`,
`weekly-review-reporter`, `email-morning-digest`,
`email-follow-up-tracker`, `email-task-extractor`, `sales-deal-tracker`.

If template authoring changes (a new template added, or a dimension
removed), update this index in place.

---

## 8. Results format

### Per-scenario result

```json
{
  "scenario_id": "glyph-translate-drive",
  "intake_path": "glyph",
  "tier": 0,
  "persona_id": "uuid-here",
  "timestamp": "2026-05-09T14:30:00Z",
  "skipped": false,
  "skip_reason": null,
  "duration_ms": 45230,
  "intake_steps": {
    "G1_open_composer": "ok",
    "G2_fill_intent": "ok",
    "G3_submit": "ok",
    "G4_answered_questions": 3
  },
  "shared_steps": {
    "S1_draft_ready": "ok in 89s",
    "S4_test_complete": "ok in 134s",
    "S5_promoted": "ok"
  },
  "scores": {
    "1_promoted":            { "passed": true, "auto_point": false, "detail": "..." },
    "2_connectors_tested":   { "passed": true, "auto_point": false, "detail": "..." },
    "3_matrix_viewable":     { "passed": true, "auto_point": false, "detail": "..." },
    "4_execution_completed": { "passed": true, "auto_point": false, "detail": "..." },
    "5_message_populated":   { "passed": true, "auto_point": false, "detail": "..." },
    "6_human_review":        { "passed": true, "auto_point": true,  "detail": "..." },
    "7_event_created":       { "passed": true, "auto_point": false, "detail": "..." },
    "8_memory_generated":    { "passed": true, "auto_point": false, "detail": "..." },
    "9_value_evaluation":    { "passed": true, "auto_point": false, "detail": "..." },
    "10_haiku_regression":   { "passed": true, "auto_point": false, "detail": "..." }
  },
  "total_score": 10,
  "max_score": 10,
  "errors": []
}
```

### Aggregate run summary

```json
{
  "run_id": "run-20260509-143000",
  "started_at": "2026-05-09T14:30:00Z",
  "finished_at": "2026-05-09T15:42:00Z",
  "environment": {
    "app_version": "0.5.0",
    "primary_model": "claude-sonnet-4-6",
    "haiku_model": "claude-haiku-4-5-20251001",
    "credentials_available": ["gmail", "notion", "local_drive"]
  },
  "intake_summary": {
    "glyph":    { "scenarios": 5,  "run": 5,  "avg_score": 9.6,  "skipped": 0 },
    "adoption": { "scenarios": 30, "run": 29, "avg_score": 9.65, "skipped": 1 }
  },
  "tier_summary": {
    "tier_0": { "total": 1, "run": 1, "skipped": 0, "avg_score": 10.0 },
    "tier_1": { "total": 5, "run": 5, "skipped": 0, "avg_score": 9.6  },
    "tier_2": { "total": 6, "run": 6, "skipped": 0, "avg_score": 9.8  },
    "tier_3": { "total": 8, "run": 8, "skipped": 0, "avg_score": 9.5  },
    "tier_4": { "total": 9, "run": 9, "skipped": 0, "avg_score": 9.7  },
    "tier_5": { "total": 1, "run": 0, "skipped": 1, "avg_score": null }
  },
  "overall": {
    "total_scenarios": 35,
    "scenarios_run": 34,
    "scenarios_skipped": 1,
    "average_score": 9.65,
    "perfect_scores": 27,
    "failures": []
  }
}
```

Output files write to `docs/tests/results/persona-generation-{run_id}.json`.

---

## 9. Lessons learned (load-bearing, do not re-litigate)

These bugs were found and fixed during the 2026-03-23/24 adoption test
run. Most fixes are still in production. New regressions should be
appended to this section, not re-discovered.

### Critical bugs fixed in production

- **Promote-path agent_ir vs template-payload key mismatch.** `useMatrixLifecycle.handlePromote` checked for `system_prompt`/`tools`/`triggers` but template payloads use `structured_prompt`/`suggested_tools`/`suggested_triggers`. Fixed by also checking for `sessionId` — when a build session exists, always use the Rust promote path. (`src/features/agents/components/matrix/useMatrixLifecycle.ts`)
- **`promote_build_draft_inner` template-payload mismatches.** Read `use_cases` but templates have `use_case_flows`; filtered events by `direction == "subscribe"` but template events have no `direction`; constructed `design_result` from `required_connectors` but templates use `suggested_connectors`. Fixed with fallback keys for all template formats. (`src-tauri/src/commands/design/build_sessions.rs`)
- **String tool names dropped silently.** Template payloads use string tool names (`["notion", "gmail"]`) but `tool_def_from_ir` only handled JSON objects. Fixed to handle both. (`src-tauri/src/engine/tool_runner.rs`)
- **Event source_type validation rejected persona names with spaces.** `format!("persona:{}", persona_name)` failed validator (only alphanumeric/underscore/hyphen/dot/colon/slash allowed) for personas like "Budget Spending Monitor". Fixed by sanitizing persona name. (`src-tauri/src/engine/dispatch.rs`)
- **Multi-delta protocol messages lost.** `emit_event`/`agent_memory` messages spanning multiple streaming deltas were missed by the mid-stream parser. Fixed with post-mortem scan after CLI exit, with dedup. (`src-tauri/src/engine/runner.rs`)

### Quality gates added

- **Manual reviews must be business decisions, not operational errors.** Quality gate in `dispatch.rs` rejects reviews containing patterns: "no pages shared", "no page access", "audit blocked", "has no", "not shared with".
- **Memories must be genuine learnings, not credential failures.** Filter rejects content about credential failures, authentication issues, empty workspace problems.
- **EXECUTION_MODE_DIRECTIVE established.** Constant added at prompt start: autonomous one-shot execution, business-decisions-only for manual_review.
- **Review-to-Memory link.** When manual review is resolved (approved/rejected), a memory is auto-created recording the decision so the persona learns.

### Test infrastructure pitfalls

- **Persona ID cross-contamination.** Tests reading `selectedPersonaId` from Zustand state could pick up a stale ID across runs. Fix: poll for `buildPersonaId` specifically, with DB fallback by template name.
- **Stale artifact counts.** Counting all artifacts for a `persona_id` included previous runs. Fix: record `_exec_started_at` timestamp and scope artifact queries to `created_at >= timestamp`.
- **Cascade gaps on persona delete.** Orphaned records in `persona_memories`, `persona_messages`, `persona_events`, `persona_healing_issues`. Fix: explicit cleanup in `personas.rs` for tables lacking `ON DELETE CASCADE`.

### Operational notes for long runs

- **API rate limits.** Each template requires 2 executions (Sonnet + Haiku). Running all 30 back-to-back can exhaust the Anthropic quota.
- **Two templates have mismatched gallery slugs:** `email-morning-digest` and `email-support-assistant` may use `seed-email-*` data-testids.
- **Execution timeout for heavy templates.** `database-performance-monitor` querying all SQLite tables can exceed the default 10-minute poll.
- **Quality audit beyond counts.** After each template, audit actual content in DB — not just artifact counts.

### Lessons added 2026-05-09 (Stage A1 cleanup)

- **L1 — Legacy adoption-jobs commands deleted.** Tests must not invoke `start_template_adopt_background`, `confirm_template_adopt_draft`, or other retired commands. The modal flow at `MatrixAdoptionView` is the only supported path.
- **L2 — `instantAdoptTemplate` is dev-only.** It bypasses the questionnaire and matrix entirely; only `useDevCloneAdoption` uses it. Production scenarios must run T1–T7, not Instant Adopt.

---

## 10. Cross-references

- **Adoption flow design doc:** [`docs/features/templates/03-adoption-flow.md`](../features/templates/03-adoption-flow.md)
- **Adoption answer pipeline:** [`docs/features/templates/07-adoption-answer-pipeline.md`](../features/templates/07-adoption-answer-pipeline.md)
- **Template integrity & security:** [`docs/features/templates/06-integrity-and-security.md`](../features/templates/06-integrity-and-security.md)
- **Recipe-from-template migration design:** [`docs/concepts/recipe-from-template-migration.md`](../concepts/recipe-from-template-migration.md)
- **Test automation guide:** [`docs/test-automation-guide.md`](../test-automation-guide.md)
- **APP context map:** [`tools/test-mcp/APP_CONTEXT_MAP.md`](../../tools/test-mcp/APP_CONTEXT_MAP.md)
- **Glyph harness:** [`tools/test-mcp/e2e_build_from_scratch.py`](../../tools/test-mcp/e2e_build_from_scratch.py)
- **Adoption harness:** [`tools/test-mcp/e2e_30_adoption.py`](../../tools/test-mcp/e2e_30_adoption.py)

---

## 11. How to run

### Prerequisites

```
npm run tauri:dev:test
# Confirm:
curl http://127.0.0.1:17320/health
```

Required for tier-3+ scenarios: configure Gmail / Notion / Slack
credentials in the vault before the run.

### Single scenario (Glyph)

```
uvx --with httpx python tools/test-mcp/e2e_build_from_scratch.py \
  --intent "Translate every document I drop into my local drive from English to Czech" \
  --report docs/tests/results/glyph-translate-drive-{run_id}.json
```

### Single scenario (template adoption)

```
uvx --with httpx python tools/test-mcp/e2e_template_adoption.py \
  --template incident-logger \
  --report docs/tests/results/adoption-incident-logger-{run_id}.json
```

### Full 30-template adoption suite

```
uvx --with httpx python tools/test-mcp/e2e_30_adoption.py \
  --report docs/tests/results/template-adoption-{run_id}.json
```

### Recipe-pipeline E2E (Stage B+D+E migration verification)

Validates that post-Phase-2.2 templates still adopt cleanly via the
new recipe_ref → inline UC hydration path. Two layers; ~30 seconds
end-to-end against a stock dev install.

```
# Run both layers (default):
uvx --with httpx python tools/test-mcp/e2e_recipe_pipeline.py

# Layer A only (schema audit, ~3 s, every template):
uvx --with httpx python tools/test-mcp/e2e_recipe_pipeline.py --layer a

# Layer B against a single template (1–2 s):
uvx --with httpx python tools/test-mcp/e2e_recipe_pipeline.py \
  --layer b --template incident-logger
```

---

## Open work

1. **Extend `e2e_build_from_scratch.py`** to a multi-scenario harness covering the five Glyph scenarios in §4.
2. **Author Stage D recipe-injection scenarios (§6.1–6.3)** when the matcher ships.
3. **Author Stage B recipe-as-use-case scenarios (§6.4–6.5)** when the migration script lands. Extend `e2e_30_adoption.py` to assert `source_recipe_id` provenance per use case.
