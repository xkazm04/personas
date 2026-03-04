/**
 * Realistic CLI output fixtures for E2E testing.
 *
 * Each fixture represents post-parse display lines as they arrive in the
 * frontend after the Rust backend's `parse_stream_line()` converts
 * provider-native JSON into human-readable strings.
 *
 * Fixtures are grouped by:
 *   1. Provider (Claude / Gemini / Copilot)
 *   2. Scenario (execution, query debug, N8N transform, etc.)
 *   3. Edge-case (overflow, dedup, truncation, etc.)
 */

// ═══════════════════════════════════════════════════════════════════════════
// Provider-specific execution output
// ═══════════════════════════════════════════════════════════════════════════

/** Claude Code CLI — persona execution with tool calls */
export const CLAUDE_EXECUTION_LINES = [
  'Session started (claude-sonnet-4-6)',
  '> Analyzing input data and determining next steps…',
  '> Using tool: Read',
  '  Tool result: File contents (245 chars)',
  '> Using tool: Write',
  '  Tool result: File written successfully',
  'I have analyzed the data and created the report.',
  'The report includes 3 key findings:',
  '1. Revenue increased by 15% QoQ',
  '2. Customer churn decreased to 2.1%',
  '3. New signups exceeded target by 200',
  'Completed in 12.4s',
  'Cost: $0.032',
  '[SUMMARY]{"status":"completed","duration_ms":12400,"cost_usd":0.032,"last_tool":"Write"}',
];

/** Gemini CLI — persona execution with web search */
export const GEMINI_EXECUTION_LINES = [
  'Session started (gemini-3-flash-preview)',
  '> Analyzing input data and determining next steps…',
  '> Using tool: Read',
  '  Tool result: File contents (189 chars)',
  '> Using tool: WebSearch',
  '  Tool result: Found 5 results',
  'Based on my analysis of the documentation and web search results:',
  '- The API endpoint requires OAuth2 authentication',
  '- Rate limit is 100 requests per minute',
  '- Response format follows JSON:API specification',
  'Completed in 8.7s',
  'Cost: $0.018',
  '[SUMMARY]{"status":"completed","duration_ms":8700,"cost_usd":0.018,"last_tool":"WebSearch"}',
];

/** Copilot CLI — persona execution with tests */
export const COPILOT_EXECUTION_LINES = [
  'Session started (gpt-5.1-codex-mini)',
  '> Analyzing input data and determining next steps…',
  '> Using tool: Read',
  '  Tool result: Configuration loaded (92 chars)',
  '> Using tool: Bash',
  '  Tool result: npm test passed (12 tests)',
  'All tests are passing. The configuration change is compatible.',
  'Summary of changes:',
  '- Updated auth middleware to support JWT v2',
  '- Added token refresh endpoint',
  'Completed in 15.1s',
  'Cost: $0.041',
  '[SUMMARY]{"status":"completed","duration_ms":15100,"cost_usd":0.041,"last_tool":"Bash"}',
];

// ═══════════════════════════════════════════════════════════════════════════
// Failure scenarios
// ═══════════════════════════════════════════════════════════════════════════

/** Mid-stream error (tool failure) */
export const FAILED_EXECUTION_LINES = [
  'Session started (claude-sonnet-4-6)',
  '> Analyzing input data…',
  '> Using tool: Bash',
  '  Tool result: Command failed (exit code 1)',
  '[ERROR] Process exited with non-zero status',
  '[SUMMARY]{"status":"failed","duration_ms":3200,"cost_usd":0.008,"last_tool":"Bash"}',
];

/** Timeout execution */
export const TIMEOUT_EXECUTION_LINES = [
  'Session started (claude-sonnet-4-6)',
  '> Analyzing complex dataset…',
  '> Using tool: Read',
  '  Tool result: Large file (15000 chars)',
  '[TIMEOUT] Execution exceeded 60s limit',
  '[SUMMARY]{"status":"failed","duration_ms":60000,"cost_usd":0.095,"last_tool":"Read"}',
];

/** Gemini failure — auth error */
export const GEMINI_AUTH_FAILURE_LINES = [
  'Session started (gemini-3-flash-preview)',
  '[ERROR] Authentication failed: invalid API key',
  '[SUMMARY]{"status":"failed","duration_ms":450,"cost_usd":0,"last_tool":null}',
];

/** Copilot failure — model unavailable */
export const COPILOT_MODEL_FAILURE_LINES = [
  'Session started (gpt-5.1-codex-mini)',
  '> Analyzing input data…',
  '[ERROR] Model "gpt-5.1-codex-mini" is not available in your current plan',
  '[SUMMARY]{"status":"failed","duration_ms":1200,"cost_usd":0,"last_tool":null}',
];

// ═══════════════════════════════════════════════════════════════════════════
// Query debug scenario
// ═══════════════════════════════════════════════════════════════════════════

/** Successful query debug — Claude provider */
export const QUERY_DEBUG_CLAUDE_LINES = [
  '> Analyzing query error context…',
  '> Attempt 1: Examining table schema',
  '> Using tool: Read',
  '  Tool result: Schema loaded',
  '> Query succeeded after correction',
  'The issue was a missing JOIN clause. The corrected query adds an INNER JOIN on users.id = orders.user_id.',
  'Completed in 4.2s',
];

/** Successful query debug — Gemini provider */
export const QUERY_DEBUG_GEMINI_LINES = [
  '> Analyzing query error context…',
  '> Attempt 1: Examining table schema with Gemini',
  '> Using tool: Read',
  '  Tool result: Schema loaded (PostgreSQL)',
  '> Query succeeded after correction',
  'Fixed: Added explicit CAST(created_at AS DATE) to resolve type mismatch in WHERE clause.',
  'Completed in 3.8s',
];

/** Successful query debug — Copilot provider */
export const QUERY_DEBUG_COPILOT_LINES = [
  '> Analyzing query error context…',
  '> Attempt 1: Reviewing error log with Copilot',
  '> Using tool: Read',
  '  Tool result: Error context loaded',
  '> Query succeeded after correction',
  'The GROUP BY clause was missing the "status" column. Added it to resolve the aggregation error.',
  'Completed in 5.1s',
];

/** Failed query debug */
export const QUERY_DEBUG_FAILED_LINES = [
  '> Analyzing query error context…',
  '> Attempt 1: Examining table schema',
  '> Attempt 2: Trying alternative approach',
  '> Max retries exceeded',
  '[ERROR] Could not resolve query issue after 3 attempts',
];

// ═══════════════════════════════════════════════════════════════════════════
// N8N transform scenario
// ═══════════════════════════════════════════════════════════════════════════

/** N8N workflow transform — full lifecycle */
export const N8N_TRANSFORM_LINES = [
  '[System] Starting workflow transformation…',
  '> Analyzing static workflow structure (12 nodes, 8 connections)',
  '[Milestone] Parsing workflow structure',
  '> Preparing transformation prompt for Claude',
  '[Milestone] Preparing transformation',
  '> AI is generating persona draft…',
  '[Milestone] AI generating persona draft',
  '> Extracting structured output from AI response',
  '[Milestone] Extracting persona structure',
  '> Draft ready for review',
  '[Milestone] Draft ready for review.',
  'Completed in 22.8s',
];

/** N8N transform — Gemini engine */
export const N8N_TRANSFORM_GEMINI_LINES = [
  '[System] Starting workflow transformation (Gemini)…',
  '> Analyzing static workflow structure (8 nodes, 5 connections)',
  '[Milestone] Parsing workflow structure',
  '> Preparing transformation prompt for Gemini 3 Flash Preview',
  '[Milestone] Preparing transformation',
  '> AI is generating persona draft via Gemini…',
  '[Milestone] AI generating persona draft',
  '> Extracting structured output',
  '[Milestone] Extracting persona structure',
  '> Draft ready',
  '[Milestone] Draft ready for review.',
  'Completed in 19.4s',
];

/** N8N transform failure — parse error */
export const N8N_TRANSFORM_FAILED_LINES = [
  '[System] Starting workflow transformation…',
  '> Analyzing static workflow structure (3 nodes, 1 connection)',
  '[Milestone] Parsing workflow structure',
  '[ERROR] Failed to parse workflow: unsupported node type "n8n-nodes-base.customNode"',
];

// ═══════════════════════════════════════════════════════════════════════════
// Template adoption scenario
// ═══════════════════════════════════════════════════════════════════════════

/** Template adoption — full lifecycle */
export const TEMPLATE_ADOPTION_LINES = [
  '[System] Starting template adoption…',
  '> Parsing template definition',
  '> Analyzing use cases and generating persona configuration',
  '> Applying sandbox policy overrides (budget: $0.50, concurrency: 1)',
  '> Generating persona from template variables',
  '> Extracting design result…',
  '> Normalizing draft structure',
  '> Persona creation complete',
  'Completed in 18.3s',
];

/** Template adoption — Copilot engine */
export const TEMPLATE_ADOPTION_COPILOT_LINES = [
  '[System] Starting template adoption (Copilot)…',
  '> Parsing template definition',
  '> Generating persona configuration with Copilot',
  '> Applying sandbox policy overrides (budget: $1.00, concurrency: 2)',
  '> Extracting design result…',
  '> Normalizing draft structure',
  '> Persona creation complete',
  'Completed in 24.6s',
];

// ═══════════════════════════════════════════════════════════════════════════
// AI healing scenario
// ═══════════════════════════════════════════════════════════════════════════

/** AI healing — successful diagnosis and fix */
export const AI_HEALING_SUCCESS_LINES = [
  '> Starting AI healing diagnosis…',
  '> Analyzing execution failure context',
  '> Diagnosing root cause: missing API credential',
  '> Applying fix: credential rotation',
  '> Verifying fix effectiveness…',
  '> Fix verified — execution should succeed on retry',
  'Diagnosis complete in 6.1s',
];

/** AI healing — diagnosis but no auto-fix */
export const AI_HEALING_MANUAL_LINES = [
  '> Starting AI healing diagnosis…',
  '> Analyzing execution failure context',
  '> Diagnosing root cause: rate limit exceeded',
  '> Cannot auto-fix: requires manual rate limit increase',
  '> Suggested action: wait 60s or upgrade API plan',
  'Diagnosis complete in 2.4s',
];

// ═══════════════════════════════════════════════════════════════════════════
// API test runner scenario
// ═══════════════════════════════════════════════════════════════════════════

/** API batch test — mixed results */
export const API_TEST_RUNNER_LINES = [
  '10:30:01 Starting batch API test (8 endpoints)',
  '10:30:01 Testing GET /api/v1/users',
  '10:30:02 ✓ GET /api/v1/users → 200 OK (340ms)',
  '10:30:02 Testing POST /api/v1/users',
  '10:30:03 ✓ POST /api/v1/users → 201 Created (520ms)',
  '10:30:03 Testing GET /api/v1/users/{id}',
  '10:30:03 → Skipped (path params)',
  '10:30:03 Testing DELETE /api/v1/users/{id}',
  '10:30:03 → Skipped (path params)',
  '10:30:03 Testing GET /api/v1/orders',
  '10:30:04 ✓ GET /api/v1/orders → 200 OK (280ms)',
  '10:30:04 Testing POST /api/v1/orders',
  '10:30:05 ✗ POST /api/v1/orders → 401 Unauthorized (150ms)',
  '10:30:05 Testing GET /api/v1/health',
  '10:30:05 ✓ GET /api/v1/health → 200 OK (45ms)',
  '10:30:05 Testing PUT /api/v1/settings',
  '10:30:06 ✗ PUT /api/v1/settings → 500 Internal Server Error (890ms)',
  '10:30:06 Batch complete: 4 passed, 2 failed, 2 skipped',
];

// ═══════════════════════════════════════════════════════════════════════════
// Phase detection lines (for PersonaRunner phase timeline)
// ═══════════════════════════════════════════════════════════════════════════

export const PHASE_DETECTION_LINES = {
  initializing: 'Session started (claude-sonnet-4-6)',
  thinking: '> Analyzing input data and determining next steps…',
  callingTools: '> Using tool: Read',
  toolResult: '  Tool result: File contents (245 chars)',
  responding: 'I have completed the analysis. Here are my findings:',
  finalizing: '[SUMMARY]{"status":"completed","duration_ms":12400,"cost_usd":0.032}',
  error: '[ERROR] Process exited with non-zero status',
};

// ═══════════════════════════════════════════════════════════════════════════
// Edge-case fixtures
// ═══════════════════════════════════════════════════════════════════════════

/** Line exceeding MAX_STREAM_LINE_LENGTH (4096 chars) */
export const OVERSIZED_LINE = 'X'.repeat(5000);

/** Duplicate consecutive lines for dedup testing */
export const DUPLICATE_LINES = [
  '> Using tool: Read',
  '> Using tool: Read',
  '> Using tool: Read',
  '  Tool result: success',
];

/** Empty/whitespace lines for filtering */
export const WHITESPACE_LINES = ['', '   ', '\t', '\n', 'actual content'];

/** Generate N lines for buffer overflow testing (MAX_STREAM_LINES = 5000) */
export function generateOverflowLines(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Line ${i + 1}: output data`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Multi-provider execution matrix
// ═══════════════════════════════════════════════════════════════════════════

export interface ProviderFixture {
  name: string;
  model: string;
  successLines: string[];
  failureLines: string[];
  supportsResume: boolean;
}

export const PROVIDER_FIXTURES: ProviderFixture[] = [
  {
    name: 'Claude Code',
    model: 'claude-sonnet-4-6',
    successLines: CLAUDE_EXECUTION_LINES,
    failureLines: FAILED_EXECUTION_LINES,
    supportsResume: true,
  },
  {
    name: 'Gemini CLI',
    model: 'gemini-3-flash-preview',
    successLines: GEMINI_EXECUTION_LINES,
    failureLines: GEMINI_AUTH_FAILURE_LINES,
    supportsResume: true,
  },
  {
    name: 'Copilot CLI',
    model: 'gpt-5.1-codex-mini',
    successLines: COPILOT_EXECUTION_LINES,
    failureLines: COPILOT_MODEL_FAILURE_LINES,
    supportsResume: false,
  },
];
