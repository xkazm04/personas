use super::cli_runner::truncate_utf8;
use crate::engine::platform_rules;

/// Wraps a persona-generation prompt with section-delimited output instructions.
pub fn wrap_prompt_with_sections(base_prompt: &str) -> String {
    format!(
        r#"IMPORTANT OUTPUT FORMAT — SECTION-BY-SECTION STREAMING:

Do NOT output a single monolithic JSON object. Instead, emit each section of the persona
separately, using section delimiters. Output sections in this EXACT order:

1. ---SECTION:identity---
   A JSON object with: name, description, icon, color, model_profile, max_budget_usd, max_turns

2. ---SECTION:prompt---
   A JSON object with: system_prompt, structured_prompt

3. For EACH tool, output a separate section:
   ---SECTION:tool---
   A JSON object with: name, category, description, requires_credential_type, input_schema, implementation_guide

4. For EACH trigger, output a separate section:
   ---SECTION:trigger---
   A JSON object with: trigger_type, config, description, use_case_id

5. For EACH connector, output a separate section:
   ---SECTION:connector---
   A JSON object with: name, n8n_credential_type, has_credential

6. ---SECTION:design_context---
   A JSON object with: summary, use_cases (array)

7. ---SECTION:end---

CRITICAL RULES:
- Each delimiter MUST be on its own line (e.g., ---SECTION:tool---)
- Each JSON block must be valid, self-contained JSON
- Do NOT wrap anything in an outer object or "persona" key
- Do NOT use markdown code fences around the JSON
- Output sections in the EXACT order listed above
- One ---SECTION:tool--- per tool, one ---SECTION:trigger--- per trigger, etc.
- After the last section, output ---SECTION:end--- and stop

Now proceed with the transformation task described below. Remember: use section delimiters.

---

{base_prompt}"#
    )
}

/// Format the optional connectors JSON into a prompt section.
fn format_connector_section(connectors_json: Option<&str>) -> String {
    connectors_json
        .filter(|c| !c.trim().is_empty() && c.trim() != "[]")
        .map(|c| format!("\n## User's Available Connectors\n{}\n", c))
        .unwrap_or_default()
}

/// Format the optional credentials JSON into a prompt section.
fn format_credential_section(credentials_json: Option<&str>) -> String {
    credentials_json
        .filter(|c| !c.trim().is_empty() && c.trim() != "[]")
        .map(|c| format!("\n## User's Available Credentials\n{}\n", c))
        .unwrap_or_default()
}

// ── Shared prompt builder functions ────────────────────────────────

/// Rules for adapting tools to the user's actual credentials.
fn build_credential_adaptation_rules() -> &'static str {
    r#"IMPORTANT — Adapt tools to the user's ACTUAL credentials:
1. Check "User's Available Credentials" below. If the user has a credential with
   service_type matching a connector (e.g., service_type "google"), set has_credential=true
   on that connector and generate tools that use it.
2. One OAuth credential covers ALL APIs for that provider. A single "google" credential
   gives access to Gmail API, Sheets API, Calendar API, Drive API, etc.
3. Set requires_credential_type on each tool to the CONNECTOR name (e.g., "google"),
   NOT the n8n credential type (e.g., NOT "gmailOAuth2").
4. In implementation_guide, use the connector's env var pattern: ${GOOGLE_ACCESS_TOKEN},
   ${SLACK_BOT_TOKEN}, etc.
5. Do NOT create multiple connectors for the same provider. One "google" connector serves
   all Google API tools."#
}

/// Persona protocol system documentation (user_message, agent_memory, manual_review, events).
fn build_protocol_docs() -> &'static str {
    r#"## Persona Protocol System (CRITICAL — use these in the system prompt)

During execution, the persona can output special JSON protocol messages to communicate
with the user, persist knowledge, and request human approval. You MUST weave these into
the system_prompt and structured_prompt instructions wherever the n8n workflow involves
human interaction, data storage, notifications, or approval gates.

### Protocol 1: User Messages (notify the user)
Output this JSON on its own line to send a message to the user:
{"user_message": {"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}

Use for: status updates, summaries, alerts, draft previews, completion reports.
Maps from n8n: "Send Email" notification nodes, Slack/Telegram notification nodes,
"Set" nodes that store status for display, any node whose purpose is to inform the user.

### Protocol 2: Agent Memory (ACTIVE business knowledge — improves every run)
Output this JSON on its own line to save a memory:
{"agent_memory": {"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}

CRITICAL: Memory is the persona's competitive advantage. Each execution should
make the persona smarter at its business domain. Memory must be ACTIVE (consulted
before decisions) and PROGRESSIVE (each run builds on previous knowledge).

Use for:
- Business pattern recognition: "Invoices from Vendor X always arrive on Fridays"
- Decision optimization: "Batch processing at 2 AM reduces API rate limit issues"
- Stakeholder preferences: "CFO prefers summary tables over charts in reports"
- Process improvements: "Adding order confirmation step reduced support tickets 40%"
- Domain knowledge: "Q4 has 3x email volume — adjust batch sizes accordingly"

Maps from n8n: "Set" variable nodes that store state, data extraction results,
classification outputs, any node that captures information for reuse.

Memory categories:
- "fact": Business facts extracted from data (e.g., "Client X prefers morning meetings", "Average order value is $450")
- "preference": Stakeholder and system preferences (e.g., "Marketing team wants Slack over email for alerts")
- "instruction": Learned procedures and rules (e.g., "Always CC legal on contract emails above $10k")
- "context": Ongoing business situations (e.g., "Q4 budget freeze — hold non-critical purchases")
- "learned": Patterns and optimizations discovered through operation (e.g., "Gmail API rate limit hit at 100/min — use 80/min with exponential backoff")

IMPORTANT: In the system_prompt, instruct the persona to:
1. CHECK memories BEFORE making decisions — look for relevant past experience
2. STORE business outcomes, not just technical errors
3. TRACK what approaches worked and what failed for the specific domain
4. BUILD progressive expertise — each run should reference and extend prior knowledge

### Protocol 3: Manual Review (human-in-the-loop approval gate)
Output this JSON on its own line to request human approval:
{"manual_review": {"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}

Use for: draft review before sending, data deletion confirmation, high-stakes decisions,
content that needs human judgment before acting on it.
Maps from n8n: "Wait" nodes, "Approval" nodes, "IF" decision nodes where human judgment
is needed, any workflow step that pauses for confirmation.

IMPORTANT: When the n8n workflow sends emails, posts messages, modifies data, or performs
any action with external consequences, the persona should draft the action first and
request manual_review BEFORE executing it. This is the human-in-the-loop pattern.

### Protocol 4: Events (inter-persona communication)
Output this JSON to trigger other personas or emit custom events:
{"emit_event": {"type": "event_name", "data": {}}}

Use for: multi-agent coordination, triggering downstream workflows.
Maps from n8n: Webhook output nodes, "Execute Workflow" nodes, any node that chains
to other workflows."#
}

/// n8n → Persona pattern mapping rules.
fn build_pattern_mapping() -> &'static str {
    r#"## n8n → Persona Pattern Mapping

Apply these patterns when analyzing the n8n workflow:

1. HUMAN-IN-THE-LOOP: If the workflow sends emails, posts to Slack, modifies databases,
   or performs any externally-visible action → add manual_review before the action.
   The instructions should say: "Draft the action, send it as a user_message for preview,
   then create a manual_review. Only proceed with the action after approval."

2. KNOWLEDGE EXTRACTION: If the workflow processes data (emails, documents, API responses)
   → add agent_memory instructions to extract and store BUSINESS-RELEVANT information.
   Example: "After processing each email, evaluate if it contains key decisions,
   commitments, deadlines, or business context. Store as agent_memory with category
   'fact' or 'context' and importance based on business impact."

3. PROGRESSIVE LEARNING: If the workflow handles recurring tasks → add instructions for
   the persona to ACTIVELY check its memories before acting and to store new patterns.
   Example: "Before categorizing emails, review your memories for learned patterns about
   this sender and their typical priorities. After processing, store any new business
   patterns, preferences, or optimizations discovered as memories with category 'learned'."

   The memory strategy MUST create a feedback loop:
   a. CHECK: Query existing memories for relevant context before each decision
   b. ACT: Use memory-informed context to make better decisions
   c. LEARN: After each action, store outcomes and new patterns
   d. IMPROVE: Track which approaches worked — prefer proven strategies

4. NOTIFICATIONS: If the workflow has notification/alert nodes → map them to user_message
   protocol with appropriate priority levels.

5. ERROR ESCALATION: If the workflow has error handling → map critical errors to
   user_message with priority "critical" and non-critical to standard error handling.

Composition philosophy:
1. Preserve business intent and end-to-end flow from n8n.
2. Produce robust prompt architecture (identity, instructions, toolGuidance, examples, errorHandling, customSections).
3. Keep instructions deterministic, testable, and failure-aware.
4. Prefer explicit capability boundaries and clear operational behavior.
5. Ensure output is directly usable for saving a Persona in the app.
6. Do NOT assume auto-save. The user will confirm before persistence.
7. Absorb ALL n8n LLM/AI nodes into the persona prompt. Do NOT create tools for LLM calls.
8. Create tools only for external API interactions (email, HTTP, database, file, etc.)
9. Create triggers based on n8n trigger/schedule nodes.
10. Embed protocol message instructions (user_message, agent_memory, manual_review) in the
    system_prompt and structured_prompt wherever the workflow involves human interaction,
    knowledge persistence, or approval gates.
11. Add a "Human-in-the-Loop" customSection when the workflow performs externally-visible actions.
12. ALWAYS add a "Memory Strategy" customSection that describes:
    a. What business knowledge to capture (domain facts, stakeholder preferences, process outcomes)
    b. When to consult memories (before decisions, before external actions, when patterns repeat)
    c. How memories improve over time (progressive refinement, outcome tracking, optimization)
    Example: "Before drafting emails, check memories for recipient preferences and past interaction patterns. After sending, store the outcome and any feedback received.""#
}

/// JSON output schema for persona generation, including all field notes.
fn build_output_schema() -> &'static str {
    r##"Return ONLY valid JSON (no markdown fences, no commentary), with this exact shape:
{
  "persona": {
    "name": "string",
    "description": "string",
    "system_prompt": "string — must include protocol message instructions for human-in-the-loop and memory",
    "structured_prompt": {
      "identity": "string",
      "instructions": "string — core workflow logic with protocol messages woven in",
      "toolGuidance": "string — how to use each tool, including when to request manual_review before tool calls",
      "examples": "string — include examples of protocol message usage for this specific workflow",
      "errorHandling": "string — include user_message notifications for critical errors",
      "webSearch": "string — research guidance for web-enabled runs (empty string if not applicable)",
      "customSections": [
        { "title": "string", "content": "string" }
      ]
    },
    "icon": "Sparkles",
    "color": "#8b5cf6",
    "model_profile": null,
    "max_budget_usd": null,
    "max_turns": null,
    "design_context": "JSON string — see design_context instructions below",
    "triggers": [{
      "trigger_type": "schedule|polling|webhook|manual",
      "config": { },
      "description": "string",
      "use_case_id": "string — the id of the use case this trigger serves (from design_context use_cases[].id), or null"
    }],
    "tools": [{
      "name": "tool_name_snake_case",
      "category": "email|http|database|file|messaging|other",
      "description": "What this tool does",
      "requires_credential_type": "connector_name_or_null",
      "input_schema": null,
      "implementation_guide": "Step-by-step API call instructions — see implementation_guide rules below"
    }],
    "required_connectors": [{
      "name": "connector_name",
      "n8n_credential_type": "original_n8n_type",
      "has_credential": false
    }]
  }
}

Note on triggers: Array may be empty if workflow has no trigger nodes.
Note on tools: Only include tools for external API calls. Do NOT include LLM/AI tools.
Note on required_connectors: List all external service credentials needed. Set has_credential=true only if the user's available credentials include a matching service.
Note on customSections: ALWAYS include a "human_in_the_loop" section if the workflow performs externally-visible actions (sends emails, posts messages, modifies data). ALWAYS include a "memory_strategy" section if the workflow processes data that could inform future runs. These are critical for the persona to operate safely and improve over time.
Note on implementation_guide: CRITICAL — for EVERY tool, you MUST generate a detailed implementation_guide string. Without it, the execution agent has NO WAY to know which API to call and will fail. Include:
1. The exact API endpoint URL (e.g., https://www.googleapis.com/gmail/v1/users/me/messages)
2. HTTP method (GET, POST, PUT, DELETE)
3. Authentication header using credential env var pattern: $CONNECTOR_NAME_UPPER_FIELD_UPPER (e.g., -H "Authorization: Bearer $GOOGLE_ACCESS_TOKEN")
4. Query parameters or request body format, mapping from input_schema fields to API parameters
5. A complete curl example that can be copied and run in a shell
6. Expected response JSON format summary
Example for a Gmail list tool:
"implementation_guide": "API: GET https://www.googleapis.com/gmail/v1/users/me/messages\nAuth: -H 'Authorization: Bearer $GOOGLE_ACCESS_TOKEN'\nParams: maxResults=${limit}, q=${query}\nCurl: curl -s -H 'Authorization: Bearer $GOOGLE_ACCESS_TOKEN' 'https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=10'\nResponse: {\"messages\": [{\"id\": \"...\", \"threadId\": \"...\"}], \"resultSizeEstimate\": 10}"
Note on design_context: The value MUST be a valid JSON string (escaped within the outer JSON) with this structure:
{"summary":"Brief 1-2 sentence overview of what this persona does","use_cases":[{"id":"uc1","title":"Short use case title","description":"1-2 sentence description of what this use case does","category":"notification|data-sync|monitoring|automation|communication|reporting","execution_mode":"e2e|mock|non_executable","sample_input":{"mode":"process_inbox","max_results":5},"time_filter":{"field":"date","default_window":"24h","description":"Only process emails from the last 24 hours"},"input_schema":[{"key":"mode","type":"select","label":"Mode","options":["process_inbox","search"],"default":"process_inbox"},{"key":"max_results","type":"number","label":"Max results","default":5}],"suggested_trigger":{"type":"schedule","cron":"0 */6 * * *","description":"Every 6 hours"}}]}
Generate 3-6 use_cases that describe the key capabilities of this persona based on the n8n workflow analysis. Each use case should represent a distinct scenario the persona can handle.
- execution_mode: "e2e" (real API calls, default for most), "mock" (show example output for data transformations), "non_executable" (informational/conceptual)
- sample_input: JSON object with realistic example input for testing (required for e2e/mock, null for non_executable). MUST match input_schema field keys.
- time_filter: CRITICAL for efficiency. For any use case that processes time-series data (emails, messages, logs, events, notifications), you MUST include a time_filter with: "field" (the API parameter name for date filtering, e.g. "after", "since", "date"), "default_window" (e.g. "1h", "6h", "24h", "7d"), "description" (human-readable explanation). This prevents the agent from fetching ALL historical data when only recent items are needed.
- input_schema: Array of structured input fields instead of free-text JSON. Each field has: "key" (string), "type" ("text"|"number"|"select"|"boolean"), "label" (display name), "default" (default value), "options" (array, for select type only). This replaces unstructured sample_input for the UI.
- suggested_trigger: If this use case should run on a schedule or event, suggest the trigger type and configuration. Use "type" ("schedule"|"polling"|"webhook"|"manual"), "cron" (for schedule), and "description" (human-readable)."##
}

// ── Composed prompt builders ──────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub fn build_n8n_transform_prompt(
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
    user_answers_json: Option<&str>,
) -> String {
    let platform = platform_rules::builtin_n8n();
    let credential_rules = platform.format_credential_rules_prompt();
    let platform_label = &platform.label;

    let adjustment_section = adjustment_request
        .filter(|a| !a.trim().is_empty())
        .map(|a| format!("\nUser adjustment request:\n{}\n", a))
        .unwrap_or_default();

    let previous_draft_section = previous_draft_json
        .filter(|d| !d.trim().is_empty())
        .map(|d| format!("\nPrevious draft JSON to refine:\n{}\n", d))
        .unwrap_or_default();

    let connectors_section = format_connector_section(connectors_json);
    let credentials_section = format_credential_section(credentials_json);

    let user_answers_section = user_answers_json
        .filter(|a| !a.trim().is_empty() && a.trim() != "{}")
        .map(|a| format!(
            "\n## User Configuration Answers\nThe user has provided these answers to clarify the transformation. Honor these answers when generating the persona configuration:\n{}\n", a
        ))
        .unwrap_or_default();

    let credential_adaptation = build_credential_adaptation_rules();
    let protocol_docs = build_protocol_docs();
    let pattern_mapping = build_pattern_mapping();
    let output_schema = build_output_schema();

    format!(
        r#"You are a senior Personas architect.

Transform the following {platform_label} workflow into a production-ready Personas agent.

## App Capabilities (Personas Platform)
- Personas has a built-in LLM execution engine. Do NOT suggest external LLM API tools.
  No Anthropic API, no OpenAI API calls. The persona's system_prompt IS the AI brain.
- {platform_label} AI/LLM nodes should be absorbed into the persona's prompt logic — NOT mapped as external tools.
- Tools are external scripts that interact with APIs (Gmail, Slack, HTTP, etc.)
- Triggers start the persona (schedule, webhook, polling, manual)
- Each tool can reference a connector (credential type) it requires

{credential_rules}

{credential_adaptation}
{connectors_section}{credentials_section}
{protocol_docs}

{pattern_mapping}

{output_schema}

Workflow name:
{workflow_name}

Static parser baseline JSON:
{parser_result_json}

Original n8n workflow JSON:
{workflow_json}

{adjustment_section}
{previous_draft_section}
{user_answers_section}
"#
    )
}

/// Build a unified prompt that handles both question generation and persona generation
/// in a single CLI session. The model decides if it needs clarification.
pub fn build_n8n_unified_prompt(
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
) -> String {
    let platform = platform_rules::builtin_n8n();
    let credential_rules = platform.format_credential_rules_prompt();
    let platform_label = &platform.label;
    let connectors_section = format_connector_section(connectors_json);
    let credentials_section = format_credential_section(credentials_json);

    let workflow_preview = truncate_utf8(workflow_json, 5000);

    let credential_adaptation = build_credential_adaptation_rules();
    let protocol_docs = build_protocol_docs();
    let pattern_mapping = build_pattern_mapping();
    let output_schema = build_output_schema();

    format!(
        r#"You are a senior Personas architect. You will analyze a {platform_label} workflow and either ask
clarifying questions OR generate a persona directly.

## PHASE 1: Analyze the workflow

Look at the workflow below. Decide whether you need clarification from the user.

If the workflow is complex (has external service integrations, multiple branches, ambiguous
configuration choices, or actions with external consequences), you MUST ask 4-8 questions.

If the workflow is simple and self-explanatory (e.g., a single-step manual trigger with
one action), skip questions and go directly to PHASE 2.

### When asking questions, output EXACTLY this format and then STOP:

TRANSFORM_QUESTIONS
[{{"id":"q1","category":"configuration","question":"Your question here","type":"select","options":["Option A","Option B"],"default":"Option A","context":"Why this matters"}}]

Question rules:
- type must be one of: "select", "text", "boolean"
- category must be one of: "credentials", "configuration", "human_in_the_loop", "memory", "notifications"
- For boolean type, options should be ["Yes", "No"]
- For select type, always include options array
- For text type, options is optional
- ALWAYS include at least one question about human-in-the-loop approval
- ALWAYS include at least one question about memory/learning strategy
- Order questions grouped by category: credentials → configuration → human_in_the_loop → memory → notifications
- Each question must have a unique id

Question categories (MUST include "category" field on every question):
1. "credentials" — which credentials for each service (only if user has relevant ones)
2. "configuration" — workflow-specific settings to customize
3. "human_in_the_loop" — for actions with external consequences, ask about manual approval
4. "memory" — what should the persona remember across runs
5. "notifications" — how to notify the user

After outputting the TRANSFORM_QUESTIONS block, STOP. Do not output anything else.

## PHASE 2: Generate persona JSON

If you decided no questions are needed, or if the user has already answered your questions
(they will be provided in a follow-up message), generate the full persona.

The Personas platform capabilities:
- Built-in LLM execution engine (no external LLM API tools needed)
- {platform_label} AI/LLM nodes should be absorbed into prompt logic
- Tools are external scripts for APIs (Gmail, Slack, HTTP, etc.)
- Triggers start the persona (schedule, webhook, polling, manual)

{credential_rules}

{credential_adaptation}
{connectors_section}{credentials_section}
{protocol_docs}

{pattern_mapping}

{output_schema}

## Workflow Data

Workflow name: {workflow_name}
Parser result: {parser_result_json}
Original n8n JSON (first 5000 chars): {workflow_preview}
"#
    )
}
