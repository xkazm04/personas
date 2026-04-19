# Adoption Process Test Framework

> Live-harness end-to-end tests for the template adoption pipeline. Runs
> against a real desktop app instance with the `test-automation` feature
> enabled (see [guide-test-automation.md](guide-test-automation.md) for the
> harness primitives). Drives the real adoption UI through HTTP, asserts on
> persona metadata and runtime state, and produces a catalog-wide report.
>
> **Historical note (pre-2026-04-19):** an earlier version of this doc
> described a *static* evaluation (read JSON + app code, score). That
> approach is archived inline under [Appendix — Static-eval legacy
> (archived)](#appendix--static-eval-legacy-archived). The static-only
> approach never caught runtime state bugs, adoption-flow crashes, or
> questionnaire-to-design_context propagation gaps — the issues that matter
> most for the C2 capability migration.

## Architecture

```
 Catalog sweep runner         Test harness             Desktop app
 ─────────────────────        ─────────────           ───────────
 tools/test-mcp/              src/test/automation/     Tauri dev server
 e2e_c2_sweep.py    ──HTTP──▶ bridge.ts        ──▶   React + Rust
                    17320      window.__TEST__         with `test-automation`
                                                        feature flag
```

- Sweep runner: Python script iterating templates, posting to the HTTP
  bridge, collecting per-template pass/fail + timing.
- Harness: the `window.__TEST__` bridge exposed by the React app (DOM + Zustand
  + Tauri IPC access).
- App: must be started with `--features test-automation` (see below).

## Running the sweep

### 1. Start the app with the automation feature

```bash
npx tauri dev --features test-automation
```

The app launches as usual. It additionally binds `http://127.0.0.1:17320`
to an axum server defined in `src-tauri/src/test_automation.rs`. The
frontend bridge mounts on `window.__TEST__` when `import.meta.env.DEV` is
true.

Confirm it's up:

```bash
curl http://127.0.0.1:17320/health
# → {"status":"ok","server":"personas-test-automation","version":"0.2.0"}
```

### 2. Run the sweep

```bash
uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py
```

Flags:

- `--port 17320` — test-automation server port (default 17320)
- `--template "<name>"` — test one template by display name
- `--category <slug>` — test one category only (e.g. `--category finance`)
- `--skip-test-agent` — don't click the Test Agent button (faster)
- `--report <path>` — output path for JSON report
  (default `tools/test-mcp/reports/c2-sweep-<ts>.json`)

The sweep:
1. Loads every template from `scripts/templates/**/*.json`
2. Classifies connectors (available / swappable / missing)
3. Skips templates with missing connectors (logged with reason)
4. For each runnable template, executes the per-template checklist below
5. Writes a per-template result + an aggregate summary JSON

## Per-template checklist

For each template the sweep runs, it verifies:

### A. Gallery surface

| Check | Passes when | Fails when |
|---|---|---|
| `gallery_visible` | `template-row-<review_id>` present in DOM | Row missing → template not seeded |
| `gallery_clickable` | Row is interactable | Disabled or covered by overlay |

### B. Adoption modal

| Check | Passes when | Fails when |
|---|---|---|
| `adoption_opens` | `/open-matrix-adoption` returns `success: true` | Backend error or timeout |
| `modal_correct_template` | First modal text contains the template display name | Wrong template opened |
| `cells_populated` | Matrix adoption view shows populated dimension cells | Empty cells → seeding failed |

### C. Questionnaire

| Check | Passes when | Fails when |
|---|---|---|
| `questionnaire_renders` | At least one question visible OR template has zero questions (logged) | UI shows no form at all |
| `scope_grouping_v2` | For v2 templates with `scope` field: questions grouped under persona/capability/connector headings | Flat list in v2 |
| `answers_accepted` | Empty text inputs fillable; selects selectable | Inputs rejected or read-only |
| `submit_all` | Clicking "Submit All" transitions `buildPhase` to `draft_ready` | Phase stays at `questioning` / errors |

### D. Persona metadata (post-adoption)

The sweep reads the created persona from the app state and verifies:

| Check | Passes when | Fails when |
|---|---|---|
| `persona_created` | `persona.id` present in `window.__TEST__.getSnapshot().personas` | Persona missing from list |
| `design_context_has_use_cases` | `persona.design_context.useCases[]` populated with ≥1 entry | Empty or null |
| `use_case_ids_present` | Every use case has an `id` field | Missing → C1 disabled-check won't work |
| `capability_summary_populated` | Every use case has `capability_summary` (v2) | Empty → prompt injection degraded |
| `triggers_attributed` | Every trigger in `persona_triggers` has `use_case_id` matching a capability | Null or mismatched → positional fallback |
| `event_subs_attributed` | Every subscription has `use_case_id` OR is intentionally persona-wide | Ambiguous dispatch |
| `questionnaire_propagated` | Each scope=`capability` answer appears in `useCases[i].sample_input[key]` (or equivalent) | Answer dropped during transform |

### E. Runtime

| Check | Passes when | Fails when |
|---|---|---|
| `test_agent_runs` | "Test Agent" button click → `buildTestOutputLines > 0` | Button missing or no output |
| `prompt_assembly` | Manual invocation of `assemble_prompt` contains `## Active Capabilities` section (uses bridge `/eval`) | Missing — C1 rendering broken |
| `no_console_errors` | No uncaught errors logged during the flow | Any exception → regression |

## Scoring

Each template gets a grade based on check pass-rate:

| Grade | Criterion |
|---|---|
| **A** | All checks pass |
| **B** | All passes except `capability_summary_populated` (content gap, not code bug) |
| **C** | 1-2 failures, all in section D (metadata), all fixable per-template |
| **D** | Failures in sections A/B/C (adoption flow broken) |
| **F** | `adoption_opens` fails or `persona_created` fails |

The aggregate report counts grades per category and surfaces common
failure modes.

## Connector eligibility

Before running the adoption flow, classify every `suggested_connectors`
entry:

| Classification | Logic | Action |
|---|---|---|
| **Virtual** | Name in `{personas_messages, personas_database, personas_memory}` | Available |
| **Builtin** | `scripts/connectors/builtin/<name>.json` exists | Available |
| **Swappable** | Has a role in `connectorRoles.ts` with an available member | Available (swapped) |
| **Missing** | None of the above | Skip with reason |

The classifier is implemented in `tools/test-mcp/e2e_c2_sweep.py::classify_connectors`.

## Output format

### Per-template entry

```json
{
  "template_id": "financial-stocks-signaller",
  "category": "finance",
  "display_name": "Financial Stocks Signaller",
  "status": "evaluated",
  "duration_ms": 8421,

  "connectors": {
    "available": ["slack", "personas_database"],
    "swapped": {},
    "missing": []
  },

  "checks": [
    { "id": "gallery_visible", "passed": true },
    { "id": "adoption_opens", "passed": true },
    { "id": "questionnaire_renders", "passed": true, "detail": "6 questions" },
    { "id": "scope_grouping_v2", "passed": false, "detail": "v2 fields absent — template not migrated" },
    { "id": "submit_all", "passed": true, "detail": "buildPhase=draft_ready after 2.1s" },
    { "id": "persona_created", "passed": true },
    { "id": "design_context_has_use_cases", "passed": true, "detail": "3 use cases" },
    { "id": "use_case_ids_present", "passed": true },
    { "id": "capability_summary_populated", "passed": false, "detail": "0 of 3 have summary" },
    { "id": "triggers_attributed", "passed": true, "detail": "2 of 2 attributed" },
    { "id": "test_agent_runs", "passed": true, "detail": "12 output lines" }
  ],

  "grade": "B",

  "issues": [
    "Template not yet migrated to v2 (no scope fields on questions)",
    "capability_summary empty on all use cases (prompt renders with description fallback)"
  ],

  "fixes_applied": []
}
```

### Aggregate summary

```json
{
  "timestamp": "2026-04-19T...",
  "total_templates": 107,
  "evaluated": 72,
  "skipped": [
    { "id": "salesforce-pipeline", "reason": "missing_connector: salesforce" }
  ],

  "grade_distribution": { "A": 8, "B": 42, "C": 15, "D": 5, "F": 2 },

  "failure_patterns": [
    { "check": "capability_summary_populated", "fail_count": 51, "note": "Expected: templates not hand-migrated yet" },
    { "check": "scope_grouping_v2", "fail_count": 61, "note": "Expected: questionnaire mechanism not rolled out to templates" },
    { "check": "triggers_attributed", "fail_count": 9, "note": "Actual bug: positional fallback triggered, investigate" }
  ],

  "app_fixes_applied": [
    { "file": "src/features/templates/.../QuestionnaireFormGrid.tsx", "description": "Added scope grouping with fallback inference" }
  ],

  "follow_ups": [
    "Hand-redesign 51 templates missing capability_summary (per C2-content-review.md Tier 1-3)",
    "Investigate 9 trigger attribution failures (log which templates)"
  ]
}
```

## Troubleshooting

### Server not starting

```
curl: (7) Failed to connect to 127.0.0.1 port 17320
```

- Confirm app started with `--features test-automation` (not plain
  `npx tauri dev`)
- Check `PERSONAS_TEST_PORT` env var — if set to a different port, use
  `--port` flag on the runner

### Template row not found

```
FAIL 'Financial Stocks Signaller' in gallery
```

- Template gallery seeds asynchronously. The runner retries for 10s; if
  still missing, the template may be unpublished or filed under a different
  display name.
- Search with `--template` by partial name to disambiguate.

### buildPhase stuck at `questioning`

- Check browser console in the dev app for React errors during submit.
- Check that all required questions have defaults; some templates have
  required-without-default questions that the runner's `fill_empty_text_inputs`
  may miss if the type isn't text/textarea.
- `fill_field` explicitly by `data-testid` for typed inputs.

### Test Agent produces no output

- Verify the LLM backend is configured. The runner assumes default model
  profile works.
- Try `--skip-test-agent` to isolate adoption-flow failures from build/test
  failures.

## Extending

### Add a new check

1. Append to the `CHECKS` list in `e2e_c2_sweep.py`
2. Implement `check_<name>(template, state) -> (passed, detail)` in the
   same file
3. Update the scoring rubric above if the check should affect grades

### Add a new data-testid the runner relies on

1. Add `data-testid="..."` to the React component
2. Reference it in the runner via `click_testid` / `fill_field`
3. Document it in [guide-test-automation.md](guide-test-automation.md) §
   data-testid Reference

### Mock a missing connector

Missing connectors are skipped, not mocked. If you need to test a template
whose connector doesn't exist:
1. Create a builtin definition at `scripts/connectors/builtin/<name>.json`
2. The classifier will then mark it available without any other changes
3. Note this is for harness-testing only; real usage still needs a real
   credential

---

## Appendix — Static-eval legacy (archived)

Pre-2026-04-19 this framework was a static-eval playbook: read template
JSON + app code, score without running anything. That approach is retained
here for reference but is **superseded by the live harness** above.

The static rubric still informs the per-template metadata checks (section
D): we score `capability_summary` substance, `structured_prompt` section
length, etc. statically *as part of* the live sweep. But standalone static
eval is no longer maintained.

### Static-only usage (legacy)

```
For each template in scripts/templates/:
  1. Read template JSON + relevant app code
  2. Classify connector requirements → run or skip
  3. Simulate adoption flow (static, no backend)
  4. Score across dimensions
  5. If issues found, fix template JSON or app code
  6. Write per-template report
```

### Static dimensions (still useful as tie-break inside live checks)

| Dimension | Weight | What to assess |
|-----------|--------|----------------|
| Prompt Completeness | 3 | Identity (>50 words), instructions (>200 words, numbered), tool guidance, examples (2+), error handling |
| Tool-Prompt Alignment | 2 | Every tool referenced in prompt has a definition |
| Trigger Coherence | 2 | Trigger configs match prompt workflow |
| Connector Coverage | 2 | Every service in `service_flow` backed by a connector |
| Memory Design | 1 | Prompt describes what to learn/retain |
| Error Handling | 2 | Per-service failure strategy |
| Use Case Fidelity | 2 | Prompt covers all workflows |
| Value Clarity | 2 | Clear business outcome per execution |
| Execution Feasibility | 3 | Tools standard, connectors real |
| Differentiation | 1 | Beyond simple cron/webhook |
| Variable Necessity | 1 | Required variables genuinely needed |
| Default Quality | 2 | Adoption with zero changes produces working persona |

These are now computed by the sweep's `static_prompt_score` check, which
contributes to the overall grade via `B` tier (content gap, not bug).

### Historical question-library concept (deferred)

The earlier doc proposed `src/lib/templates/adoptionQuestionLibrary.ts` — a
per-connector reusable question library. Deferred indefinitely; the v2
scope mechanism (Part 1 of [C2-execution-plan.md](concepts/persona-capabilities/C2-execution-plan.md))
subsumes most of what a library would have provided by making
`scope: "connector"` a first-class notion. Revisit if we still see question
duplication across templates after the v2 rollout.
