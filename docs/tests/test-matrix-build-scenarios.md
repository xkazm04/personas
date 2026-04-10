# PersonaMatrix Build Test Scenarios

20 end-to-end agent creation scenarios for validating the PersonaMatrix build flow.
Run with the test automation framework (`docs/test-automation-guide.md`).

## Prerequisites

```bash
# Start app with test automation enabled
npx tauri dev --features test-automation

# Verify test server
curl http://127.0.0.1:17320/health
```

## User's Credential Inventory

These are the credentials currently saved in the vault. Scenarios are designed
to exercise both "credential present" and "credential missing" paths.

| Credential | Service Type | Status |
|---|---|---|
| Gmail OAuth | gmail | Active (OAuth) |
| Google Calendar OAuth | google_calendar | Active (OAuth) |
| Notion PAT | notion | Active |
| Airtable PAT | airtable | Active |
| Asana PAT | asana | Active |
| ClickUp PAT | clickup | Active |
| Linear PAT | linear | Active |
| Sentry PAT | sentry | Active |
| Better Stack PAT | betterstack | Active |
| Cal.com API Key | cal_com | Active |
| Leonardo AI API Key | leonardo_ai | Active |
| Supabase Connection | supabase | Active |
| Attio PAT | attio | Active |
| Built-in Database | personas_database | Active |

**Not available:** Slack, Discord, GitHub, GitLab, HubSpot, Stripe, Twilio, SendGrid, AWS, Jira, Telegram, Shopify, Pipedrive

---

## Test Procedure (for LLM CLI runner)

Each scenario follows this protocol:

```
SETUP:
  1. navigate("personas")
  2. start_create_agent()
  3. wait_for('[data-testid="agent-intent-input"]')
  4. fill_field("agent-intent-input", "<INTENT>")
  5. click_testid("agent-launch-btn")

OBSERVE BUILD:
  6. Wait 15-30s for CLI to process first turn
  7. snapshot() — verify matrix cells are populating
  8. Check: at least 3-5 cells should show "resolved" or "highlighted" state
  9. Check: question modal should appear for mandatory dimensions

ANSWER QUESTIONS:
  10. For each question that appears:
      - Read the question text and options
      - Verify: question is clear and understandable to a non-technical user
      - Verify: options are specific (not vague like "default" or "standard")
      - Select an option or type a custom answer
      - Verify: cell transitions from "highlighted" → "filling" → "resolved"
      - Verify: cell does NOT stay stuck in "Analyzing" state

VERIFY DIMENSIONS:
  11. After all questions answered, verify all 8 dimensions resolved:
      - use-cases: specific tasks, not generic descriptions
      - connectors: each has credential status (green/amber/red)
      - triggers: specific schedules or event types
      - messages: concrete notification channels and formats
      - human-review: clear approval rules or "not required" with reason
      - memory: what persists between runs, or "stateless" with reason
      - error-handling: specific retry/fallback strategies
      - events: observable events the agent emits

VERIFY CONNECTORS:
  12. Check connectors cell:
      - Each connector shows credential status dot (green/amber/red)
      - Connectors with vault credentials show green "Linked"
      - Missing credentials show red "Add in Keys"
      - Alternative swap button (↔) visible where applicable
  13. If alternatives exist: try swapping one connector, verify rebuild triggers

VERIFY AGENT NAME:
  14. Check that agent name is NOT the raw intent text
  15. Name should be short (2-4 words), descriptive, Title Case

VERIFY DRAFT:
  16. Build should reach "draft_ready" phase
  17. snapshot() — verify no error states

CLEANUP:
  18. Delete the created agent OR keep for batch review
```

### UX Clarity Checklist (verify for each scenario)

For every question the CLI asks, the tester must evaluate:

- [ ] **Understandable**: Would a small business owner understand what's being asked?
- [ ] **Specific options**: Options describe concrete behavior, not abstract concepts
- [ ] **No jargon leak**: No API endpoints, cron syntax, or code in user-facing questions
- [ ] **Right scope**: Tasks questions are about WHAT, triggers about WHEN, connectors about WHICH service
- [ ] **Confirmation pattern**: Tasks and triggers propose defaults and ask user to confirm
- [ ] **Batch questions**: Messages + human-review + memory asked together, not in 3 separate turns

---

## Scenarios 1-5: Template-Similar Intents

These match existing templates in `scripts/templates/`. The build should leverage
reference templates for higher quality dimension resolution.

### Scenario 1: Email Intake Triage
**Template match:** `email/intake-processor`
**Intent:** `"Monitor my Gmail for important emails and post summaries to a task list in Notion"`
**Credentials hit:** Gmail OAuth, Notion PAT
**Expected connectors:** Gmail (green), Notion (green)
**Expected alternatives:** Gmail ↔ Outlook; Notion ↔ Airtable
**Key verification:**
- Triggers should propose polling Gmail (specific interval)
- Tasks should include email classification logic
- Memory should mention sender pattern learning
- Human-review should ask about forwarding/acting thresholds

### Scenario 2: Sprint Automation
**Template match:** `development/sprint-automation-use-case`
**Intent:** `"Automate our Linear sprint workflow — create tasks from requirements, track blockers, post daily standups"`
**Credentials hit:** Linear PAT
**Missing credentials:** Slack (for standups)
**Expected connectors:** Linear (green), Slack (red — missing)
**Key verification:**
- Connectors should warn about missing Slack credential
- Suggest Discord or Teams as alternative for standups
- Tasks dimension should break down sprint lifecycle stages
- Triggers should include scheduled standup + event-driven task changes

### Scenario 3: Expense Processing
**Template match:** `finance/expense-receipt-processor`
**Intent:** `"Process expense receipts from Gmail, extract amounts, and log them to Airtable for monthly reporting"`
**Credentials hit:** Gmail OAuth, Airtable PAT
**Expected connectors:** Gmail (green), Airtable (green)
**Key verification:**
- Tasks should include OCR/extraction, categorization, logging
- Human-review should ask about approval thresholds (above $X needs approval)
- Memory should track recurring vendors/categories
- Error handling should address unreadable receipts

### Scenario 4: Research Report Generator
**Template match:** `research/ai-research-report-generator`
**Intent:** `"Research trending topics in my industry weekly and compile findings into a Notion knowledge base"`
**Credentials hit:** Notion PAT
**Expected connectors:** Notion (green)
**Key verification:**
- Triggers should propose weekly schedule (specific day/time)
- Tasks should include search, summarize, store steps
- Messages should ask where to deliver the weekly report
- Memory should learn which topics are most relevant over time

### Scenario 5: CRM Data Quality
**Template match:** `sales/crm-data-quality-auditor`
**Intent:** `"Audit our Attio CRM for duplicate contacts, missing fields, and stale deals — post findings to a report"`
**Credentials hit:** Attio PAT
**Expected connectors:** Attio (green)
**Key verification:**
- Tasks should define specific audit rules (duplicates, missing phone/email, stale >90d)
- Triggers should propose scheduled runs (daily or weekly)
- Error handling should address API rate limits and large datasets
- Human-review should ask about auto-merge vs manual review for duplicates

---

## Scenarios 6-10: Credential-Rich (All Connectors Available)

These use only services where the user has credentials.

### Scenario 6: Meeting Lifecycle Manager
**Intent:** `"Before each Google Calendar meeting, create an agenda in Notion. After the meeting, generate action items and track them in Asana"`
**Credentials hit:** Google Calendar OAuth, Notion PAT, Asana PAT
**Expected connectors:** Google Calendar (green), Notion (green), Asana (green)
**Key verification:**
- Three connectors, all green — no credential gaps
- Triggers should include calendar event-driven (before/after meeting)
- Tasks should clearly separate pre-meeting vs post-meeting workflows
- Memory should track meeting patterns and recurring attendees

### Scenario 7: Error Monitoring Dashboard
**Intent:** `"Watch Sentry for new error spikes and critical issues, create tracking tickets in Linear, and log incidents in Airtable"`
**Credentials hit:** Sentry PAT, Linear PAT, Airtable PAT
**Expected connectors:** Sentry (green), Linear (green), Airtable (green)
**Key verification:**
- Triggers should use Sentry webhooks or polling
- Human-review should ask about auto-creating tickets vs manual review
- Error handling should address Sentry API pagination
- Events should emit incident_detected, ticket_created, resolved

### Scenario 8: Appointment Scheduler
**Intent:** `"Sync my Cal.com bookings with Google Calendar and create preparation notes in Notion for each upcoming appointment"`
**Credentials hit:** Cal.com API Key, Google Calendar OAuth, Notion PAT
**Expected connectors:** Cal.com (green), Google Calendar (green), Notion (green)
**Key verification:**
- Two calendar services should be clearly scoped (Cal.com = source, GCal = sync target)
- Tasks should include booking detection, calendar sync, note creation
- Memory should learn client preferences and recurring appointment types

### Scenario 9: AI Image Asset Creator
**Intent:** `"Generate product images using Leonardo AI based on briefs in an Airtable board, store results back in Airtable with metadata"`
**Credentials hit:** Leonardo AI API Key, Airtable PAT
**Expected connectors:** Leonardo AI (green), Airtable (green)
**Key verification:**
- Tasks should cover brief parsing, image generation, metadata extraction, storage
- Human-review should ask about quality approval before publishing
- Error handling should address generation failures and content policy rejections
- Triggers should poll Airtable for new brief rows

### Scenario 10: Uptime and Incident Logger
**Intent:** `"Monitor Better Stack for incidents, log them to Supabase with timestamps, and create follow-up tasks in ClickUp"`
**Credentials hit:** Better Stack PAT, Supabase Connection, ClickUp PAT
**Expected connectors:** Better Stack (green), Supabase (green), ClickUp (green)
**Key verification:**
- All connectors green — full credential coverage
- Triggers should use Better Stack webhooks
- Tasks should include incident classification and priority assignment
- Memory should track incident frequency patterns per service

---

## Scenarios 11-15: Missing Credentials (Gap Handling)

These deliberately use services without saved credentials to test gap warnings,
alternative suggestions, and "Add in Keys" navigation.

### Scenario 11: GitHub PR Reviewer
**Intent:** `"Review pull requests on GitHub, post code review comments, and create follow-up tasks in Linear"`
**Credentials hit:** Linear PAT
**Missing:** GitHub
**Expected connectors:** GitHub (red), Linear (green)
**Key verification:**
- GitHub connector shows red dot and "Add in Keys" button
- Alternatives offered: GitLab
- Build should complete despite missing credential (dimension still resolves)
- Clear warning message about needing GitHub credential

### Scenario 12: Slack Standup Bot
**Intent:** `"Run daily standups in Slack — ask team for updates, compile responses, post summary"`
**Missing:** Slack
**Expected connectors:** Slack (red)
**Key verification:**
- Slack shows red with alternatives: Discord, Teams
- Should suggest adding Slack credential in Keys module
- If user swaps to an available alternative, rebuild triggers correctly
- UX should not block the build — just warn

### Scenario 13: E-commerce Order Monitor
**Intent:** `"Monitor Shopify orders, update inventory in Airtable, and send shipping notifications via Twilio SMS"`
**Credentials hit:** Airtable PAT
**Missing:** Shopify, Twilio
**Expected connectors:** Shopify (red), Airtable (green), Twilio (red)
**Key verification:**
- Multiple red connectors — handles gracefully without error cascade
- Each missing connector has its own alternative suggestions
- Twilio alternatives: SendGrid (email instead of SMS), Built-in notifications

### Scenario 14: HubSpot Lead Scorer
**Intent:** `"Score incoming leads in HubSpot CRM based on engagement data, prioritize high-value prospects, and alert the sales team"`
**Missing:** HubSpot, Slack (for alerts)
**Expected connectors:** HubSpot (red), Slack (red)
**Key verification:**
- Both connectors missing — should suggest Attio as CRM alternative (user has it)
- Alert channel alternatives: email via Gmail, Built-in notifications
- Build should still resolve all dimensions with proposed alternatives

### Scenario 15: Jira Sprint Tracker
**Intent:** `"Track Jira sprint progress, detect overdue issues, and post daily reports to a Telegram channel"`
**Missing:** Jira, Telegram
**Credentials hit:** (none directly match)
**Expected connectors:** Jira (red), Telegram (red)
**Key verification:**
- Jira alternatives: Linear (user has it), Asana, ClickUp
- Telegram alternatives: Slack, Discord, Built-in notifications
- Connector swap UI should be exercised here — swap Jira → Linear

---

## Scenarios 16-20: Edge Cases and Complex Intents

### Scenario 16: Vague Intent
**Intent:** `"Help me be more productive"`
**Key verification:**
- CLI should ask clarifying questions before resolving ANY dimension
- Should NOT auto-resolve tasks with vague items
- Question should help narrow down: what tools do you use? what's repetitive?
- Demonstrates propose-and-confirm pattern with initial suggestions

### Scenario 17: Multi-Domain Complex Agent
**Intent:** `"Build me an agent that monitors Gmail for client invoices, extracts amounts to Airtable, creates follow-up tasks in Asana for overdue payments, and schedules reminder meetings in Google Calendar"`
**Credentials hit:** Gmail OAuth, Airtable PAT, Asana PAT, Google Calendar OAuth
**Expected connectors:** Gmail (green), Airtable (green), Asana (green), Google Calendar (green)
**Key verification:**
- 4 connectors, all green
- Tasks dimension should be comprehensive (5+ specific tasks)
- Triggers should combine polling (Gmail) + scheduled (overdue checks)
- Error handling should address partial pipeline failures
- This is the most complex scenario — tests prompt efficiency (should NOT take 8+ turns)

### Scenario 18: Single-Service Simple Agent
**Intent:** `"Log all new Notion pages with a 'project' tag to a daily summary"`
**Credentials hit:** Notion PAT
**Expected connectors:** Notion (green)
**Key verification:**
- Single connector — simplest possible agent
- Should resolve most dimensions in 1-2 turns
- Should NOT over-engineer with unnecessary connectors
- Messages should ask where to deliver the daily summary

### Scenario 19: Non-English Intent
**Intent:** `"Automatisiere meine E-Mail-Sortierung — wichtige Mails nach Notion, Termine in den Kalender"`
**Credentials hit:** Gmail OAuth, Notion PAT, Google Calendar OAuth
**Key verification:**
- CLI should understand German intent and respond in English
- Dimensions should be correctly scoped despite language barrier
- Agent name should be English (not raw German text)

### Scenario 20: Contradictory Requirements
**Intent:** `"Build a fully automated agent that requires manual approval for every single action"`
**Key verification:**
- CLI should detect the contradiction (fully automated + manual approval for everything)
- Should ask clarifying question: which actions need approval vs which are safe to automate?
- Human-review dimension should capture the nuanced approval rules
- Demonstrates the CLI's ability to push back on unclear requirements

---

## Batch Execution Script

Run all 20 scenarios sequentially with the test-automation MCP tools.
The LLM CLI runner should execute each scenario and produce a report.

### Runner Instructions

```
For each scenario (1-20):

1. SETUP: Create agent with the given intent
2. OBSERVE: Wait for build to process, take snapshots at 10s intervals
3. INTERACT: Answer any questions using reasonable choices
4. VERIFY: Check each item in the verification checklist:
   a. All 8 dimensions resolved (no cells stuck in "Analyzing")
   b. Agent name is generated (not raw intent text)
   c. Connector credentials correctly matched (green/red/amber)
   d. Questions were clear and had specific options
   e. No dimensions mixed scope (tasks=WHAT, triggers=WHEN, etc.)
   f. Build completed in ≤5 turns for simple intents, ≤8 for complex
   g. Template-based scenarios (1-5) show higher quality initial resolutions
5. RECORD: Log pass/fail for each verification item
6. CLEANUP: Delete the agent unless flagged for manual review

Report format per scenario:
  - Scenario #: [name]
  - Turns taken: N
  - Dimensions resolved: 8/8
  - Questions asked: N (list dimension + question text)
  - UX clarity: PASS/FAIL (with notes on confusing questions)
  - Connector accuracy: PASS/FAIL (credential matching correct?)
  - Name quality: PASS/FAIL (generated name vs raw intent)
  - Stuck cells: PASS/FAIL (any cells stuck in Analyzing?)
  - Template influence: YES/NO/N/A (did reference templates improve quality?)
  - Overall: PASS/FAIL
```

### Aggregate Report

After all 20 scenarios, produce a summary:

```
Total: 20 scenarios
Passed: X/20
Failed: X/20

Common issues:
- [list any patterns in failures]

UX feedback:
- [questions that were confusing across multiple scenarios]
- [dimensions that consistently had scope leaks]

Template effectiveness:
- [comparison: template-matched (1-5) vs no-template (6-20)]

Performance:
- Average turns per scenario: X
- Fastest build: Scenario X (N turns)
- Slowest build: Scenario X (N turns)
```
