# Adoption Process Test Framework

## Operator Model

Claude Code CLI is the test operator. It processes templates **one at a time**, evaluating both the template data and the adoption app code. When it finds issues, it fixes them immediately — patching the template JSON, the wizard UI code, or shared infrastructure — before moving to the next template.

```
For each template in scripts/templates/:
  1. Read template JSON + relevant app code
  2. Classify connector requirements → run or skip
  3. Simulate adoption flow (static, no backend)
  4. Score across dimensions
  5. If issues found:
     a. Fix template JSON (adoption_questions, defaults, prompts)
     b. Fix app code (wizard steps, reducer, context, types)
     c. Log what was changed and why
  6. Write per-template report
  7. Next template
```

This is NOT a test suite that runs in CI. It is a **design document for Claude Code CLI sessions** where the operator evaluates and improves the adoption pipeline.

## Connector Eligibility

Templates are classified before evaluation based on connector requirements:

### Runnable

A template is **runnable** if every `suggested_connector` satisfies one of:
- Is a virtual/built-in connector (`personas_messages`, `personas_database`)
- Has a matching builtin definition in `scripts/connectors/builtin/`
- Is swappable to a connector that satisfies the above (via `connectorRoles.ts`)

For the adoption simulation, built-in connectors are assumed always available. No real credentials are needed — the evaluator assesses whether the wizard flow, questions, and generated prompt are correct, not whether API calls succeed.

### Skipped

Templates requiring connectors with **no builtin definition and no role-swap alternative** are skipped. The final report lists:
- Total templates: 74
- Evaluated: N
- Skipped (missing connectors): M
- Skipped template IDs + which connectors are missing

The evaluator does NOT attempt to create connector definitions or mock external services.

## Evaluation Scope

### What the evaluator checks per template

#### A. Template Data Quality

| Check | What | Fix target |
|-------|------|------------|
| Schema completeness | All required payload fields present and non-empty | Template JSON |
| Use case flow graph integrity | Connected nodes, valid edges, start/end nodes present | Template JSON |
| Trigger validity | Schedule has cron or description, webhook has path, polling has interval | Template JSON |
| Connector-role alignment | Every connector references a valid role from `connectorRoles.ts` | Template JSON or `connectorRoles.ts` |
| Adoption question fitness | Questions are precise, tied to use cases, typed correctly | Template JSON `adoption_questions` field |
| Default value coverage | Required variables have defaults or are select-type | Template JSON |
| Prompt quality | Identity, instructions, tool guidance, examples, error handling are substantive | Template JSON `structured_prompt` / `full_prompt_markdown` |
| Safety scan | No critical findings in prompt text | Template JSON |

#### B. Adoption App Code Quality

| Check | What | Fix target |
|-------|------|------------|
| Wizard step rendering | Each step handles the template's data shape without errors (null connectors, empty flows, missing fields) | Step components (`ChooseStep`, `ConnectStep`, `TuneStep`, `BuildStep`, `CreateStep`) |
| Connector resolution | Virtual connectors render correctly, role-swap works for this template's roles | `ConnectStep.tsx`, `connectorRoles.ts` |
| Variable rendering | All variable types (`text`, `select`, `cron`, `url`, `email`, `number`, `json`) render with correct inputs | `TuneStep.tsx` |
| Trigger config rendering | All trigger types in this template have matching UI inputs | `TuneStep.tsx` trigger column |
| State completeness | AdoptState carries all fields needed for this template's adoption flow | `useAdoptReducer.ts` |
| Draft-to-persona mapping | Generated draft fields map correctly to persona creation API | `useAsyncTransform.ts`, `templateAdopt.ts` |
| Adoption question rendering | Questions from template render and answers flow into transform | `TuneStep.tsx`, `AdoptionWizardContext.tsx` |
| Edge case handling | Empty use cases, zero connectors, no triggers, no variables — does the UI degrade gracefully? | Step components |

#### C. Generated Persona Quality (LLM judgment)

The evaluator reads the template's `full_prompt_markdown`, `structured_prompt`, tools, triggers, and connectors as if it were the generated draft (since without a running backend, this is the closest proxy). It scores:

| Dimension | Weight | What to assess |
|-----------|--------|----------------|
| Prompt Completeness | 3 | Identity (>50 words), instructions (>200 words, numbered steps), tool guidance (API endpoints), examples (2+ scenarios), error handling |
| Tool-Prompt Alignment | 2 | Every tool referenced in prompt has a definition; no phantom tools |
| Trigger Coherence | 2 | Trigger configs match prompt workflow; schedules are sensible |
| Connector Coverage | 2 | Every service in `service_flow` backed by a connector definition |
| Memory Design | 1 | Prompt describes what to learn/retain; memory scope fits the use case |
| Error Handling | 2 | Per-service failure strategy, rate limits, data validation |
| Use Case Fidelity | 2 | Prompt covers all workflows described by `use_case_flows` |
| Value Clarity | 2 | Clear business outcome per execution |
| Execution Feasibility | 3 | Tools are standard, connectors have real APIs, trigger configs actionable |
| Differentiation | 1 | Persona adds reasoning beyond what a simple cron/webhook could do |
| Variable Necessity | 1 | Required variables genuinely needed, not filler |
| Default Quality | 2 | Could a user adopt with zero changes and get a working persona? |

### Grading

| Grade | Score | Meaning |
|-------|-------|---------|
| A | >= 8.5 | Production-ready |
| B | >= 7.0 | Good, minor gaps |
| C | >= 5.5 | Functional, needs work |
| D | >= 4.0 | Significant issues |
| F | < 4.0 | Broken or dangerous |

## Evaluation Procedure (Claude Code CLI Playbook)

### Session Setup

```
1. Read this document
2. Read the adoption wizard code:
   - src/features/templates/sub_generated/adoption/useAdoptReducer.ts
   - src/features/templates/sub_generated/adoption/AdoptionWizardContext.tsx
   - src/features/templates/sub_generated/adoption/steps/*.tsx
   - src/lib/types/designTypes.ts
   - scripts/connectors/builtin/ (list available connectors)
   - src/lib/credentials/connectorRoles.ts
3. Build a mental model of:
   - Which connector roles exist and their members
   - What virtual connectors are always available
   - What the AdoptState shape is
   - What each wizard step expects from the template
```

### Per-Template Evaluation

```
For template T:

1. READ template JSON from scripts/templates/{category}/{id}.json

2. CLASSIFY connectors:
   - For each suggested_connector:
     - Is it virtual (personas_messages, personas_database)? → available
     - Does scripts/connectors/builtin/{name}.json exist? → available
     - Does it have a role with available members? → swappable
     - None of the above? → missing
   - If any connector is missing and not swappable → SKIP template, log reason

3. EVALUATE template data (checks A above):
   - Parse structured_prompt sections, check length and substance
   - Validate use_case_flows graph connectivity
   - Check triggers have valid configs
   - Verify connector roles
   - Run safety patterns against prompt text
   - Check adoption_questions (if present) reference valid IDs
   - Check variable defaults

4. EVALUATE app code fit (checks B above):
   - Would ChooseStep render this template's use_case_flows correctly?
   - Would ConnectStep handle the connector set (virtual, regular, role-swap)?
   - Would TuneStep render all variable types and trigger types?
   - Does the state carry what this template needs?

5. SCORE dimensions (section C above):
   - Read full_prompt_markdown as the "generated persona"
   - Score each of the 12 dimensions 0-10
   - Compute weighted average → overall score → grade

6. FIX issues found:
   Template fixes:
   - Add/improve adoption_questions if connectors need user-specific config
   - Fix missing default_values on required variables
   - Improve structured_prompt sections that are too thin
   - Add missing error handling in prompt
   - Fix use_case_flow graph errors (disconnected nodes, missing edges)

   App code fixes:
   - If a variable type isn't handled in TuneStep, add the input
   - If a connector role isn't in connectorRoles.ts, add it
   - If a state field is missing for this template's needs, add it
   - If a step component would crash on this template's data shape, add guards

7. WRITE per-template report to adoption-reports/{id}.json

8. NEXT template
```

### Adoption Question Generation

When evaluating a template that has connectors requiring user-specific configuration (e.g., Slack channel, email address, repository URL), the evaluator generates `adoption_questions` and writes them into the template JSON.

Question generation rules:
- One question per user-specific config value that the persona needs at runtime
- Tied to `use_case_ids` when the question only applies to specific flows
- Typed: `text` for free-form, `select` for constrained choices, `boolean` for toggles
- Include `context` field explaining why this is needed
- Include sensible `default` where possible
- Category: `configuration`, `credentials`, `human_in_the_loop`, `memory`

Example for an email template with Gmail + Slack connectors:
```json
{
  "adoption_questions": [
    {
      "id": "watch_email",
      "question": "Which email address should this persona monitor?",
      "type": "text",
      "default": "inbox@yourcompany.com",
      "context": "The persona watches this inbox for incoming messages to process",
      "connector_names": ["google_workspace"],
      "category": "configuration"
    },
    {
      "id": "slack_channel",
      "question": "Which Slack channel should receive notifications?",
      "type": "text",
      "default": "#notifications",
      "context": "Processed emails are forwarded to this channel",
      "connector_names": ["slack"],
      "category": "configuration"
    },
    {
      "id": "auto_label",
      "question": "Should processed emails be automatically labeled?",
      "type": "boolean",
      "default": "Yes",
      "context": "Adds a 'Processed' label to emails after the persona handles them",
      "use_case_ids": ["flow_1"],
      "category": "configuration"
    }
  ]
}
```

## Report Format

### Per-Template Report

```json
{
  "templateId": "incident-commander",
  "templateName": "Incident Commander",
  "category": ["devops"],
  "status": "evaluated",
  "timestamp": "2026-03-08T...",

  "connectorClassification": {
    "available": ["slack", "personas_database"],
    "swapped": { "pagerduty": "opsgenie" },
    "missing": []
  },

  "staticChecks": {
    "passed": true,
    "checks": [
      { "name": "schema_completeness", "passed": true },
      { "name": "flow_integrity", "passed": true },
      { "name": "trigger_validity", "passed": true },
      { "name": "safety_scan", "passed": true, "detail": "0 critical, 1 info" }
    ]
  },

  "dimensions": [
    { "name": "Prompt Completeness", "category": "technical", "score": 9, "weight": 3, "rationale": "..." },
    { "name": "Tool-Prompt Alignment", "category": "technical", "score": 8, "weight": 2, "rationale": "..." }
  ],

  "overall": 8.2,
  "grade": "B",

  "issues": [
    "No adoption_questions — Slack channel and PagerDuty service ID should be asked",
    "Error handling section doesn't cover Datadog API rate limits"
  ],

  "fixes_applied": {
    "template": [
      "Added 3 adoption_questions for slack_channel, pagerduty_service_id, datadog_priority_threshold",
      "Added rate limit handling paragraph to structured_prompt.errorHandling"
    ],
    "app_code": []
  }
}
```

### Catalog Summary Report

Written at the end of a full evaluation session.

```json
{
  "timestamp": "2026-03-08T...",
  "total_templates": 74,
  "evaluated": 68,
  "skipped": {
    "count": 6,
    "templates": [
      { "id": "salesforce-pipeline", "missing_connectors": ["salesforce"] },
      { "id": "hubspot-crm-sync", "missing_connectors": ["hubspot"] }
    ]
  },

  "grade_distribution": { "A": 12, "B": 34, "C": 18, "D": 4, "F": 0 },
  "average_score": 7.4,

  "category_scores": {
    "devops": { "avg": 8.1, "count": 8, "worst": "log-aggregator" },
    "email": { "avg": 6.8, "count": 2, "worst": "intake-processor" }
  },

  "common_issues": [
    { "issue": "No adoption_questions despite needing user-specific config", "count": 45 },
    { "issue": "Error handling section under 50 words", "count": 12 },
    { "issue": "Missing default_value on required variables", "count": 8 }
  ],

  "weakest_dimensions": [
    { "dimension": "Memory Design", "avg_score": 5.2 },
    { "dimension": "Default Quality", "avg_score": 6.1 }
  ],

  "app_code_fixes": [
    { "file": "src/lib/credentials/connectorRoles.ts", "description": "Added 3 new roles: log_aggregation, crm_system, ci_cd" },
    { "file": "src/features/templates/sub_generated/adoption/steps/TuneStep.tsx", "description": "Added json variable type input" }
  ],

  "templates_with_questions_added": 45,
  "total_questions_generated": 127
}
```

## App Code Patterns to Watch

These are recurring code issues the evaluator should look for across templates, fixing them once in shared code rather than per-template:

### State shape gaps

If a template needs a state field not in `AdoptState` (e.g., a new preference type), add it to:
1. `useAdoptReducer.ts` — `AdoptState` interface + `INITIAL_STATE`
2. `AdoptionWizardContext.tsx` — expose via context if needed by steps
3. `uiSlice.ts` `AdoptionDraft` — if it should persist across modal close

### Missing variable types

If a template has a variable type not handled in `TuneStep.tsx` (e.g., `json`, `number`), add the input rendering case.

### Connector role gaps

If a template's connector has a `role` not in `connectorRoles.ts`, add the role definition with its member list. This enables connector swapping during adoption.

### Edge cases in step components

Templates may have:
- Zero use case flows → `ChooseStep` should show entity checklists fallback
- Zero triggers → Trigger column in `TuneStep` should show "No triggers"
- Zero connectors → `ConnectStep` shows empty state
- All connectors virtual → `ConnectStep` shows all as "Built-in"
- No structured_prompt (only full_prompt_markdown) → `CreateStep` should still work

The evaluator verifies each template against these edge cases and adds guards where missing.

## Implementation Plan

### Phase 1: Evaluation Skill

Create a Claude Code skill at `.claude/skills/evaluate-adoption/skill.md` that encodes the playbook above. The skill:
- Accepts `--template={id}` for single template or `--category={name}` or `--all`
- Reads templates and app code
- Performs the evaluation procedure
- Writes reports to `adoption-reports/`
- Applies fixes with commits per template

### Phase 2: Static Utilities

Create lightweight helpers the skill invokes (not a full test framework, just shared logic):

```
src/test/adoption/
  templateLoader.ts       - Read and parse all template JSONs
  connectorClassifier.ts  - Classify connectors as available/swappable/missing
  flowValidator.ts        - Validate use_case_flow graph structure
  promptAnalyzer.ts       - Check structured_prompt section lengths and content
  reportWriter.ts         - Write per-template and summary reports
```

These are utility functions, not test runners. The evaluator (Claude Code CLI) calls them mentally or literally during evaluation.

### Phase 3: Category Sweeps

Run the skill category by category:
1. `devops` (8 templates) — calibrate scoring, fix shared code issues
2. `development` (14 templates) — largest category, will surface most edge cases
3. `productivity` (10 templates)
4. Remaining categories in order of size

Each sweep produces a category report and potentially app code fixes that benefit subsequent categories.

### Phase 4: Cross-Template Analysis

After all templates evaluated, analyze the summary report for:
- Dimensions that are consistently weak → systemic template generation issue
- App code fixes that were needed multiple times → missing abstractions
- Templates that scored F → investigate whether the template concept is viable
- Adoption question patterns → extract reusable question templates per connector type

### Phase 5: Adoption Question Library

Extract common questions into a reusable library keyed by connector name:

```typescript
// src/lib/templates/adoptionQuestionLibrary.ts
export const CONNECTOR_QUESTIONS: Record<string, AdoptionQuestion[]> = {
  slack: [
    { id: 'slack_channel', question: 'Which Slack channel?', type: 'text', default: '#general', ... },
    { id: 'slack_mention', question: 'Should the bot @mention users?', type: 'boolean', default: 'No', ... },
  ],
  google_workspace: [
    { id: 'gmail_watch_address', question: 'Email address to monitor?', type: 'text', ... },
    { id: 'gmail_label', question: 'Label for processed emails?', type: 'text', default: 'Processed', ... },
  ],
  // ...per connector
};
```

Templates can reference this library instead of duplicating questions. The adoption wizard merges library questions with template-specific ones based on which connectors are selected.

## Cost & Time Estimates

| Phase | Sessions | LLM cost | Output |
|-------|----------|----------|--------|
| Phase 1: Skill creation | 1 | $0 | `.claude/skills/evaluate-adoption/skill.md` |
| Phase 2: Static utilities | 1 | $0 | 5 utility files |
| Phase 3: Category sweeps (74 templates) | 5-8 | ~$5-10 (context for reading/fixing) | 74 template reports, template fixes, app code fixes |
| Phase 4: Cross-template analysis | 1 | $0 | Summary report |
| Phase 5: Question library | 1-2 | $0 | Library file + template updates |

Total: ~10-13 sessions, ~$5-10 in LLM context costs. No backend/transform costs since evaluation is static.
