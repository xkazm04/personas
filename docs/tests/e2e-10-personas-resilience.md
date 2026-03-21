# E2E Resilience Test: 10 Personas × Full Dimension Coverage

Comprehensive cross-module integration test validating persona generation, testing, and execution across diverse tool combinations, connector types, and protocol message patterns.

## Goal

Verify the full persona lifecycle works end-to-end for 10 different personas, each exercising a unique combination of:
- **Tools**: web_search, web_fetch, http_request, file_read, file_write, gmail_*, MCP tools
- **Built-in connectors**: personas_database, personas_vector_db, personas_messages
- **Protocol messages**: user_message (→ Messages), agent_memory (→ Knowledge), manual_review (→ Manual Review)
- **Execution dimensions**: triggers, error handling, human review policies, memory persistence

## Prerequisites

```bash
npx tauri dev --features test-automation
# Wait for: curl http://127.0.0.1:17320/health → 200
```

DB path: `%APPDATA%/com.personas.desktop/personas.db`

---

## The 10 Personas

| # | Name | Primary Tools | Key Dimensions | Expected Protocol Messages |
|---|------|--------------|----------------|---------------------------|
| 1 | **Daily Tech Digest** | web_search, web_fetch | messaging, memory | user_message (digest output) |
| 2 | **Code Review Assistant** | file_read, file_write | human_review, memory | manual_review (approval gate), agent_memory |
| 3 | **API Health Monitor** | http_request | error_handling, events | user_message (alerts), agent_memory (history) |
| 4 | **Research Paper Summarizer** | web_search, web_fetch, file_write | memory, messaging | user_message (summary), agent_memory (papers read) |
| 5 | **Meeting Notes Organizer** | file_read, file_write | memory, database | agent_memory (action items), user_message (summary) |
| 6 | **Competitor Price Tracker** | web_search, http_request | database, error_handling | user_message (price alerts), agent_memory (price history) |
| 7 | **Documentation Freshness Checker** | web_fetch, file_read | human_review, messaging | manual_review (stale docs), user_message (report) |
| 8 | **Social Media Trend Analyzer** | web_search | memory, messaging | user_message (trend report), agent_memory (tracked topics) |
| 9 | **Security Vulnerability Scanner** | web_search, http_request | human_review, error_handling | manual_review (critical vulns), user_message (scan report) |
| 10 | **Personal Learning Journal** | web_search, file_write | memory, database | agent_memory (learnings), user_message (weekly digest) |

---

## Test Phases Per Persona

Each persona goes through 5 phases. All phases must pass before proceeding to the next persona.

### Phase A: Generation (PersonaMatrix Build)

**Steps:**
```
1. POST /start-create-agent
2. POST /fill-field  {"test_id": "agent-intent-input", "value": "<persona intent>"}
3. POST /click-testid {"test_id": "agent-launch-btn"}
4. Poll state() until buildPhase == "awaiting_input" or "draft_ready"
5. If awaiting_input: answer question via answer-button → freetext → submit → continue-build
6. Poll until buildPhase == "draft_ready" and all 8 cells resolved
7. POST /promote-build (applies structured_prompt + tools + design_context to persona)
```

**Technical Checks:**
- [ ] All 8 dimensions resolved (use-cases, connectors, triggers, messages, human-review, memory, error-handling, events)
- [ ] `structured_prompt` has all 5 sections (identity, instructions, toolGuidance, examples, errorHandling)
- [ ] `system_prompt` is non-empty and relevant
- [ ] `design_context.use_cases` populated as DesignUseCase[] (not raw strings)
- [ ] Tools assigned match persona intent (verify in `persona_tools` junction table)

**Business Checks:**
- [ ] Persona name is relevant and professional
- [ ] Description accurately reflects the intent
- [ ] Use cases are actionable and specific (not vague)
- [ ] Error handling strategies match the persona's risk profile

### Phase B: Lab Arena Test (Model Comparison)

**Steps:**
```
1. POST /select-agent {"name_or_id": "<persona-name>"}
2. POST /open-editor-tab {"tab": "lab"}
3. POST /click-testid {"test_id": "lab-mode-arena"}
4. POST /click-testid {"test_id": "arena-run-btn"}
5. Monitor via DB: SELECT status FROM lab_arena_runs WHERE persona_id=? ORDER BY created_at DESC LIMIT 1
6. Wait for status = "completed"
```

**Technical Checks:**
- [ ] Run completes (status = "completed", not "failed")
- [ ] Result count matches scenarios × models (typically 5 × 2 = 10)
- [ ] All results have `rationale IS NOT NULL` (structured JSON)
- [ ] `llm_summary` populated on run record (or null if CLI unavailable — not a failure)
- [ ] Scores are in valid range 0-100 for all three metrics

**Business Checks:**
- [ ] Scenarios generated are realistic for the persona's use case
- [ ] Tool accuracy reflects whether the persona calls the right tools
- [ ] Output quality reflects whether the content is useful
- [ ] Protocol compliance reflects whether instructions are followed
- [ ] Winner model determination makes sense for the use case

### Phase C: Matrix Improvement (Prompt Refinement)

**Steps:**
```
1. POST /click-testid {"test_id": "lab-mode-matrix"}
2. POST /fill-field {"test_id": "matrix-instruction", "value": "<improvement instruction>"}
3. POST /click-testid {"test_id": "matrix-run-btn"}
4. Monitor via DB until status = "completed"
5. Open result modal, accept draft
```

**Technical Checks:**
- [ ] Draft prompt generated (draft_prompt_json IS NOT NULL)
- [ ] Change summary describes specific modifications
- [ ] Draft accepted → persona.structured_prompt updated
- [ ] Version v2 created in persona_prompt_versions

**Business Checks:**
- [ ] Draft addresses the improvement instruction
- [ ] Draft preserves existing strengths (doesn't regress)
- [ ] Change summary is actionable and clear

### Phase D: Manual Execution

**Steps:**
```
1. POST /execute-persona {"name_or_id": "<persona-name>"}
2. Monitor via DB: SELECT status FROM persona_executions WHERE persona_id=? ORDER BY created_at DESC LIMIT 1
3. Wait for status = "completed"
```

**Technical Checks:**
- [ ] Execution completes (status = "completed")
- [ ] `output_data` IS NOT NULL and contains relevant content
- [ ] `tool_steps` shows expected tool usage (web_search, http_request, etc.)
- [ ] `cost_usd` > 0 (proves LLM was invoked)
- [ ] `duration_ms` is reasonable (not 0, not > 300000)
- [ ] `started_at` is today's date

**Business Checks:**
- [ ] Output addresses the persona's primary use case
- [ ] Content is factual and relevant (not hallucinated)
- [ ] Format matches persona instructions (bullet points, structured report, etc.)

### Phase E: Dimension Verification (Messages, Memory, Events)

**Steps:**
```sql
-- Check messages were delivered
SELECT COUNT(*) FROM persona_messages WHERE persona_id = '<id>' AND execution_id = '<exec-id>';
-- Should be >= 1

-- Check memory items were created (if persona has memory dimension)
SELECT COUNT(*) FROM persona_memories WHERE persona_id = '<id>';
-- May be 0 if agent didn't emit agent_memory protocol messages

-- Check execution appears in Overview
POST /navigate {"section": "overview"}
POST /click-testid {"test_id": "tab-executions"}
POST /find-text {"text": "<persona-name>"}
-- Should find >= 1 visible element

-- Check messages appear in Overview
POST /click-testid {"test_id": "tab-messages"}
POST /find-text {"text": "Execution output"}
-- Should find >= 1 visible element
```

**Technical Checks:**
- [ ] `persona_messages` record created with execution_id
- [ ] Message content matches `output_data` from execution
- [ ] Message visible in Overview → Messages tab
- [ ] Execution visible in Overview → Executions tab
- [ ] Execution date is today

**Business Checks:**
- [ ] Message title is descriptive ("Execution output — date")
- [ ] Message content is the full persona output (not truncated unexpectedly)
- [ ] Results are discoverable by navigating the Overview module

---

## Persona-Specific Configurations

### Persona 1: Daily Tech Digest
```
Intent: "Research latest tech news from major sources and create a daily digest with the 5 most impactful stories"
Free-text answer: "Focus on AI, cloud computing, and cybersecurity news"
Matrix improvement: "Add more structure with categories and impact ratings per story"
Expected tools: web_search
Expected protocol: user_message (digest output)
Expected output: Formatted digest with 5 stories, headlines, and brief summaries
```

### Persona 2: Code Review Assistant
```
Intent: "Review code changes, identify potential bugs, security issues, and suggest improvements"
Free-text answer: "Focus on TypeScript and Python code, emphasize security best practices"
Matrix improvement: "Add severity ratings and actionable fix suggestions for each finding"
Expected tools: file_read, file_write
Expected protocol: manual_review (for critical issues), agent_memory (patterns learned)
Expected output: Structured review with findings, severity, and recommendations
```

### Persona 3: API Health Monitor
```
Intent: "Monitor REST API endpoints for uptime, response time, and error rates, alerting on anomalies"
Free-text answer: "Monitor internal APIs at localhost endpoints for development testing"
Matrix improvement: "Add response time thresholds and escalation rules for different severity levels"
Expected tools: http_request
Expected protocol: user_message (alerts), agent_memory (baseline metrics)
Expected output: Health status report with endpoint statuses and any alerts
```

### Persona 4: Research Paper Summarizer
```
Intent: "Find and summarize recent academic papers on a given topic, extracting key findings and methodology"
Free-text answer: "Focus on machine learning and NLP papers from arxiv and major conferences"
Matrix improvement: "Add citation analysis and relevance scoring for each paper"
Expected tools: web_search, web_fetch, file_write
Expected protocol: user_message (summary report), agent_memory (papers indexed)
Expected output: Structured summary with paper titles, authors, key findings, methodology
```

### Persona 5: Meeting Notes Organizer
```
Intent: "Process meeting transcripts, extract action items, decisions, and organize by topic and assignee"
Free-text answer: "Handle engineering standup and planning meeting formats"
Matrix improvement: "Add deadline extraction and automatic priority assignment for action items"
Expected tools: file_read, file_write
Expected protocol: agent_memory (action items), user_message (organized summary)
Expected output: Organized meeting notes with action items, decisions, and follow-ups
```

### Persona 6: Competitor Price Tracker
```
Intent: "Monitor competitor pricing on key products and alert on significant changes or new offerings"
Free-text answer: "Track SaaS pricing pages for cloud infrastructure competitors"
Matrix improvement: "Add trend analysis showing price changes over time with percentage calculations"
Expected tools: web_search, http_request
Expected protocol: user_message (price alerts), agent_memory (price history)
Expected output: Price comparison table with current prices, changes, and trend indicators
```

### Persona 7: Documentation Freshness Checker
```
Intent: "Audit documentation for staleness by checking last-updated dates, broken links, and outdated references"
Free-text answer: "Check our internal docs site and README files in repositories"
Matrix improvement: "Add recommendations for which docs to update first based on traffic and staleness"
Expected tools: web_fetch, file_read
Expected protocol: manual_review (stale docs requiring update), user_message (audit report)
Expected output: Staleness report with doc names, last-updated dates, and priority recommendations
```

### Persona 8: Social Media Trend Analyzer
```
Intent: "Analyze trending topics on tech social media and identify emerging discussions relevant to our industry"
Free-text answer: "Focus on X/Twitter, Hacker News, and Reddit tech communities"
Matrix improvement: "Add sentiment analysis and topic clustering to identify positive vs negative trends"
Expected tools: web_search
Expected protocol: user_message (trend report), agent_memory (tracked topics)
Expected output: Trend analysis with top topics, sentiment indicators, and source links
```

### Persona 9: Security Vulnerability Scanner
```
Intent: "Scan for known security vulnerabilities in specified software dependencies and report findings"
Free-text answer: "Check npm and Python package vulnerabilities from NVD and GitHub advisories"
Matrix improvement: "Add CVSS scoring and remediation steps for each vulnerability found"
Expected tools: web_search, http_request
Expected protocol: manual_review (critical vulns requiring action), user_message (full scan report)
Expected output: Vulnerability report with CVE IDs, severity, affected versions, and fix recommendations
```

### Persona 10: Personal Learning Journal
```
Intent: "Research a daily learning topic, create a structured study note, and track learning progress over time"
Free-text answer: "Focus on distributed systems and database internals as learning topics"
Matrix improvement: "Add spaced repetition cues and connect new learnings to previous entries"
Expected tools: web_search, file_write
Expected protocol: agent_memory (learnings stored), user_message (weekly digest of topics studied)
Expected output: Structured study note with key concepts, examples, and connections to prior knowledge
```

---

## Scoring & Pass Criteria

### Per-Persona Score Card (25 checks)
- Phase A: 5 technical + 4 business = 9 checks
- Phase B: 5 technical + 5 business = 10 checks
- Phase C: 4 technical + 3 business = 7 checks (skipped for personas with simple prompts)
- Phase D: 6 technical + 3 business = 9 checks
- Phase E: 5 technical + 3 business = 8 checks

### Overall Pass Criteria
- **All 10 personas**: Phase A (generation) must pass 100%
- **All 10 personas**: Phase D (execution) must pass 100%
- **All 10 personas**: Phase E (messages visible) must pass 100%
- **8 of 10 personas**: Phase B (arena) must complete
- **5 of 10 personas**: Phase C (matrix improvement) must complete
- **Total**: >= 80% of all checks across all personas

### Failure Categories
- **BLOCKER**: Prevents the persona from being created or executed (Phase A/D failure)
- **CRITICAL**: Data loss — output not saved, messages not delivered, memory not persisted
- **MAJOR**: Business quality — persona produces irrelevant or empty output
- **MINOR**: UI/cosmetic — score display issues, missing labels, formatting

---

## Execution Strategy

### Sequence
Run personas sequentially (1 through 10). Each persona completes all 5 phases before the next begins. This ensures:
- No resource contention (CLI processes, API rate limits)
- Clear failure attribution (which persona, which phase)
- Bridge can be restarted between personas if frozen

### Estimated Duration
- Phase A: ~2-3 min per persona (build + promote)
- Phase B: ~5-8 min per persona (arena + monitoring)
- Phase C: ~5-10 min per persona (matrix + accept)
- Phase D: ~1-3 min per persona (execution)
- Phase E: ~1 min per persona (verification)
- **Per persona**: ~15-25 min
- **Total 10 personas**: ~2.5-4 hours

### Bridge Reliability
- Kill + restart `personas-desktop.exe` between personas if bridge is unresponsive
- Use DB polling (not bridge) for monitoring long-running operations
- Use `/promote-build` endpoint (not eval) for build promotion
- Use `/execute-persona` endpoint for execution
- Allow 25s timeout on bridge calls (`__exec__` has Promise.race protection)

### Cleanup Between Personas
```sql
-- No cleanup needed between personas (each gets its own ID)
-- Cleanup at end if desired:
DELETE FROM personas WHERE name IN ('Daily Tech Digest', 'Code Review Assistant', ...);
```

---

## Automation Script Location

```
tools/test-mcp/e2e_10_personas_resilience.py
```

The script should:
1. Accept `--persona N` flag to run a single persona (for debugging)
2. Accept `--phase X` flag to run a single phase (A/B/C/D/E)
3. Output JSON results to `docs/tests/results/resilience-<timestamp>.json`
4. Print a summary score card at the end
5. Handle bridge restarts automatically between personas

---

## Key Code Paths Exercised

| System | Files | What's Tested |
|--------|-------|---------------|
| Build Session | `engine/build_session.rs`, `commands/design/build_sessions.rs` | Multi-turn CLI, dimension resolution, agent_ir extraction |
| Promote | `commands/design/build_sessions.rs:promote_build_draft` | Prompt application, tool creation, design context |
| Lab Arena | `engine/test_runner.rs:run_lab_loop` | Scenario generation, multi-model execution, LLM eval |
| Lab Matrix | `engine/test_runner.rs:run_matrix_test` | Draft generation, current vs draft comparison |
| Execution | `engine/runner.rs:run_persona_execution` | CLI spawn, stdout parsing, output capture |
| Messages | `engine/runner.rs` (persona_messages INSERT) | Output → message delivery |
| Protocol | `engine/parser.rs:extract_protocol_message` | user_message, agent_memory, manual_review parsing |
| Eval | `engine/eval.rs:eval_with_llm` | Structured rationale, per-metric scoring |
| Overview | `features/overview/` | Execution list, message list, event log |

---

## Known Barriers & Workarounds

| Barrier | Workaround | Fixed In |
|---------|-----------|----------|
| Build promote doesn't apply prompt | Use `/promote-build` bridge endpoint | bridge.ts |
| Bridge freezes on rapid clicks | 25s timeout in `__exec__`, DB polling | bridge.ts |
| Execution fails with stderr error | Graceful None stderr handling | runner.rs |
| Output not saved to DB | `ExecutionResult.output = Some(assistant_text)` | runner.rs |
| No messages created | Auto-create persona_messages on success | runner.rs |
| Infinite toast cascade | Toast dedup 5s cooldown, Smee 60s interval | storeTypes.ts, smee_relay.rs |
| Use cases stored as strings | Auto-normalize string[] → DesignUseCase[] | UseCasesList.tsx |
| ImprovePrompt empty models | Default to haiku+sonnet | ImprovePromptButton.tsx |
