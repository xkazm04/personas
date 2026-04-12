## Exploratory Smoke Test Report

**Date:** 2026-04-10
**Layer 1 status:** PASSED (34/34)
**Layer 2 status:** ISSUES_FOUND

### Findings

#### Critical (blocks release)
- None

#### Warning (fix before next release)
- **`/search-agents` automation endpoint broken**: `searchAgents()` bridge method always returns `{"success":false,"error":"Agent search input not found"}`. The `[data-testid="agent-search"]` input does not exist in the DOM on the personas page. Either the search bar was removed/relocated or the testId was changed without updating the bridge.
- **Test automation docs significantly outdated**: The `exploratory_smoke.md` references testIds and tab names that no longer exist:
  - Events tabs: `events-tab-triggers`, `events-tab-chains`, `events-tab-subscriptions` do not exist. Actual tabs: `tab-live-stream`, `tab-builder`, `tab-rate-limits`, `tab-test`, `tab-smee-relay`, `tab-cloud-webhooks`, `tab-dead-letter`, `tab-studio`, `tab-shared`
  - Home tabs: documented as `home-tab-welcome`, etc. Actual: `tab-welcome`, `tab-learning`, `tab-roadmap`, `tab-system-check`
  - Editor tabs: `editor-tab-prompt`, `editor-tab-design`, `editor-tab-health` do not exist. Working tabs: `editor-tab-activity`, `editor-tab-matrix`, `editor-tab-use-cases`, `editor-tab-lab`, `editor-tab-connectors`, `editor-tab-chat`, `editor-tab-settings`
  - Overview: `tab-reviews` does not exist

#### Observation (non-blocking, note for later)
- **Extensive duplicate agent names**: 16 agents named "Financial Stocks Signaller", 7 "Invoice Tracker", 3 "DevOps Guardian", 3 "Content Performance Reporter", and 14 other duplicated names. No uniqueness constraint on agent names.
- **One agent named "New Agent"** (id: a7a09bbe): Default/incomplete creation never renamed.
- **One disabled agent**: "Sales Deal Tracker" (id: 4cda67b8) is the only disabled agent among 70.
- **Overview sidebar badges**: Shows "41" and "99+" — potentially unclear what these numbers represent to new users.
- **Agent settings form**: 3 number inputs (at y:716 and y:798) have no testId, ariaLabel, or placeholder — not identifiable programmatically.

### Accessibility Gaps
- **Overview/Knowledge page**: ~20 action buttons (class `animate-fade-slide-in p-1`, positioned at x:1797) have no `text`, `ariaLabel`, `testId`, or `title`. Completely inaccessible to screen readers. These appear to be per-row action buttons on memory entries.
- **Home/System-Check page**: 5 buttons lack testId — "Re-run checks", "Connect to Claude Desktop", 2x "Configure", "Sign in with Google". They do have visible text so are screen-reader accessible, but untestable via automation.
- **Agent settings form**: 3 number inputs lack testId and any labeling attributes.
- **Overview/Events search input**: No testId (has placeholder "Search events by type, source, or payload..." but missing `data-testid`).
- **Overview/Knowledge search input**: No testId (has placeholder "Search memories..." but missing `data-testid`).

### TestId Coverage Gaps
- Overview/Knowledge: ~20 per-row action buttons fully unlabeled (no testId, no ariaLabel, no title, no text)
- Overview/Events search: input without testId
- Overview/Knowledge search: input without testId
- Home/System-Check: 5 action buttons without testId
- Agent settings: 3 number inputs without testId
- Events/Live Stream: "Full Event Log" and "Pause" buttons without testId
- Credential page: action buttons (Rotate, Test All) without testId

### Performance Notes
- Avg navigation latency: 71ms
- Slowest endpoint: `/snapshot` at 298ms (first call), subsequent calls ~50ms
- Fastest endpoint: `/list-credentials` and `/find-text` at 46ms
- `/state` endpoint: avg 53ms across 10 sequential calls
- Sequential latency check (10x `/state`): 46, 68, 54, 53, 186, 50, 51, 48, 179, 47ms
- Memory leak signals: **No** — no upward trend in sequential calls, spikes are network jitter
- Rapid 5-section navigation: completed in 259ms with no errors

### Cross-Module Consistency
- Agent count: 70 in state API, consistent across navigation
- Credential count: 19 via `/list-credentials` API, "19 credentials stored" in UI, "19" in sidebar badge — consistent
- Sidebar badges update correctly when navigating between sections
- Double-click on sidebar buttons: no errors, no duplicate state transitions
- Navigation always lands on correct final route (verified after rapid nav sequence)

### Edge Case Results
- **Special character search**: Could not test (agent-search input not in DOM)
- **Rapid concurrent navigation**: 5 sections in 259ms — no race conditions, correct final route, no errors
- **Double-click sidebar**: Clean — no errors, no modals, no duplicate state changes
- **Search then navigate**: Could not test search reset (no search input available)

### Modules Explored
- [x] Home (tabs: welcome, learning, roadmap, system-check)
- [x] Overview (tabs: home, executions, messages, events, knowledge)
- [x] Agents (list, editor tabs: activity, matrix, use-cases, lab, connectors, chat, settings)
- [x] Events (tabs: live-stream, builder, rate-limits, test, smee-relay, cloud-webhooks, dead-letter, studio, shared)
- [x] Credentials (list, search)
- [x] Templates (search)
- [x] Settings (appearance, notifications, portability)
