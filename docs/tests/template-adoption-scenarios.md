# Template Adoption Test Scenarios

Comprehensive test plan for validating all 30 persona templates through the
PersonaMatrix adoption lifecycle. Each template is adopted, built, tested,
promoted, executed, and scored against 10 criteria.

---

## 1. Scoring Criteria (10 points)

Every template run is scored out of 10. Some criteria can be **auto-pointed**
when the template's dimension definitions make a particular artifact
structurally impossible.

| # | Criterion | Verification | Auto-Point Rule |
|---|-----------|-------------|-----------------|
| 1 | Persona promoted via PersonaMatrix | `buildPhase == "promoted"` | -- |
| 2 | No untested connectors | `buildTestPassed == true` | -- |
| 3 | Matrix viewable after promotion | `matrix-tab-container` exists in DOM | -- |
| 4 | Execution populated | `persona_executions` has a row with `status = "completed"` | -- |
| 5 | Message populated with user output | `persona_messages` count >= 1 | -- |
| 6 | Human review generated | `persona_manual_reviews` count >= 1 | Auto-point if `manual_review` is **not** in the template's dimensions |
| 7 | Event created | `persona_events` count >= 1 | Auto-point if `emit_event` is **not** in the template's dimensions |
| 8 | Memory generated (no negative) | `persona_memories` count >= 1 **and** content is not error-related | Auto-point if `agent_memory` is **not** in the template's dimensions |
| 9 | Value evaluation | Message content is meaningful; output has substance | Heuristic check -- flag if output < 50 chars or is generic filler |
| 10 | Haiku model maintains value | Re-execute with Haiku; output quality maintained | Heuristic check -- compare output length and keyword overlap with primary run |

### Auto-Point Logic

When a template does **not** declare a dimension (e.g., `manual_review`), the
corresponding criterion receives an automatic point because the artifact was
never expected.  All other criteria must be earned by the test run.

---

## 2. Template Tiers (by connector dependency)

Templates are grouped into tiers so that test runs can be scoped to the
credentials available in the environment.

### Tier 0 -- Dry Run (infrastructure validation)

| Template | Connectors |
|----------|-----------|
| database-performance-monitor | Local Database only |

Use this tier to validate the test harness itself before running real
templates. No external credentials required.

### Tier 1 -- Database-Only (always available)

| Template | Connectors |
|----------|-----------|
| budget-spending-monitor | Local Database |
| incident-logger | Local Database, In-App Messaging |
| service-health-reporter | Local Database, In-App Messaging |
| content-performance-reporter | Local Database, In-App Messaging |
| research-paper-indexer | Local Database |

### Tier 2 -- Notion-Only (requires Notion credential)

| Template | Connectors |
|----------|-----------|
| notion-docs-auditor | Notion |
| content-schedule-manager | Notion |
| daily-standup-compiler | Notion |
| research-knowledge-curator | Notion |
| technical-decision-tracker | Notion |
| weekly-review-reporter | Notion |

### Tier 3 -- Gmail-Based (requires Gmail credential)

| Template | Connectors | Notes |
|----------|-----------|-------|
| email-morning-digest | Gmail | Listed as "Email" connector |
| email-support-assistant | Gmail, Local Database | Listed as "Email" connector |
| email-follow-up-tracker | Gmail, Slack | -- |
| email-lead-extractor | Gmail, Local Database | -- |
| email-task-extractor | Gmail, Notion | -- |
| survey-insights-analyzer | Gmail | -- |
| expense-receipt-tracker | Gmail, Local Database | -- |
| invoice-tracker | Gmail, Local Database | -- |

### Tier 4 -- Multi-Connector

| Template | Connectors |
|----------|-----------|
| idea-harvester | Gmail, Notion |
| newsletter-curator | Notion, Gmail |
| access-request-manager | Gmail, Local Database, In-App Messaging |
| contact-enrichment-agent | Gmail, Local Database |
| contact-sync-manager | Gmail, Local Database |
| support-email-router | Gmail, Notion |
| onboarding-tracker | Notion, Local Database, In-App Messaging |
| sales-deal-analyzer | Local Database, Notion |
| sales-proposal-generator | Local Database, Notion |

### Tier 5 -- Skip (unavailable connectors)

| Template | Connectors | Reason |
|----------|-----------|--------|
| sales-deal-tracker | Salesforce | Proprietary CRM -- no test credential available |

Templates in Tier 5 are excluded from automated runs. They can be scored
manually if the connector becomes available.

---

## 3. 22-Step Test Lifecycle

Every template follows the same 22-step lifecycle. Parameters in braces
(`{template_name}`, `{slug}`, `{persona_name}`, `{id}`) are substituted
per-template.

### Steps 1-7: Navigate and Adopt

| Step | Action | Endpoint / Payload |
|------|--------|-------------------|
| 1 | Navigate to template gallery | `POST /navigate {"section":"design-reviews"}` |
| 2 | Wait for template rows to render | `POST /wait {"selector":"[data-testid^='template-row-']","timeout_ms":10000}` |
| 3 | Locate the target template by name | `POST /find-text {"text":"{template_name}"}` |
| 4 | Click the template row | `POST /click-testid {"test_id":"template-row-{slug}"}` |
| 5 | Open context menu -- view details | `POST /click-testid {"test_id":"menu-view-details"}` |
| 6 | Wait for adopt button | `POST /wait {"selector":"[data-testid='button-adopt-template']","timeout_ms":10000}` |
| 7 | Click adopt | `POST /click-testid {"test_id":"button-adopt-template"}` |

### Steps 8-14: PersonaMatrix Build and Test

| Step | Action | Details |
|------|--------|---------|
| 8 | Poll for draft ready | `GET /state` until `buildPhase == "draft_ready"` (timeout 60 s) |
| 9 | Verify connector readiness | All connector dots green in the matrix UI |
| 10 | Start agent test | `POST /click-testid {"test_id":"agent-test-btn"}` |
| 11 | Poll for test completion | `GET /state` until `buildPhase == "test_complete"` (timeout 180 s) |
| 12 | Verify test passed | `buildTestPassed == true` --> **Score criterion 2** |
| 13 | Approve / promote | `POST /click-testid {"test_id":"agent-approve-btn"}` |
| 14 | Poll for promotion | `GET /state` until `buildPhase == "promoted"` --> **Score criterion 1** |

### Steps 15-17: Post-Promotion Verification

| Step | Action | Details |
|------|--------|---------|
| 15 | Navigate to persona list | `POST /navigate {"section":"personas"}` |
| 16 | Select the adopted persona | `POST /select-agent {"name_or_id":"{persona_name}"}` |
| 17 | Open matrix tab and verify | `POST /open-editor-tab {"tab":"matrix"}`, assert `matrix-tab-container` exists in DOM --> **Score criterion 3** |

### Steps 18-19: Execution

| Step | Action | Details |
|------|--------|---------|
| 18 | Execute the persona | `POST /execute-persona {"name_or_id":"{persona_name}"}` |
| 19 | Poll database for completion | Query `persona_executions` until `status = "completed"` (timeout 300 s) --> **Score criterion 4** |

### Steps 20-21: Artifact Verification

| Step | Action | Details |
|------|--------|---------|
| 20 | Fetch overview counts | `POST /overview-counts {"persona_id":"{id}"}` |
| 21 | Score artifact criteria | Evaluate counts against dimension definitions --> **Score criteria 5-8** |

Criterion 9 (value evaluation) is scored from the message content retrieved
during step 20/21.

### Step 22: Haiku Regression

| Step | Action | Details |
|------|--------|---------|
| 22 | Switch model to Haiku, re-execute, compare | Re-run execution with `model: "haiku"`, compare output quality --> **Score criterion 10** |

---

## 4. Per-Template Details

Each subsection documents one template's identity, connectors, dimension
capabilities, auto-point rules, and skip conditions.

**Dimension key:**
- `user_message` -- the persona produces a user-facing message
- `agent_memory` -- the persona writes to long-term memory
- `manual_review` -- the persona generates a human review artifact
- `emit_event` -- the persona emits a trackable event

All templates have **all four** dimensions unless noted otherwise.

---

### 4.1 database-performance-monitor

| Field | Value |
|-------|-------|
| Slug | `database-performance-monitor` |
| Name | Database Performance Monitor |
| Category | Infrastructure |
| Tier | 0 (Dry Run) |
| Connectors | Local Database |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | None -- always runnable |

---

### 4.2 budget-spending-monitor

| Field | Value |
|-------|-------|
| Slug | `budget-spending-monitor` |
| Name | Budget Spending Monitor |
| Category | Finance |
| Tier | 1 |
| Connectors | Local Database |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | None |

---

### 4.3 incident-logger

| Field | Value |
|-------|-------|
| Slug | `incident-logger` |
| Name | Incident Logger |
| Category | Operations |
| Tier | 1 |
| Connectors | Local Database, In-App Messaging |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | None |

---

### 4.4 service-health-reporter

| Field | Value |
|-------|-------|
| Slug | `service-health-reporter` |
| Name | Service Health Reporter |
| Category | Operations |
| Tier | 1 |
| Connectors | Local Database, In-App Messaging |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | None |

---

### 4.5 content-performance-reporter

| Field | Value |
|-------|-------|
| Slug | `content-performance-reporter` |
| Name | Content Performance Reporter |
| Category | Content |
| Tier | 1 |
| Connectors | Local Database, In-App Messaging |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | None |

---

### 4.6 research-paper-indexer

| Field | Value |
|-------|-------|
| Slug | `research-paper-indexer` |
| Name | Research Paper Indexer |
| Category | Research |
| Tier | 1 |
| Connectors | Local Database |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | None |

---

### 4.7 notion-docs-auditor

| Field | Value |
|-------|-------|
| Slug | `notion-docs-auditor` |
| Name | Notion Docs Auditor |
| Category | Documentation |
| Tier | 2 |
| Connectors | Notion |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.8 content-schedule-manager

| Field | Value |
|-------|-------|
| Slug | `content-schedule-manager` |
| Name | Content Schedule Manager |
| Category | Content |
| Tier | 2 |
| Connectors | Notion |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.9 daily-standup-compiler

| Field | Value |
|-------|-------|
| Slug | `daily-standup-compiler` |
| Name | Daily Standup Compiler |
| Category | Team |
| Tier | 2 |
| Connectors | Notion |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.10 research-knowledge-curator

| Field | Value |
|-------|-------|
| Slug | `research-knowledge-curator` |
| Name | Research Knowledge Curator |
| Category | Research |
| Tier | 2 |
| Connectors | Notion |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.11 technical-decision-tracker

| Field | Value |
|-------|-------|
| Slug | `technical-decision-tracker` |
| Name | Technical Decision Tracker |
| Category | Engineering |
| Tier | 2 |
| Connectors | Notion |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.12 weekly-review-reporter

| Field | Value |
|-------|-------|
| Slug | `weekly-review-reporter` |
| Name | Weekly Review Reporter |
| Category | Reporting |
| Tier | 2 |
| Connectors | Notion |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.13 email-morning-digest

| Field | Value |
|-------|-------|
| Slug | `email-morning-digest` |
| Name | Email Morning Digest |
| Category | Email |
| Tier | 3 |
| Connectors | Gmail (listed as "Email") |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.14 email-support-assistant

| Field | Value |
|-------|-------|
| Slug | `email-support-assistant` |
| Name | Email Support Assistant |
| Category | Support |
| Tier | 3 |
| Connectors | Gmail (listed as "Email"), Local Database |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.15 email-follow-up-tracker

| Field | Value |
|-------|-------|
| Slug | `email-follow-up-tracker` |
| Name | Email Follow-Up Tracker |
| Category | Email |
| Tier | 3 |
| Connectors | Gmail, Slack |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | Skip if Gmail credential is not configured; Slack connector may additionally gate execution |

---

### 4.16 email-lead-extractor

| Field | Value |
|-------|-------|
| Slug | `email-lead-extractor` |
| Name | Email Lead Extractor |
| Category | Sales |
| Tier | 3 |
| Connectors | Gmail, Local Database |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.17 email-task-extractor

| Field | Value |
|-------|-------|
| Slug | `email-task-extractor` |
| Name | Email Task Extractor |
| Category | Productivity |
| Tier | 3 |
| Connectors | Gmail, Notion |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | Skip if Gmail or Notion credential is not configured |

---

### 4.18 survey-insights-analyzer

| Field | Value |
|-------|-------|
| Slug | `survey-insights-analyzer` |
| Name | Survey Insights Analyzer |
| Category | Analytics |
| Tier | 3 |
| Connectors | Gmail |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.19 expense-receipt-tracker

| Field | Value |
|-------|-------|
| Slug | `expense-receipt-tracker` |
| Name | Expense Receipt Tracker |
| Category | Finance |
| Tier | 3 |
| Connectors | Gmail, Local Database |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.20 invoice-tracker

| Field | Value |
|-------|-------|
| Slug | `invoice-tracker` |
| Name | Invoice Tracker |
| Category | Finance |
| Tier | 3 |
| Connectors | Gmail, Local Database |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.21 idea-harvester

| Field | Value |
|-------|-------|
| Slug | `idea-harvester` |
| Name | Idea Harvester |
| Category | Ideation |
| Tier | 4 |
| Connectors | Gmail, Notion |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail or Notion credential is not configured |

---

### 4.22 newsletter-curator

| Field | Value |
|-------|-------|
| Slug | `newsletter-curator` |
| Name | Newsletter Curator |
| Category | Content |
| Tier | 4 |
| Connectors | Notion, Gmail |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail or Notion credential is not configured |

---

### 4.23 access-request-manager

| Field | Value |
|-------|-------|
| Slug | `access-request-manager` |
| Name | Access Request Manager |
| Category | Security |
| Tier | 4 |
| Connectors | Gmail, Local Database, In-App Messaging |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.24 contact-enrichment-agent

| Field | Value |
|-------|-------|
| Slug | `contact-enrichment-agent` |
| Name | Contact Enrichment Agent |
| Category | CRM |
| Tier | 4 |
| Connectors | Gmail, Local Database |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.25 contact-sync-manager

| Field | Value |
|-------|-------|
| Slug | `contact-sync-manager` |
| Name | Contact Sync Manager |
| Category | CRM |
| Tier | 4 |
| Connectors | Gmail, Local Database |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail credential is not configured |

---

### 4.26 support-email-router

| Field | Value |
|-------|-------|
| Slug | `support-email-router` |
| Name | Support Email Router |
| Category | Support |
| Tier | 4 |
| Connectors | Gmail, Notion |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Gmail or Notion credential is not configured |

---

### 4.27 onboarding-tracker

| Field | Value |
|-------|-------|
| Slug | `onboarding-tracker` |
| Name | Onboarding Tracker |
| Category | HR |
| Tier | 4 |
| Connectors | Notion, Local Database, In-App Messaging |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.28 sales-deal-analyzer

| Field | Value |
|-------|-------|
| Slug | `sales-deal-analyzer` |
| Name | Sales Deal Analyzer |
| Category | Sales |
| Tier | 4 |
| Connectors | Local Database, Notion |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.29 sales-proposal-generator

| Field | Value |
|-------|-------|
| Slug | `sales-proposal-generator` |
| Name | Sales Proposal Generator |
| Category | Sales |
| Tier | 4 |
| Connectors | Local Database, Notion |
| Dimensions | user_message, agent_memory, manual_review, emit_event |
| Auto-points | None |
| Skip conditions | Skip if Notion credential is not configured |

---

### 4.30 sales-deal-tracker

| Field | Value |
|-------|-------|
| Slug | `sales-deal-tracker` |
| Name | Sales Deal Tracker |
| Category | Sales |
| Tier | 5 (Skip) |
| Connectors | Salesforce |
| Dimensions | user_message, agent_memory, emit_event |
| Missing dimensions | **manual_review** |
| Auto-points | Criterion 6 (human review) |
| Skip conditions | **Always skip** -- Salesforce connector unavailable |

---

## 5. Results Format

Each test run produces a JSON result file. The runner collects all template
results into a single array.

### Single Template Result

```json
{
  "template_slug": "budget-spending-monitor",
  "template_name": "Budget Spending Monitor",
  "tier": 1,
  "persona_id": "uuid-here",
  "timestamp": "2026-03-23T14:30:00Z",
  "skipped": false,
  "skip_reason": null,
  "duration_ms": 45230,
  "scores": {
    "1_promoted": { "passed": true, "auto_point": false, "detail": "buildPhase == promoted" },
    "2_connectors_tested": { "passed": true, "auto_point": false, "detail": "buildTestPassed == true" },
    "3_matrix_viewable": { "passed": true, "auto_point": false, "detail": "matrix-tab-container found" },
    "4_execution_completed": { "passed": true, "auto_point": false, "detail": "execution completed in 12340 ms" },
    "5_message_populated": { "passed": true, "auto_point": false, "detail": "persona_messages count = 3" },
    "6_human_review": { "passed": true, "auto_point": true, "detail": "Auto-point: manual_review not in dimensions" },
    "7_event_created": { "passed": true, "auto_point": false, "detail": "persona_events count = 2" },
    "8_memory_generated": { "passed": true, "auto_point": false, "detail": "persona_memories count = 1, no error content" },
    "9_value_evaluation": { "passed": true, "auto_point": false, "detail": "Output length 847 chars, keywords matched" },
    "10_haiku_regression": { "passed": true, "auto_point": false, "detail": "Haiku output 712 chars, 78% keyword overlap" }
  },
  "total_score": 10,
  "max_score": 10,
  "errors": []
}
```

### Skipped Template Result

```json
{
  "template_slug": "sales-deal-tracker",
  "template_name": "Sales Deal Tracker",
  "tier": 5,
  "persona_id": null,
  "timestamp": "2026-03-23T14:35:00Z",
  "skipped": true,
  "skip_reason": "Salesforce connector unavailable",
  "duration_ms": 0,
  "scores": {},
  "total_score": null,
  "max_score": 10,
  "errors": []
}
```

### Aggregate Summary

```json
{
  "run_id": "run-20260323-143000",
  "started_at": "2026-03-23T14:30:00Z",
  "finished_at": "2026-03-23T15:12:00Z",
  "environment": {
    "app_version": "0.5.0",
    "primary_model": "claude-sonnet-4-20250514",
    "haiku_model": "claude-haiku-3-20240307",
    "credentials_available": ["gmail", "notion"]
  },
  "tier_summary": {
    "tier_0": { "total": 1, "run": 1, "skipped": 0, "avg_score": 10.0 },
    "tier_1": { "total": 5, "run": 5, "skipped": 0, "avg_score": 9.6 },
    "tier_2": { "total": 6, "run": 6, "skipped": 0, "avg_score": 9.8 },
    "tier_3": { "total": 8, "run": 8, "skipped": 0, "avg_score": 9.5 },
    "tier_4": { "total": 9, "run": 9, "skipped": 0, "avg_score": 9.7 },
    "tier_5": { "total": 1, "run": 0, "skipped": 1, "avg_score": null }
  },
  "overall": {
    "total_templates": 30,
    "templates_run": 29,
    "templates_skipped": 1,
    "average_score": 9.65,
    "perfect_scores": 22,
    "failures": []
  },
  "results": [
    "...array of per-template result objects..."
  ]
}
```

### Output File Naming

Results are written to `docs/tests/results/` with the naming convention:

```
template-adoption-{run_id}.json
```

Example: `template-adoption-run-20260323-143000.json`

---

## Appendix: Quick Reference -- Auto-Point Templates

The following 10 templates are missing the `manual_review` dimension and
therefore receive an automatic point for criterion 6:

| Template | Tier |
|----------|------|
| budget-spending-monitor | 1 |
| incident-logger | 1 |
| service-health-reporter | 1 |
| daily-standup-compiler | 2 |
| research-knowledge-curator | 2 |
| weekly-review-reporter | 2 |
| email-morning-digest | 3 |
| email-follow-up-tracker | 3 |
| email-task-extractor | 3 |
| sales-deal-tracker | 5 |

No templates are missing `user_message`, `agent_memory`, or `emit_event`
dimensions, so criteria 5, 7, and 8 never receive auto-points.

---

## 6. Lessons Learned (Session 2026-03-23/24)

### Critical Bugs Found and Fixed

#### A. Promote Path for Template Adoptions
**File:** `src/features/agents/components/matrix/useMatrixLifecycle.ts`

The `handlePromote` function checked `hasRichDraft` by looking for agent_ir keys
(`system_prompt`, `tools`, `triggers`) but template payloads use different names
(`structured_prompt`, `suggested_tools`, `suggested_triggers`). When the check
failed, promote used a minimal fallback that only set `enabled=true` without
saving `last_design_result` or `structured_prompt`. Fix: also check for
`sessionId` existence -- when a build session exists, always use the Rust
promote path which reads from the session's `agent_ir`.

#### B. Design Result Dimension Population
**File:** `src-tauri/src/commands/design/build_sessions.rs`

The Rust `promote_build_draft_inner` had key mismatches:
- Read `use_cases` but templates have `use_case_flows`
- Filtered events by `direction == "subscribe"` but template events have no `direction` field
- Constructed `design_result` from `required_connectors` but templates use `suggested_connectors`
- Didn't include `use_case_flows`, `service_flow`, or `suggested_event_subscriptions` in `design_result`

Fix: Added fallback keys for all template payload formats and included all
dimension data in the constructed `design_result`.

#### C. String Tool Names in tool_def_from_ir
**File:** `src-tauri/src/engine/tool_runner.rs`

Template payloads use string tool names (`["notion", "gmail"]`) but
`tool_def_from_ir` only handled JSON objects with `"name"` field. String tools
were silently dropped, preventing credential resolution. Fix: handle both
string and object formats, set `requires_credential_type` to the tool name.

#### D. Event source_type Validation
**File:** `src-tauri/src/engine/dispatch.rs`

`emit_event` dispatch used `format!("persona:{}", persona_name)` as `source_type`
but persona names with spaces (e.g. "Budget Spending Monitor") failed the
validator which only allows alphanumeric, underscore, hyphen, dot, colon, slash.
Fix: sanitize persona name (replace spaces with underscores, filter invalid chars).

#### E. Post-mortem Protocol Extraction
**File:** `src-tauri/src/engine/runner.rs`

Protocol messages (`emit_event`, `agent_memory`) that spanned multiple streaming
deltas were missed by the mid-stream parser. Fix: added post-mortem scan of
accumulated `assistant_text` after CLI process exits, with dedup checks to avoid
double-creating records already dispatched during streaming.

### Quality Issues Found and Fixed

#### F. Manual Review Contains Operational Errors
Reviews like "No pages shared with integration" are infrastructure problems,
not business decisions. Fix: expanded the review quality gate in `dispatch.rs`
to reject reviews containing operational error patterns ("no pages shared",
"no page access", "audit blocked", "has no", "not shared with").

#### G. Memory Contains Negative Scenarios
Memories like "No Notion API credentials available" provide no learning value.
Fix: tightened the memory quality filter to reject content about credential
failures, authentication issues, and empty workspace problems.

#### H. Execution Mode Directive
The LLM treated executions as conversations ("I'm ready to help..."). Fix:
added `EXECUTION_MODE_DIRECTIVE` constant at prompt start establishing
autonomous one-shot execution, with explicit rules about manual_review
(business decisions only, not operational issues) and protocol requirements.

#### I. Review-to-Memory Link
When a manual review is resolved (approved/rejected), a memory is now
automatically created recording the decision for the persona to learn from.

### Test Infrastructure Issues

#### J. Persona ID Cross-Contamination
The test script read `selectedPersonaId` from Zustand state which persisted
across test runs. Fix: poll for `buildPersonaId` specifically (the newly
created persona), with DB fallback query by template name.

#### K. Stale Artifact Counts
Test scored C5-C9 by counting ALL artifacts for a persona_id including from
previous runs. Fix: record `_exec_started_at` timestamp, scope all artifact
queries to `created_at >= timestamp`.

#### L. Persona Deletion Cascade
Deleting a persona left orphaned records in `persona_memories`,
`persona_messages`, `persona_events`, `persona_healing_issues`. Fix: explicit
cleanup in `personas.rs` delete function for tables lacking ON DELETE CASCADE.

### Running Templates 11-30

When continuing the test run for templates 11-30, be aware of:

1. **API Rate Limits**: Running many templates back-to-back may exhaust the
   Anthropic API quota. Each template requires 2 executions (Sonnet + Haiku).
   If you see "You've hit your limit" in execution logs, wait for the rate
   limit window to reset before continuing.

2. **Template Slugs**: Two templates have mismatched slugs in the gallery:
   - `email-morning-digest` -- gallery row uses `seed-email-morning-digest`
     but the template ID may differ. Check the gallery data-testid.
   - `email-support-assistant` -- same issue.

3. **Credential Validation**: The build test now properly fails when tools
   lack credentials. Templates blocked by this (0/10 with "Build test failed")
   need their connector credential added in the Keys section, or the template
   needs alternative tool definitions.

4. **Execution Timeout**: The test polls for 10 minutes (120 iterations x 5s).
   Some heavy executions (e.g. database-performance-monitor querying all
   Supabase tables) may exceed this. If C4 fails with "Execution timeout",
   the execution may still be running in the background.

5. **Quality Audit**: After each template completes, audit the actual content
   in the database -- not just artifact counts. Check:
   - Messages have substantive content (not just "I'm ready to help")
   - Reviews are business decisions (not operational errors)
   - Memories are genuine learnings (not "missing credentials")
   - Events match the template's defined event types

### Validated Templates (10/10 confirmed with quality audit)

| # | Template | Connectors | Key Quality Markers |
|---|----------|------------|---------------------|
| 1 | Incident Logger | Local DB, Messaging | Structured incident records in messages, low-severity audit reviews, procedure learnings in memories, incident_logged events |

### Templates Pending Retest (previous results invalidated)

Templates 2-10 from Tier 0-2 need retesting with the fixed pipeline.
Templates 11-30 have never been tested with the correct methodology.
