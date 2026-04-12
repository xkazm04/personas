# Exploratory Smoke Test — LLM-Driven (Layer 2)

You are running an **intelligent exploratory smoke test** against the Personas Desktop app.
The deterministic Layer 1 (`pre_release_smoke.py`) already passed — all modules render and basic CRUD works.
Your job is to go deeper: find things a script can't catch.

## How to interact with the app

The test automation HTTP server runs at `http://127.0.0.1:17320`. Use `curl` in Bash for all interactions.

### Core endpoints

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `{"status":"ok"}` |
| GET | `/state` | — | Full app state (personas, route, sidebar) |
| GET | `/snapshot` | — | Semantic view: route, modals, toasts, errors, forms |
| POST | `/navigate` | `{"section":"home"}` | Navigate sidebar section |
| POST | `/click-testid` | `{"test_id":"..."}` | Click element by data-testid |
| POST | `/fill-field` | `{"test_id":"...","value":"..."}` | Fill input by data-testid |
| POST | `/query` | `{"selector":"..."}` | Query DOM elements |
| POST | `/find-text` | `{"text":"..."}` | Find elements by visible text |
| GET | `/list-interactive` | — | All visible buttons/inputs with testIds |
| POST | `/select-agent` | `{"name_or_id":"..."}` | Open agent editor |
| POST | `/search-agents` | `{"query":"..."}` | Filter agent list |
| POST | `/open-settings-tab` | `{"tab":"..."}` | Navigate settings |
| GET | `/list-credentials` | — | All credentials |
| POST | `/eval` | `{"js":"..."}` | Run JS in webview |

### Sections for `/navigate`
`home`, `overview`, `personas`, `events`, `credentials`, `design-reviews`, `settings`

### Key data-testid selectors
See `docs/guide-test-automation.md` for the full reference. Key ones:
- Sidebar: `sidebar-home`, `sidebar-overview`, `sidebar-personas`, etc.
- Editor tabs: `editor-tab-use-cases`, `editor-tab-prompt`, `editor-tab-lab`, etc.
- Overview tabs: `tab-home`, `tab-executions`, `tab-messages`, `tab-events`, etc.
- Events tabs: `events-tab-triggers`, `events-tab-chains`, `events-tab-subscriptions`

## Your exploration checklist

Work through these areas. For each, use the endpoints above to inspect the app state and look for issues. **Think like a QA tester on a fresh install.**

### 1. Data Quality Audit
Navigate to each module and check the data makes sense:
- Do agent names look reasonable? Any empty names or corrupted data?
- Are credential counts consistent between the list endpoint and the UI?
- Do execution counts in overview match what you'd expect?
- Any orphaned data (agents with no prompts, credentials with no connector)?

### 2. Error Surface Scan
Visit every module and sub-tab. For each, take a `snapshot()` and examine:
- Any `errors` array entries? (These are React error boundaries)
- Any error toasts?
- Any modals stuck open?
- Any forms in invalid state?

### 3. Interactive Element Audit
On 3-4 key pages (home, personas, credentials, overview), call `/list-interactive` and check:
- Do all buttons have either `text`, `ariaLabel`, or `title`? (Accessibility)
- Are there disabled buttons that shouldn't be? Or enabled buttons that should be disabled?
- Are there interactive elements with no `testId`? (Test coverage gap)

### 4. Cross-Module Consistency
- Navigate to agents, pick one, note its name
- Navigate to overview/executions — does it show executions for that agent?
- Navigate to credentials — are the counts consistent with what agents reference?
- Do sidebar badges/counts update correctly when navigating between sections?

### 5. Edge Case Probing
Try things a user might accidentally do:
- Search for an agent with special characters (emoji, quotes, backslash)
- Navigate rapidly between 5 sections (check for race conditions in the snapshot)
- Click the same button twice quickly
- Search then immediately navigate away — does the search state reset?

### 6. Timing & Performance
Note response times for each endpoint call. Flag anything that:
- Takes >2 seconds for a navigation
- Takes >5 seconds for a state query
- Shows increasing latency across sequential calls (memory leak signal)

## Output format

After completing your exploration, produce a structured report in this exact format:

```
## Exploratory Smoke Test Report

**Date:** {today}
**Layer 1 status:** PASSED (34/34)
**Layer 2 status:** {PASS | ISSUES_FOUND}

### Findings

#### Critical (blocks release)
- {finding or "None"}

#### Warning (fix before next release)
- {finding or "None"}

#### Observation (non-blocking, note for later)
- {finding or "None"}

### Accessibility Gaps
- {elements without labels, or "None found"}

### TestId Coverage Gaps
- {interactive elements without data-testid, or "Coverage adequate"}

### Performance Notes
- Avg navigation latency: {N}ms
- Slowest endpoint: {endpoint} at {N}ms
- Memory leak signals: {yes/no}

### Modules Explored
- [ ] Home (tabs: welcome, learning, roadmap, system-check)
- [ ] Overview (tabs: home, executions, reviews, messages, events, knowledge)
- [ ] Agents (list, editor tabs, search)
- [ ] Events (triggers, chains, subscriptions)
- [ ] Credentials (list, search)
- [ ] Templates
- [ ] Settings (appearance, notifications, portability)
```

Write this report to `tools/test-mcp/reports/exploratory-{date}.md`.

## Rules
- Do NOT modify the app state destructively (don't delete existing agents or credentials)
- You MAY create a temporary test agent if needed — delete it before finishing
- Always check `/snapshot` after navigation to verify no errors
- If an endpoint fails, note it and move on — don't get stuck retrying
- Be concise in findings. "Overview/messages tab shows 0 messages" is NOT a finding — it's expected for a dev environment. Only flag actual inconsistencies or errors.
