# Template Marathon Plan — 50-template reliability stress test

## Objective

Stress-test the per-capability glyph + sigil-edit + persistence work shipped
in this session by driving the Glyph-variant template adoption UI end-to-end
for 50 templates, building each persona, executing every capability, and
verifying real-functionality metadata. Fix any bugs surfaced; re-run the
failing subset until 50/50 succeed. Personas + executions retained for
post-hoc inspection.

This plan is the prerequisite write-up the user asked for before any execution
starts. It enumerates:

- The 54 templates that match the user's current vault (50 selected; 4 spare).
- The end-to-end adoption flow in Playwright terms, broken into named phases.
- The success criteria per phase (what counts as pass / soft fail / hard fail).
- The bug-handling loop (fix in worktree, restart app, resume from where we
  failed — no re-running passing templates).
- The deliverable artefacts at run-end (results JSON, screenshots, bug log).

## Why this is risky

Three structural constraints make a "happy night run" unrealistic:

1. **Playwright vs Tauri is serial** per [`parallel-cli-workflow.md`](./parallel-cli-workflow.md):
   one app instance per machine. Worktrees isolate code edits, not app state.
   Any restart costs ~30 s (warm) to ~5 min (cold compile).
2. **Adoption flows differ wildly** between templates: single-cap vs multi-cap,
   `recipe_ref` vs inline `use_cases`, OAuth vs API-key vs vault-list questions,
   2–9 adoption_questions per template, capabilities with `sample_input` vs
   none, event-listener triggers that can't be manually invoked.
3. **Build phase calls Claude CLI** which has its own latency + occasional
   transient failures. 50 builds at ~30–90 s each = 25–75 minutes JUST for
   the LLM-driven build, ignoring all UI driving + verification.

Realistic wall-clock estimate: **8–14 hours** if everything works,
**16–24 hours** with bugfix cycles. The plan accommodates this by:

- Persisting state across runs (resumable — pick up where we left off after
  app crash / Claude budget reset).
- Categorising failures so transient ones auto-retry but structural bugs
  pause the run for human triage.
- Running each template in isolation (one template per Playwright spec
  invocation), driven by an outer Node driver that decides what to do next.

## Vault inventory

User has 21 credentials (from `persona_credentials` 2026-05-19):

```
Local/built-in:    desktop_docker, local_drive, personas_database,
                   personas_messages, personas_vector_db
External:          airtable, alpha_vantage, asana, attio, betterstack,
                   cal_com, clickup, elevenlabs, gmail, github,
                   google_calendar, leonardo_ai, linear, notion, sentry,
                   supabase
```

## Templates that fit (54 total, target: 50)

Matched by: required-connector name OR role OR category, against the
vault's `service_type` set, with built-in connectors auto-counted. Locale
variants (autonomous-issue-resolver.{ar,bn,…}.json) excluded — same shape
as the base.

| Category | Count | Templates |
| --- | --- | --- |
| productivity | 11 | appointment-orchestrator, daily-standup-compiler, digital-clone, email-intelligence-operator, email-morning-digest, idea-harvester, meeting-lifecycle-manager, personal-capture-bot, router, survey-insights-analyzer, vault-grounded-journal-coach |
| development | 7 | codebase-health-scanner, dev-clone, documentation-freshness-guardian, lean-codebase-sentinel, real-time-database-watcher, self-evolving-codebase-memory, skill-librarian |
| research | 7 | ai-research-report-generator, ai-weekly-research, industry-intelligence-aggregator, knowledge-base-health-auditor, product-scout, research-knowledge-curator, research-paper-indexer |
| sales | 7 | contact-enrichment-agent, contact-sync-manager, crm-data-quality-auditor, local-business-lead-prospector, sales-deal-intelligence, sales-pipeline-autopilot, sales-proposal-generator |
| content | 5 | autonomous-art-director, content-approval-workflow, demo-recorder, game-character-animator, scientific-writing-editor |
| devops | 3 | incident-logger, sentry-production-monitor, workflow-error-intelligence |
| marketing | 3 | content-cascade, visual-brand-asset-factory, website-conversion-audit |
| finance | 2 | financial-stocks-signaller, invoice-tracker |
| project-management | 2 | client-portal-orchestrator, technical-decision-tracker |
| security | 2 | access-request-manager, ai-environment-posture-audit |
| support | 2 | email-support-operator, knowledge-base-review-cycle-manager |
| email | 1 | intake-processor |
| hr | 1 | onboarding-tracker |
| legal | 1 | ai-contract-reviewer |

To trim to exactly 50: drop the 4 most-questionable ones (largest
adoption_question count or known-to-be-flaky external services). Final
selection happens at run-start, persisted to `tests/results/marathon-state.json`.

## End-to-end flow per template (the Playwright contract)

Each template gets a uniquely numbered run. Pre-conditions: app running on
`:1420` + test-automation bridge on `:17320`. Glyph adoption variant chosen
(Adoption Wizard's tab switcher set to `persona-layout`). User's vault
unchanged across the run.

### Phase 1 — Open template

1. `navigate("design-reviews")` → `setTemplateTab("recipes")`.
2. Scroll/search to the template by `name`. Click it.
3. Modal opens; locate "Adopt" button → click.
4. AdoptionWizardModal opens; switch tab to `persona-layout` (Glyph variant).

**Pass:** modal visible, Glyph variant tab active, capability list rendered.
**Soft fail:** template card not found → search via `findText(name)` fallback.
**Hard fail:** Adopt button click does nothing for 5 s → abort this template,
log "modal-open-stuck".

### Phase 2 — Capability picker (if multi-cap)

1. If `items.length > 1`, the use-case picker step is active. Toggle each
   capability to ON (we want full coverage). For single-cap templates,
   this phase is a no-op.

**Pass:** all caps toggled on, "Continue" enabled.
**Soft fail:** a cap's enable toggle errors → log + skip that cap.
**Hard fail:** Continue stays disabled even with caps on → abort, log
"picker-stuck".

### Phase 3 — Questionnaire

For each `adoption_question` (filtered by selected caps + filtered by the
new `disabled_dims_json` gate which starts empty):

1. Identify question type (select / boolean / text / dynamic_source).
2. Pick an answer:
   - `vault_category` + `option_service_types`: pick the option whose
     service_type matches a vault credential.
   - `dynamic_source: vault`: pick the first available option from
     `useDynamicQuestionOptions` (auto-detected).
   - `boolean`: pick `default` (template's recommended).
   - `select`: pick the option matching `default`, else the first.
   - `text`: use `default` if present, else a known sentinel (`"marathon-test"`).
3. Send the answer via the AdoptionAnswerCard's submit path. Wait for the
   next pending petal or "all answered" state.
4. Repeat until `unansweredCount === 0` AND `blockedCount === 0`.

**Pass:** every question answered, "Continue to Build" enabled, no blocked
indicators.
**Soft fail:** a question has 0 valid options (vault filter ate everything) →
toggle that dim off via the new footer toggle and continue. If still stuck →
hard fail.
**Hard fail:** > 90 s on a single question (no progress) → abort.

### Phase 4 — Build

1. Click "Continue to Build".
2. Watch the build phase via `waitForBuildPhase(["draft_ready", "test_complete", "failed", "cancelled"])` with 5-min timeout.
3. If `awaiting_input` re-emerges (LLM asks a follow-up question), answer
   it via `answerPendingBuildQuestions`, then re-enter the wait.

**Pass:** phase transitions to `test_complete` or `draft_ready`.
**Soft fail:** runner emits a question we can't answer (no use_case_id match)
→ answer with "skip" or the option containing "default" → continue.
**Hard fail:** phase ends in `failed` / `cancelled` OR 5-min timeout → log
build output, screenshot, abort this template.

### Phase 5 — Promote

1. Click Promote (handle force variant if standard rejects).
2. Wait for phase = `promoted` + persona appears in `getAgentCards()`.

**Pass:** persona in the agent list with a stable id.
**Soft fail:** standard promote fails with a transient error → retry once
with force.
**Hard fail:** persona row never created or test report shows non-zero
critical tools failing.

### Phase 6 — Execute each capability

1. Navigate to the new persona's editor.
2. For each capability in the persona's `design_context.use_cases[]`:
   1. Open the capability detail surface (UseCaseDetailExpanded).
   2. If the cap has `sample_input`, click "Run".
   3. Else, use the cap's `suggested_trigger.type`:
      - `manual` / `cron` / `webhook`: synthesise input from the
        capability's `input_schema` (or empty `{}`) and execute via
        `invokeCommand("execute_persona", { name_or_id: persona_id })`.
      - `event_listener`: SKIP — can't be manually invoked, log "event-listener-skipped".
   4. Wait for a new row in `persona_executions WHERE persona_id = ?
      AND created_at > <pre-execution timestamp>` with status `completed`
      or `failed`. 3-min timeout per execution.

**Pass:** every cap (excluding event-listeners) records a `completed`
execution.
**Soft fail:** cap fails with a known transient class (rate limit, OAuth
refresh) → retry once.
**Hard fail:** cap fails with a structural error (missing tool, unparseable
prompt) → log + continue to next cap, mark this cap "failed-functional".

### Phase 7 — Verify metadata

For each completed execution:

1. Read `persona_executions` row: cost_usd > 0 (real LLM call happened),
   duration_ms > 0, status = completed.
2. Check `persona_executions.tool_steps` JSON → at least one step matches
   a tool listed in the capability's `tool_hints` (or any tool in
   `persona.tools`).
3. Read `persona_messages` for any user-facing output (digest, summary,
   alert) the cap was supposed to produce. Existence check only, no
   content assertion in this iteration.
4. For memory-touching caps: confirm `persona_memories` got at least one
   entry per the cap's `generation_settings.memories === "on"` setting.

**Pass:** all four checks (or N/A for caps that don't claim them).
**Soft fail:** message expected but not found → log "missing-messages".
**Hard fail:** completed execution with 0 tool_steps → log
"empty-execution" — this is the biggest "metadata not in place" signal.

## Result schema

`tests/results/marathon-state.json` — appended after each template:

```json
{
  "started_at": "2026-05-19T20:00:00Z",
  "templates": [
    {
      "id": "email-morning-digest",
      "name": "Email Morning Digest",
      "started_at": "2026-05-19T20:01:00Z",
      "ended_at":   "2026-05-19T20:08:30Z",
      "outcome": "pass",
      "phases": {
        "open": "pass",
        "picker": "n/a",
        "questionnaire": "pass",
        "build": "pass",
        "promote": "pass",
        "execute": "pass",
        "verify": "pass"
      },
      "persona_id": "p-abc123",
      "capability_results": [
        { "cap_id": "uc_morning_digest", "outcome": "pass", "execution_id": "x-...", "tool_steps": 4, "cost_usd": 0.04 }
      ],
      "bugs_observed": []
    }
  ]
}
```

Templates not yet attempted aren't in the array. Resume logic: read JSON,
skip already-passed templates, retry failed ones.

## Bug-handling loop

Hard fails pause the run. The driver writes the bug log + state JSON,
then **stops the marathon**. A human (Claude in a fresh CLI session)
takes over:

1. Read the bug log entry. Reproduce manually if needed.
2. Diagnose: which file holds the bug? (e.g. matcher, runner, UI, template
   data, build prompt).
3. Fix in a worktree (`.claude/worktrees/marathon-fix-<n>/`). Commit per
   the parallel-safety primitives.
4. Restart `tauri:dev:test` (warm restart ~30 s).
5. Run `npm run test:playwright:marathon -- --resume` — the driver picks
   up at the last failed template.

Each fix lands as a separate commit; the run state JSON records which
commits fixed which failures so the post-mortem ties bugs to fixes.

## What gets built tonight (this turn)

I can't run the full marathon in a single CLI turn — it would consume
my conversation context and the user's Claude Code subscription budget
without producing useful output. What I can produce now:

1. **This plan document** (committed).
2. **The Playwright spec scaffold** at
   `tests/playwright/template-marathon.spec.ts` — adopts ONE template
   from a CLI arg, runs phases 1–7 against it, writes a result JSON.
3. **The driver** at `tests/playwright/template-marathon-driver.ts` —
   reads the candidate list, picks the next un-attempted template,
   shells out to the spec, persists state, exits on hard fail.
4. **A README** explaining how to run + resume + interpret results.

The user runs the marathon overnight via:

```bash
# In the main checkout, with tauri:dev:test running
node tests/playwright/template-marathon-driver.mjs --target 50
```

The driver crashes-safe and resumable; the user can leave it running.
Bugs surface as paused state + diagnostic JSON; a fresh CLI session
the next morning starts on the failed entry, fixes the bug, resumes.

## Open architectural questions worth resolving before launch

1. **Event-listener capabilities**: we skip them in Phase 6, but the
   spec hasn't validated they actually work — just that they don't
   block. Long-term, event-listener caps want a synthetic event emission
   helper to drive their handler.
2. **Recipe_ref-only capabilities**: when the template's use_cases array
   carries only recipe_refs (e.g. Email Morning Digest), the per-cap
   detail panel needs the recipe seed resolved at run time. Verify the
   resolver path works during marathon.
3. **Disabled-dims interplay**: the new `disabled_dims_json` field is
   empty for all marathon adoptions (the toggle defaults to "active").
   Worth adding a dedicated sub-test that toggles a dim off for one
   capability mid-questionnaire to verify the filter survives the
   build/promote/execute pipeline.
4. **Personas + executions retention**: the marathon never deletes
   anything. After 50 templates this means ~50 personas + 100+
   executions in the user's DB. Acceptable (the user explicitly asked
   for retention) but worth flagging — the All Personas list will be
   crowded. A post-marathon cleanup script would be useful as a
   follow-up.

## Phase-0 active-runs ledger entry

Per CLAUDE.md, I'll add an entry under `## Active` in
`.claude/active-runs.md` declaring the paths I'll touch. The marathon
itself touches almost everything (it adopts every template and may fix
bugs in any layer), so the path declaration is necessarily broad. I'll
flag it as "marathon — wide blast radius" and ask other concurrent
sessions to coordinate via the ledger if they hit conflicts.
