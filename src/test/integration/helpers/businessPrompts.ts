/**
 * Real prompt templates extracted from the Rust engine.
 * These mirror what the app actually sends to CLI providers.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. Persona Design — mirrors engine/design.rs DESIGN_OUTPUT_SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export function buildPersonaDesignPrompt(input: {
  personaName: string;
  personaDescription: string;
  instruction: string;
  tools?: string[];
  connectors?: string[];
}): string {
  const toolsSection = input.tools?.length
    ? `## Available Tools\n${input.tools.map((t) => `- ${t}`).join('\n')}\n\n`
    : '';
  const connectorsSection = input.connectors?.length
    ? `## Available Connectors\n${input.connectors.map((c) => `- ${c}`).join('\n')}\n\n`
    : '';

  return `# Persona Design Analysis

## Persona
- Name: ${input.personaName}
- Description: ${input.personaDescription}

${toolsSection}${connectorsSection}## User Instruction
${input.instruction}

${DESIGN_OUTPUT_SCHEMA}`;
}

const DESIGN_OUTPUT_SCHEMA = `## Required Output Format

You MUST output your result as a single JSON code block. The JSON must conform to this exact schema:

\`\`\`json
{
  "structured_prompt": {
    "identity": "Who this persona is and its core purpose",
    "instructions": "Step-by-step instructions for the persona",
    "toolGuidance": "How and when to use each tool",
    "examples": "Example interactions or scenarios",
    "errorHandling": "How to handle errors and edge cases",
    "webSearch": "",
    "customSections": [
      { "title": "Section Title", "content": "Section content" }
    ]
  },
  "suggested_tools": ["tool_name_1", "tool_name_2"],
  "suggested_triggers": [
    {
      "trigger_type": "schedule|polling|webhook|manual",
      "config": { "cron": "*/5 * * * *" },
      "description": "What this trigger does"
    }
  ],
  "full_prompt_markdown": "# Complete System Prompt\\n\\nThe full prompt in markdown...",
  "summary": "One-paragraph summary of this persona design",
  "suggested_connectors": [
    {
      "name": "connector_slug",
      "label": "Human Readable Name",
      "auth_type": "oauth2|pat|api_key|bot_token",
      "credential_fields": [
        {
          "key": "field_key",
          "label": "Human Label",
          "type": "text|password",
          "placeholder": "example value",
          "helpText": "Where to find this credential",
          "required": true
        }
      ],
      "setup_instructions": "Step-by-step setup guide"
    }
  ],
  "use_case_flows": [
    {
      "id": "flow_1",
      "name": "Primary Workflow",
      "description": "Description of this workflow path",
      "nodes": [
        { "id": "n1", "type": "start", "label": "Trigger fires" },
        { "id": "n2", "type": "action", "label": "Process data" },
        { "id": "n3", "type": "end", "label": "Complete" }
      ],
      "edges": [
        { "id": "e1", "source": "n1", "target": "n2" },
        { "id": "e2", "source": "n2", "target": "n3" }
      ]
    }
  ]
}
\`\`\`

Important rules:
1. \`suggested_tools\` must only reference tools from the Available Tools list above
2. Each connector MUST include \`credential_fields\` with at least one field
3. Each connector MUST include \`auth_type\`
4. \`full_prompt_markdown\` must be the complete, ready-to-use system prompt
5. Output ONLY the JSON block — no additional text before or after
6. \`use_case_flows\` MUST contain 1-3 flow diagrams
7. Flow node types: "start", "end", "action", "decision", "connector", "event", "error"

If the instruction is ambiguous, you MAY output a question instead:
\`\`\`json
{
  "design_question": {
    "question": "Your clarification question here",
    "options": ["Option A", "Option B"],
    "context": "Brief context"
  }
}
\`\`\``;

// ═══════════════════════════════════════════════════════════════════════════
// 2. Credential Design — mirrors engine/credential_design.rs
// ═══════════════════════════════════════════════════════════════════════════

export function buildCredentialDesignPrompt(input: {
  serviceDescription: string;
  existingConnectors?: string[];
}): string {
  const existing = input.existingConnectors?.length
    ? `## Existing Connectors\n${input.existingConnectors.map((c) => `- ${c}`).join('\n')}\n\n`
    : '';

  return `# Credential & Connector Design

${existing}## User Request
${input.serviceDescription}

${CREDENTIAL_DESIGN_OUTPUT_SCHEMA}`;
}

const CREDENTIAL_DESIGN_OUTPUT_SCHEMA = `## Required Output Format

You MUST output your result as a single JSON code block:

\`\`\`json
{
  "match_existing": null,
  "connector": {
    "name": "service_name_snake_case",
    "label": "Service Display Name",
    "category": "category_name",
    "color": "#HEX_COLOR",
    "oauth_type": null,
    "fields": [
      {
        "key": "field_key",
        "label": "Field Label",
        "type": "password",
        "required": true,
        "placeholder": "Example value...",
        "helpText": "Short setup guidance"
      }
    ],
    "healthcheck_config": {
      "url": "https://api.example.com/health",
      "method": "GET",
      "headers": { "Authorization": "Bearer {{api_key}}" },
      "expected_status": 200,
      "description": "Verifies API key is valid"
    },
    "services": [],
    "events": []
  },
  "setup_instructions": "## How to get your API key\\n\\n1. Go to ...\\n2. Navigate to ...",
  "summary": "One-line summary"
}
\`\`\`

Rules:
1. \`match_existing\` — set to existing connector name if match found, else null
2. \`connector.name\` — lowercase snake_case
3. \`connector.fields[].type\` — "password" for secrets, "text" for identifiers
4. \`connector.healthcheck_config\` — use \`{{field_key}}\` placeholders in headers
5. Output ONLY the JSON block`;

// ═══════════════════════════════════════════════════════════════════════════
// 3. Credential Healthcheck — mirrors engine/credential_design.rs
// ═══════════════════════════════════════════════════════════════════════════

export function buildCredentialHealthcheckPrompt(input: {
  serviceDescription: string;
  connectorJson: string;
  fieldKeys: string[];
}): string {
  return `# Credential Healthcheck Design

## User Request
Design a healthcheck endpoint for: ${input.serviceDescription}

## Connector Definition
${input.connectorJson}

## Available Credential Field Keys
${input.fieldKeys.map((k) => `- ${k}`).join('\n')}

${CREDENTIAL_HEALTHCHECK_OUTPUT_SCHEMA}`;
}

const CREDENTIAL_HEALTHCHECK_OUTPUT_SCHEMA = `## Required Output Format

Output exactly one JSON block:

\`\`\`json
{
  "skip": false,
  "reason": null,
  "endpoint": "https://api.example.com/v1/me",
  "method": "GET",
  "headers": {
    "Authorization": "Bearer {{api_key}}"
  },
  "expected_status": 200,
  "description": "Validates credential via user profile endpoint"
}
\`\`\`

Rules:
1. If no safe endpoint exists, set \`skip\` to true and explain in \`reason\`.
2. Use \`{{field_key}}\` placeholders from available fields.
3. Prefer identity/profile endpoints over write operations.
4. Output ONLY the JSON block.`;

// ═══════════════════════════════════════════════════════════════════════════
// 4. N8N Transform Turn 1 — mirrors n8n_transform/prompts.rs
// ═══════════════════════════════════════════════════════════════════════════

export function buildN8nTransformPrompt(input: {
  workflowName: string;
  workflowJson: string;
  availableConnectors?: string[];
}): string {
  const connectorsSection = input.availableConnectors?.length
    ? `## Available Connectors\n${input.availableConnectors.map((c) => `- ${c}`).join('\n')}\n\n`
    : '';

  return `# n8n Workflow Transformation

## Workflow: ${input.workflowName}

${connectorsSection}## Workflow JSON
\`\`\`json
${input.workflowJson}
\`\`\`

## Your Task

Analyze this n8n workflow and decide:

**PHASE 1 (Questions):** If you need clarification about configuration, human-in-the-loop preferences, or memory strategy, output questions in this format:

TRANSFORM_QUESTIONS
[{"id":"q1","category":"configuration","question":"Your question","type":"select","options":["Option A","Option B"],"default":"Option A","context":"Why this matters"}]

Question rules:
- type: "select", "text", or "boolean"
- category: "credentials", "configuration", "human_in_the_loop", "memory", "notifications"
- MUST include at least one question about human-in-the-loop
- MUST include at least one question about memory/learning strategy

**PHASE 2 (Persona):** If the workflow is straightforward, skip questions and output the persona directly as a JSON block with a \`"persona"\` key containing: name, description, system_prompt, structured_prompt, tools, triggers, required_connectors.

Choose ONE: output TRANSFORM_QUESTIONS or output the persona JSON. Not both.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. N8N Transform Turn 2 (Section-Delimited) — mirrors wrap_prompt_with_sections
// ═══════════════════════════════════════════════════════════════════════════

export function buildN8nSectionedPrompt(input: {
  workflowName: string;
  workflowJson: string;
  userAnswers: Record<string, string>;
}): string {
  const answersJson = JSON.stringify(input.userAnswers, null, 2);

  return `IMPORTANT OUTPUT FORMAT — SECTION-BY-SECTION STREAMING:

Do NOT output a single monolithic JSON object. Instead, emit each section separately:

1. ---SECTION:identity---
   JSON with: name, description, icon, color, model_profile

2. ---SECTION:prompt---
   JSON with: system_prompt, structured_prompt

3. For EACH tool:
   ---SECTION:tool---
   JSON with: name, category, description

4. For EACH trigger:
   ---SECTION:trigger---
   JSON with: trigger_type, config, description

5. For EACH connector:
   ---SECTION:connector---
   JSON with: name, n8n_credential_type, has_credential

6. ---SECTION:design_context---
   JSON with: summary, use_cases (array)

7. ---SECTION:end---

CRITICAL: Each delimiter MUST be on its own line. Each JSON block must be valid.

---

# n8n Workflow Transformation

## Workflow: ${input.workflowName}

## Workflow JSON
\`\`\`json
${input.workflowJson}
\`\`\`

## User Answers
${answersJson}

Now generate the full persona using section-by-section format above.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Test Scenario Generation — mirrors engine/test_runner.rs
// ═══════════════════════════════════════════════════════════════════════════

export function buildTestScenarioPrompt(input: {
  agentName: string;
  agentDescription: string;
  agentPrompt: string;
  tools: Array<{ name: string; description: string; inputSchema?: string }>;
}): string {
  const toolsDocs = input.tools
    .map((t) => {
      let doc = `### ${t.name}\n${t.description}`;
      if (t.inputSchema) doc += `\nInput schema: ${t.inputSchema}`;
      return doc;
    })
    .join('\n\n');

  return `# Test Scenario Generator

## Agent Under Test
- Name: ${input.agentName}
- Description: ${input.agentDescription}

## Agent Prompt
${input.agentPrompt}

## Available Tools
${toolsDocs}

## Task
Generate 3-5 realistic test scenarios for this agent. Each scenario should test a different capability or edge case.

Output a JSON array:
\`\`\`json
[{
  "name": "Short scenario name",
  "description": "What this scenario tests",
  "input_data": {},
  "mock_tools": [{
    "tool_name": "tool_name_here",
    "description": "What this mock simulates",
    "mock_response": {}
  }],
  "expected_behavior": "Description of what a good response looks like",
  "expected_tool_sequence": ["tool1", "tool2"],
  "expected_protocols": ["user_message"]
}]
\`\`\`

Rules:
1. Each scenario must be realistic — something a real user would trigger
2. Include at least one happy path and one error/edge case
3. mock_tools must reference tools from the Available Tools list
4. expected_tool_sequence is the expected order of tool calls
5. Output ONLY the JSON array`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Persona Execution — mirrors engine/prompt.rs assemble_prompt()
// ═══════════════════════════════════════════════════════════════════════════

export function buildPersonaExecutionPrompt(input: {
  personaName: string;
  personaDescription: string;
  systemPrompt: string;
  tools?: string[];
  inputData: string;
}): string {
  const toolsSection = input.tools?.length
    ? `## Available Tools\n${input.tools.map((t) => `- ${t}`).join('\n')}\n\n`
    : '';

  return `# Persona: ${input.personaName}

## Description
${input.personaDescription}

## System Prompt
${input.systemPrompt}

${toolsSection}## Communication Protocols

You MUST use these JSON protocols to communicate structured data:

### User Message Protocol
Output this JSON to send a message to the user:
\`\`\`json
{"user_message": {"title": "Message Title", "content": "Message body text", "content_type": "text", "priority": "normal"}}
\`\`\`
- content_type: "text" or "markdown"
- priority: "low", "normal", "high", or "critical"

### Agent Memory Protocol
Output this JSON to persist knowledge for future runs:
\`\`\`json
{"agent_memory": {"title": "Memory Title", "content": "What to remember", "category": "fact", "importance": 5, "tags": ["tag1"]}}
\`\`\`
- category: "fact", "preference", "instruction", "context", or "learned"
- importance: 1-10

### Outcome Assessment Protocol (REQUIRED)
You MUST output this JSON at the very end of your response:
\`\`\`json
{"outcome_assessment": {"accomplished": true, "summary": "Brief summary of what was done", "blockers": []}}
\`\`\`
- If you could not accomplish the task, set accomplished to false and list blockers.

## Input Data
${input.inputData}

## EXECUTE NOW
Process the input data according to your system prompt. Use the communication protocols above to structure your output. You MUST end with an outcome_assessment.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Template Adoption — mirrors template_adopt.rs build_template_adopt_unified_prompt()
// ═══════════════════════════════════════════════════════════════════════════

export function buildTemplateAdoptPrompt(input: {
  templateName: string;
  templateDescription: string;
  templateTools?: string[];
  templateTriggers?: Array<{ type: string; description: string }>;
  availableConnectors?: string[];
}): string {
  const toolsSection = input.templateTools?.length
    ? `## Template Tools\n${input.templateTools.map((t) => `- ${t}`).join('\n')}\n\n`
    : '';
  const triggersSection = input.templateTriggers?.length
    ? `## Template Triggers\n${input.templateTriggers.map((t) => `- ${t.type}: ${t.description}`).join('\n')}\n\n`
    : '';
  const connectorsSection = input.availableConnectors?.length
    ? `## Available Connectors\n${input.availableConnectors.map((c) => `- ${c}`).join('\n')}\n\n`
    : '';

  return `# Template Adoption

## Template
- Name: ${input.templateName}
- Description: ${input.templateDescription}

${toolsSection}${triggersSection}${connectorsSection}## Your Task

Analyze this template and either:

**Option A — Ask Questions:** If the template has external integrations, ambiguous configuration, or needs user preferences, output 4-8 clarifying questions using this EXACT format:

TRANSFORM_QUESTIONS
[{"id":"q1","category":"credentials","question":"Your question","type":"select","options":["Option A","Option B"],"default":"Option A","context":"Why this matters"}]

Question rules:
- type: "select", "text", or "boolean"
- category: "credentials", "configuration", "human_in_the_loop", "memory", "notifications"
- MUST include at least one question about human-in-the-loop preferences
- MUST include at least one question about memory/learning strategy

**Option B — Generate Persona:** If the template is straightforward, output a JSON object with this EXACT schema:

\`\`\`json
{
  "persona": {
    "name": "string",
    "description": "2-3 sentence summary",
    "system_prompt": "Complete system prompt with protocol instructions",
    "structured_prompt": {
      "identity": "Who this persona is",
      "instructions": "Step-by-step instructions",
      "toolGuidance": "How to use each tool",
      "examples": "Example interactions",
      "errorHandling": "Error handling procedures",
      "webSearch": "",
      "customSections": [{"title": "Section Title", "content": "Content"}]
    },
    "icon": "lucide-icon-name",
    "color": "#hex",
    "tools": [{"name": "tool_name", "category": "http|database|file|messaging|other", "description": "What it does"}],
    "triggers": [{"trigger_type": "schedule|polling|webhook|manual", "config": {}, "description": "What triggers this"}],
    "required_connectors": [{"name": "connector_name", "n8n_credential_type": "service_type", "has_credential": false}]
  }
}
\`\`\`

Choose ONE: output TRANSFORM_QUESTIONS or output the persona JSON. Not both.
Output ONLY the chosen format — no additional text.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Query Debug — mirrors credentials/query_debug.rs build_prompt()
// ═══════════════════════════════════════════════════════════════════════════

export function buildQueryDebugPrompt(input: {
  serviceType: string;
  connectorFamily: string;
  schemaInfo: string;
  queryText: string;
  errorContext?: string;
}): string {
  const errorSection = input.errorContext
    ? `## Previous Error\n${input.errorContext}\n\n`
    : '';

  return `You are a database query expert. Fix and optimize the following query for a ${input.connectorFamily} database (${input.serviceType} service).

## Available Schema
${input.schemaInfo}

## Query
\`\`\`sql
${input.queryText}
\`\`\`

${errorSection}## Instructions
1. Identify and fix all issues (syntax, table/column names, dialect-specific syntax)
2. Output ONLY the corrected database query in a single \`\`\`sql code block
3. Do NOT output JavaScript, TypeScript, or client library code — ONLY the raw SQL query
4. Briefly explain what you fixed`;
}
