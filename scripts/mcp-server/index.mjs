#!/usr/bin/env node
/**
 * Personas MCP Server
 *
 * Exposes Personas agent management operations as MCP tools for Claude Desktop.
 * Reads from the Personas SQLite database (read-only, WAL-safe) and triggers
 * executions via the local webhook HTTP endpoint.
 *
 * Transport: stdio (standard MCP transport for Claude Desktop)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import initSqlJs from "sql.js";
import { join, dirname, extname, basename, relative } from "path";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";

// =============================================================================
// Database connection
// =============================================================================

function resolveDbPath() {
  // Allow override via env var
  if (process.env.PERSONAS_DB_PATH) {
    return process.env.PERSONAS_DB_PATH;
  }

  const platform = process.platform;
  if (platform === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) return join(appdata, "com.personas.desktop", "personas.db");
  } else if (platform === "darwin") {
    const home = process.env.HOME;
    if (home) return join(home, "Library", "Application Support", "com.personas.desktop", "personas.db");
  } else {
    // Linux: XDG_DATA_HOME or ~/.local/share
    const dataHome = process.env.XDG_DATA_HOME || join(process.env.HOME || "", ".local", "share");
    return join(dataHome, "com.personas.desktop", "personas.db");
  }
  throw new Error("Cannot resolve Personas database path. Set PERSONAS_DB_PATH env var.");
}

let db;
let SQL;
let dbPath;

/** Re-open the DB from disk to pick up latest writes from the Personas app. */
function reloadDb() {
  dbPath = dbPath || resolveDbPath();
  if (!existsSync(dbPath)) {
    throw new Error(`Personas database not found at: ${dbPath}\nMake sure the Personas app has been launched at least once.`);
  }
  const buffer = readFileSync(dbPath);
  db = new SQL.Database(buffer);
  return db;
}

async function getDb() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  // Reload from disk every call to see latest data (reads are fast, DB is small)
  return reloadDb();
}

/** Run a SELECT query and return rows as array of objects. */
function query(database, sql, params = []) {
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/** Run a SELECT query and return the first row. */
function queryOne(database, sql, params = []) {
  const rows = query(database, sql, params);
  return rows[0] || null;
}

// =============================================================================
// HTTP helper for triggering executions
// =============================================================================

const PERSONAS_PORT = parseInt(process.env.PERSONAS_PORT || "9420", 10);

async function triggerExecution(personaId, inputData) {
  // Find a webhook trigger for this persona to fire through the HTTP endpoint,
  // or use direct CLI invocation as fallback
  const execDb = await getDb();
  const trigger = queryOne(execDb, `
    SELECT id FROM persona_triggers
    WHERE persona_id = ? AND enabled = 1
    ORDER BY created_at DESC LIMIT 1
  `, [personaId]);

  if (trigger) {
    const resp = await fetch(`http://127.0.0.1:${PERSONAS_PORT}/webhook/${trigger.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inputData || {}),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Webhook trigger failed (${resp.status}): ${text}`);
    }
    return { method: "webhook", triggerId: trigger.id, status: resp.status };
  }

  // No trigger found — provide instructions
  return {
    method: "none",
    message: `No enabled trigger found for persona ${personaId}. ` +
      `Create a webhook trigger in the Personas app, or execute manually from the app.`,
  };
}

// =============================================================================
// MCP Server
// =============================================================================

const server = new McpServer({
  name: "personas",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool: list_personas
// ---------------------------------------------------------------------------
server.tool(
  "list_personas",
  "List all configured AI agent personas with their status, model, and group",
  {},
  async () => {
    const d = await getDb();
    const rows = query(d, `
      SELECT id, name, description, enabled, icon, color, group_id,
             model_profile, max_budget_usd, max_turns, created_at, updated_at
      FROM personas ORDER BY name
    `);

    const personas = rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      enabled: !!r.enabled,
      icon: r.icon,
      color: r.color,
      groupId: r.group_id,
      model: parseModelFromProfile(r.model_profile),
      maxBudgetUsd: r.max_budget_usd,
      maxTurns: r.max_turns,
    }));

    return { content: [{ type: "text", text: JSON.stringify(personas, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: get_persona_detail
// ---------------------------------------------------------------------------
server.tool(
  "get_persona_detail",
  "Get full details of a persona including prompt, tools, triggers, and recent executions",
  { persona: z.string().describe("Persona name or ID") },
  async ({ persona }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    const tools = query(d, `
      SELECT td.name, td.description, td.category
      FROM persona_tools pt
      JOIN persona_tool_definitions td ON pt.tool_id = td.id
      WHERE pt.persona_id = ?
    `, [row.id]);

    const triggers = query(d, `
      SELECT id, trigger_type, enabled, config, next_trigger_at, last_triggered_at
      FROM persona_triggers WHERE persona_id = ? ORDER BY created_at
    `, [row.id]);

    const recentExecs = query(d, `
      SELECT id, status, duration_ms, cost_usd, model_used, error_message,
             input_tokens, output_tokens, created_at
      FROM persona_executions WHERE persona_id = ?
      ORDER BY created_at DESC LIMIT 5
    `, [row.id]);

    const prompt = parseStructuredPrompt(row.structured_prompt) || {
      systemPrompt: row.system_prompt?.substring(0, 500),
    };

    const detail = {
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: !!row.enabled,
      model: parseModelFromProfile(row.model_profile),
      prompt,
      tools: tools.map(t => `${t.name} (${t.category}): ${t.description?.substring(0, 80)}`),
      triggers: triggers.map(t => ({
        id: t.id, type: t.trigger_type, enabled: !!t.enabled,
        nextTriggerAt: t.next_trigger_at,
      })),
      recentExecutions: recentExecs.map(e => ({
        id: e.id, status: e.status, durationMs: e.duration_ms,
        costUsd: e.cost_usd, model: e.model_used, error: e.error_message,
        tokens: { input: e.input_tokens, output: e.output_tokens },
        createdAt: e.created_at,
      })),
    };

    return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: execute_persona
// ---------------------------------------------------------------------------
server.tool(
  "execute_persona",
  "Trigger a persona execution with optional input data. Requires an enabled webhook trigger.",
  {
    persona: z.string().describe("Persona name or ID"),
    input: z.record(z.unknown()).optional().describe("Input data object to pass to the persona"),
  },
  async ({ persona, input }) => {
    const row = findPersona(await getDb(), persona);
    if (!row) return notFound("Persona", persona);
    if (!row.enabled) return errorResult(`Persona '${row.name}' is disabled. Enable it first.`);

    const result = await triggerExecution(row.id, input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: list_executions
// ---------------------------------------------------------------------------
server.tool(
  "list_executions",
  "List recent executions across all personas or for a specific persona",
  {
    persona: z.string().optional().describe("Filter by persona name or ID (omit for all)"),
    limit: z.number().optional().default(10).describe("Number of results (default 10)"),
    status: z.enum(["completed", "failed", "running", "queued", "cancelled"]).optional()
      .describe("Filter by status"),
  },
  async ({ persona, limit, status }) => {
    const d = await getDb();
    let sql = `
      SELECT e.id, e.persona_id, p.name as persona_name, e.status,
             e.duration_ms, e.cost_usd, e.model_used, e.error_message,
             e.input_tokens, e.output_tokens, e.created_at
      FROM persona_executions e
      LEFT JOIN personas p ON e.persona_id = p.id
    `;
    const conditions = [];
    const params = [];

    if (persona) {
      const row = findPersona(d, persona);
      if (row) {
        conditions.push("e.persona_id = ?");
        params.push(row.id);
      }
    }
    if (status) {
      conditions.push("e.status = ?");
      params.push(status);
    }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY e.created_at DESC LIMIT ?";
    params.push(limit || 10);

    const rows = query(d, sql, params);
    const execs = rows.map(e => ({
      id: e.id,
      persona: e.persona_name || e.persona_id,
      status: e.status,
      durationMs: e.duration_ms,
      costUsd: e.cost_usd,
      model: e.model_used,
      error: e.error_message,
      tokens: { input: e.input_tokens, output: e.output_tokens },
      createdAt: e.created_at,
    }));

    return { content: [{ type: "text", text: JSON.stringify(execs, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: get_execution_output
// ---------------------------------------------------------------------------
server.tool(
  "get_execution_output",
  "Get the full output and details of a specific execution",
  { executionId: z.string().describe("Execution ID") },
  async ({ executionId }) => {
    const d = await getDb();
    const row = queryOne(d, `
      SELECT e.*, p.name as persona_name
      FROM persona_executions e
      LEFT JOIN personas p ON e.persona_id = p.id
      WHERE e.id = ?
    `, [executionId]);

    if (!row) return notFound("Execution", executionId);

    const detail = {
      id: row.id,
      persona: row.persona_name,
      status: row.status,
      output: row.output_data,
      error: row.error_message,
      durationMs: row.duration_ms,
      costUsd: row.cost_usd,
      model: row.model_used,
      tokens: { input: row.input_tokens, output: row.output_tokens },
      toolSteps: safeJsonParse(row.tool_steps),
      executionFlows: safeJsonParse(row.execution_flows),
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };

    return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: list_lab_runs
// ---------------------------------------------------------------------------
server.tool(
  "list_lab_runs",
  "List lab test/arena/A-B/matrix/eval runs for a persona. Shows quality metrics and comparison results.",
  {
    persona: z.string().describe("Persona name or ID"),
    type: z.enum(["test", "arena", "ab", "matrix", "eval"]).optional()
      .describe("Lab run type filter (omit for all types)"),
    limit: z.number().optional().default(5).describe("Number of results"),
  },
  async ({ persona, type, limit }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    const results = {};

    if (!type || type === "test") {
      results.testRuns = query(d, `
        SELECT id, status, scenarios_count, models_tested, created_at
        FROM persona_test_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT ?
      `, [row.id, limit]);
    }
    if (!type || type === "arena") {
      results.arenaRuns = query(d, `
        SELECT id, status, models_tested, scenarios_count, created_at
        FROM lab_arena_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT ?
      `, [row.id, limit]);
    }
    if (!type || type === "ab") {
      results.abRuns = query(d, `
        SELECT id, status, version_a_id, version_b_id, created_at
        FROM lab_ab_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT ?
      `, [row.id, limit]);
    }
    if (!type || type === "matrix") {
      results.matrixRuns = query(d, `
        SELECT id, status, user_instruction, created_at
        FROM lab_matrix_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT ?
      `, [row.id, limit]);
    }
    if (!type || type === "eval") {
      results.evalRuns = query(d, `
        SELECT id, status, version_ids, created_at
        FROM lab_eval_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT ?
      `, [row.id, limit]);
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: get_lab_results
// ---------------------------------------------------------------------------
server.tool(
  "get_lab_results",
  "Get detailed results from a specific lab run (test scores, arena rankings, A/B comparison)",
  {
    runId: z.string().describe("Lab run ID"),
    type: z.enum(["test", "arena", "ab", "matrix", "eval"]).describe("Type of lab run"),
  },
  async ({ runId, type }) => {
    const d = await getDb();
    const tableMap = {
      test: "persona_test_results",
      arena: "lab_arena_results",
      ab: "lab_ab_results",
      matrix: "lab_matrix_results",
      eval: "lab_eval_results",
    };
    const table = tableMap[type];
    if (!table) return errorResult(`Unknown lab run type: ${type}`);

    const results = query(d, `SELECT * FROM ${table} WHERE run_id = ?`, [runId]);

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: list_prompt_versions
// ---------------------------------------------------------------------------
server.tool(
  "list_prompt_versions",
  "List prompt versions for a persona with tags (production, experimental, archived)",
  {
    persona: z.string().describe("Persona name or ID"),
    limit: z.number().optional().default(10),
  },
  async ({ persona, limit }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    const versions = query(d, `
      SELECT id, version_number, name, tag, change_summary, created_at
      FROM persona_versions
      WHERE persona_id = ? ORDER BY version_number DESC LIMIT ?
    `, [row.id, limit]);

    return { content: [{ type: "text", text: JSON.stringify(versions, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: get_persona_health
// ---------------------------------------------------------------------------
server.tool(
  "get_persona_health",
  "Get health status of a persona: error rate, recent failures, healing issues, assertion pass rates",
  { persona: z.string().describe("Persona name or ID") },
  async ({ persona }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    // Recent execution stats (last 20)
    const recentStats = query(d, `
      SELECT status, COUNT(*) as count
      FROM (SELECT status FROM persona_executions WHERE persona_id = ? ORDER BY created_at DESC LIMIT 20)
      GROUP BY status
    `, [row.id]);

    // Active healing issues
    const healingIssues = query(d, `
      SELECT id, title, severity, status, suggested_fix, created_at
      FROM persona_healing_issues
      WHERE persona_id = ? AND status NOT IN ('resolved', 'dismissed')
      ORDER BY created_at DESC LIMIT 5
    `, [row.id]);

    // Cost this month
    const monthlySpend = queryOne(d, `
      SELECT COALESCE(SUM(cost_usd), 0) as total
      FROM persona_executions
      WHERE persona_id = ? AND created_at >= datetime('now', 'start of month')
    `, [row.id]);

    // Output assertion stats
    const assertions = query(d, `
      SELECT a.name, a.assertion_type,
        (SELECT COUNT(*) FROM assertion_results r WHERE r.assertion_id = a.id AND r.passed = 1) as passed,
        (SELECT COUNT(*) FROM assertion_results r WHERE r.assertion_id = a.id) as total
      FROM output_assertions a WHERE a.persona_id = ?
    `, [row.id]);

    const health = {
      persona: row.name,
      enabled: !!row.enabled,
      recentExecutions: Object.fromEntries(recentStats.map(s => [s.status, s.count])),
      monthlySpendUsd: monthlySpend?.total || 0,
      budgetLimitUsd: row.max_budget_usd,
      activeHealingIssues: healingIssues,
      assertions: assertions.map(a => ({
        name: a.name, type: a.assertion_type,
        passRate: a.total > 0 ? `${Math.round(a.passed / a.total * 100)}%` : "N/A",
        passed: a.passed, total: a.total,
      })),
    };

    return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: search_knowledge
// ---------------------------------------------------------------------------
server.tool(
  "search_knowledge",
  "Search the persona knowledge graph for learned patterns, observations, and execution insights",
  {
    query: z.string().describe("Search query"),
    persona: z.string().optional().describe("Filter by persona name or ID"),
    limit: z.number().optional().default(10),
  },
  async ({ query: searchQuery, persona, limit }) => {
    const d = await getDb();
    let sql = `
      SELECT k.id, k.persona_id, p.name as persona_name, k.category,
             k.content, k.confidence, k.source_execution_id, k.created_at
      FROM knowledge_entries k
      LEFT JOIN personas p ON k.persona_id = p.id
      WHERE k.content LIKE ?
    `;
    const params = [`%${searchQuery}%`];

    if (persona) {
      const row = findPersona(d, persona);
      if (row) {
        sql += " AND k.persona_id = ?";
        params.push(row.id);
      }
    }
    sql += " ORDER BY k.created_at DESC LIMIT ?";
    params.push(limit);

    try {
      const results = query(d, sql, params);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: "Knowledge graph table not available." }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: list_credentials
// ---------------------------------------------------------------------------
server.tool(
  "list_credentials",
  "List configured service credentials (names and types only, never secrets)",
  {},
  async () => {
    const d = await getDb();
    const rows = query(d, `
      SELECT id, name, service_type, last_used_at, created_at
      FROM persona_credentials ORDER BY name
    `);

    const creds = rows.map(r => ({
      id: r.id, name: r.name, serviceType: r.service_type,
      lastUsedAt: r.last_used_at,
    }));

    return { content: [{ type: "text", text: JSON.stringify(creds, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: get_system_overview
// ---------------------------------------------------------------------------
server.tool(
  "get_system_overview",
  "Get a high-level overview of the Personas system: agent count, execution stats, health summary",
  {},
  async () => {
    const d = await getDb();

    const personaCount = queryOne(d, "SELECT COUNT(*) as c FROM personas");
    const enabledCount = queryOne(d, "SELECT COUNT(*) as c FROM personas WHERE enabled = 1");
    const credCount = queryOne(d, "SELECT COUNT(*) as c FROM persona_credentials");
    const triggerCount = queryOne(d, "SELECT COUNT(*) as c FROM persona_triggers WHERE enabled = 1");

    const execStats = query(d, `
      SELECT status, COUNT(*) as count
      FROM persona_executions
      WHERE created_at >= datetime('now', '-24 hours')
      GROUP BY status
    `);

    const totalCost24h = queryOne(d, `
      SELECT COALESCE(SUM(cost_usd), 0) as total
      FROM persona_executions
      WHERE created_at >= datetime('now', '-24 hours')
    `);

    const overview = {
      personas: { total: personaCount.c, enabled: enabledCount.c },
      credentials: credCount.c,
      activeTriggers: triggerCount.c,
      last24Hours: {
        executions: Object.fromEntries(execStats.map(s => [s.status, s.count])),
        totalCostUsd: totalCost24h.total,
      },
    };

    return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
  }
);

// =============================================================================
// Helpers
// =============================================================================

function findPersona(d, nameOrId) {
  return queryOne(d, "SELECT * FROM personas WHERE id = ? OR LOWER(name) = LOWER(?) LIMIT 1",
    [nameOrId, nameOrId]);
}

function notFound(entity, identifier) {
  return {
    content: [{ type: "text", text: `${entity} '${identifier}' not found.` }],
    isError: true,
  };
}

function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function parseModelFromProfile(profileJson) {
  if (!profileJson) return null;
  try {
    const p = JSON.parse(profileJson);
    return p.model || null;
  } catch { return null; }
}

function parseStructuredPrompt(json) {
  if (!json) return null;
  try {
    const sp = JSON.parse(json);
    return {
      identity: sp.identity?.substring(0, 200),
      instructions: sp.instructions?.substring(0, 300),
      toolGuidance: sp.toolGuidance ? "configured" : null,
      examples: sp.examples ? "configured" : null,
      customSections: sp.customSections?.length || 0,
    };
  } catch { return null; }
}

function safeJsonParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

// =============================================================================
// Management API tools (require Personas app running)
// =============================================================================

async function apiCall(method, path, body) {
  const url = `http://127.0.0.1:${PERSONAS_PORT}${path}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok) {
    throw new Error(data?.error || `API returned ${resp.status}: ${text.substring(0, 300)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Tool: run_persona (via management API - no webhook trigger needed)
// ---------------------------------------------------------------------------
server.tool(
  "run_persona",
  "Execute a persona directly via the management API. Requires the Personas app to be running. More reliable than execute_persona (no webhook trigger needed).",
  {
    persona: z.string().describe("Persona name or ID"),
    input: z.record(z.unknown()).optional().describe("Input data for the execution"),
  },
  async ({ persona, input }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    try {
      const result = await apiCall("POST", `/api/execute/${row.id}`, { input_data: input || null });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to execute: ${e.message}. Is the Personas app running?`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: start_arena_test
// ---------------------------------------------------------------------------
server.tool(
  "start_arena_test",
  "Start a lab arena test comparing a persona across multiple models. Requires Personas app running.",
  {
    persona: z.string().describe("Persona name or ID"),
    models: z.array(z.object({
      id: z.string().describe("Model identifier (e.g. 'sonnet', 'haiku')"),
      provider: z.string().default("anthropic").describe("Provider name"),
      model: z.string().optional().describe("Full model ID override"),
    })).describe("Models to compare"),
    use_case_filter: z.string().optional().describe("Filter scenarios by use case ID"),
  },
  async ({ persona, models, use_case_filter }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    try {
      const result = await apiCall("POST", `/api/lab/arena/${row.id}`, { models, use_case_filter });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to start arena: ${e.message}. Is the Personas app running?`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: start_matrix_improvement
// ---------------------------------------------------------------------------
server.tool(
  "start_matrix_improvement",
  "Start a lab matrix run that generates an improved prompt variant based on an instruction, tests it against the current prompt, and lets you accept the draft if it scores higher. Requires Personas app running.",
  {
    persona: z.string().describe("Persona name or ID"),
    instruction: z.string().describe("What to improve (e.g. 'Add error handling', 'Make output more concise')"),
    models: z.array(z.object({
      id: z.string(),
      provider: z.string().default("anthropic"),
      model: z.string().optional(),
    })).describe("Models to test against"),
    use_case_filter: z.string().optional(),
  },
  async ({ persona, instruction, models, use_case_filter }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    try {
      const result = await apiCall("POST", `/api/lab/matrix/${row.id}`, { models, instruction, use_case_filter });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to start matrix: ${e.message}. Is the Personas app running?`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: cancel_lab_run
// ---------------------------------------------------------------------------
server.tool(
  "cancel_lab_run",
  "Cancel a running lab test (arena, matrix, A/B, or eval)",
  { run_id: z.string().describe("Lab run ID to cancel") },
  async ({ run_id }) => {
    try {
      const result = await apiCall("POST", `/api/lab/cancel/${run_id}`, {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to cancel: ${e.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: improve_prompt_from_results
// ---------------------------------------------------------------------------
server.tool(
  "improve_prompt_from_results",
  "Auto-improve a persona's prompt based on lab test results. Analyzes scores, identifies weaknesses, and generates a better prompt version tagged as 'experimental'. Requires Personas app running.",
  {
    persona: z.string().describe("Persona name or ID"),
    run_id: z.string().describe("Lab run ID whose results to use for improvement"),
    mode: z.enum(["arena", "ab", "matrix", "eval"]).describe("Type of lab run"),
  },
  async ({ persona, run_id, mode }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    try {
      const result = await apiCall("POST", `/api/lab/improve/${row.id}/${run_id}`, { mode });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to improve: ${e.message}. Is the Personas app running?`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: tag_prompt_version
// ---------------------------------------------------------------------------
server.tool(
  "tag_prompt_version",
  "Tag a prompt version as 'production', 'experimental', or 'archived'",
  {
    version_id: z.string().describe("Prompt version ID"),
    tag: z.enum(["production", "experimental", "archived"]).describe("Tag to apply"),
  },
  async ({ version_id, tag }) => {
    try {
      const result = await apiCall("POST", `/api/versions/${version_id}/tag`, { tag });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to tag: ${e.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: rollback_prompt_version
// ---------------------------------------------------------------------------
server.tool(
  "rollback_prompt_version",
  "Rollback a persona's prompt to a previous version",
  { version_id: z.string().describe("Prompt version ID to restore") },
  async ({ version_id }) => {
    try {
      const result = await apiCall("POST", `/api/versions/${version_id}/rollback`, {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to rollback: ${e.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: accept_matrix_draft
// ---------------------------------------------------------------------------
server.tool(
  "accept_matrix_draft",
  "Accept a matrix-generated prompt draft and apply it to the live persona. Creates a new prompt version.",
  { run_id: z.string().describe("Matrix run ID whose draft to accept") },
  async ({ run_id }) => {
    try {
      const result = await apiCall("POST", `/api/versions/${run_id}/accept`, {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to accept draft: ${e.message}`);
    }
  }
);

// =============================================================================
// Automation settings tools
// =============================================================================

// ---------------------------------------------------------------------------
// Tool: configure_auto_optimize
// ---------------------------------------------------------------------------
server.tool(
  "configure_auto_optimize",
  "Enable or disable automatic prompt optimization for a persona. When enabled, periodic arena tests run and auto-improve the prompt if scores fall below the threshold.",
  {
    persona: z.string().describe("Persona name or ID"),
    enabled: z.boolean().describe("Enable or disable auto-optimization"),
    cron: z.string().optional().default("0 2 * * 0").describe("Cron schedule (default: Sunday 2 AM)"),
    min_score: z.number().optional().default(80).describe("Minimum score threshold to trigger improvement (0-100)"),
    models: z.array(z.string()).optional().default(["sonnet"]).describe("Models to test against"),
  },
  async ({ persona, enabled, cron, min_score, models }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    try {
      const result = await apiCall("POST", `/api/settings/auto-optimize/${row.id}`, {
        enabled, cron, min_score, models,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to configure: ${e.message}. Is the Personas app running?`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: configure_health_watch
// ---------------------------------------------------------------------------
server.tool(
  "configure_health_watch",
  "Enable or disable health monitoring for a persona. When enabled, periodic checks detect error rate spikes, budget overruns, and unresolved healing issues, sending notifications on degradation.",
  {
    persona: z.string().describe("Persona name or ID"),
    enabled: z.boolean().describe("Enable or disable health watching"),
    interval_hours: z.number().optional().default(6).describe("Check interval in hours (default: 6)"),
    error_threshold: z.number().optional().default(30).describe("Error rate % threshold for alerting (default: 30)"),
  },
  async ({ persona, enabled, interval_hours, error_threshold }) => {
    const d = await getDb();
    const row = findPersona(d, persona);
    if (!row) return notFound("Persona", persona);

    try {
      const result = await apiCall("POST", `/api/settings/health-watch/${row.id}`, {
        enabled, interval_hours, error_threshold,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return errorResult(`Failed to configure: ${e.message}. Is the Personas app running?`);
    }
  }
);

// =============================================================================
// Obsidian Memory tools — graph-aware vault operations
//
// These tools mirror the Rust commands in src-tauri/src/commands/obsidian_brain/
// graph.rs but run in this MCP server's Node process so an agent connected to
// Personas via Claude Desktop can call them at runtime. The vault path comes
// from the obsidian_brain_config row in app_settings — the same source the
// desktop plugin uses.
// =============================================================================

const WIKILINK_RE = /\[\[([^\]\|#]+)(?:[#\|][^\]]*)?\]\]/g;
const TOKENIZE_RE = /[\p{L}\p{N}_]+/gu;

function readObsidianConfig(d) {
  const rows = query(d, `SELECT value FROM app_settings WHERE key = ?`, ["obsidian_brain_config"]);
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return null;
  }
}

function ensureVaultConfig() {
  return getDb().then((d) => {
    const cfg = readObsidianConfig(d);
    if (!cfg || !cfg.vaultPath) {
      throw new Error(
        "Obsidian Brain is not configured. Open the Personas desktop app, go to Plugins → Obsidian Brain → Setup, and connect a vault.",
      );
    }
    if (!existsSync(cfg.vaultPath)) {
      throw new Error(`Configured vault path does not exist: ${cfg.vaultPath}`);
    }
    return cfg;
  });
}

function walkVault(vaultRoot, maxDepth = 12) {
  const notes = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (extname(name) !== ".md") continue;
      let body;
      try {
        body = readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const title = name.slice(0, -3);
      const outgoing = [];
      let m;
      WIKILINK_RE.lastIndex = 0;
      while ((m = WIKILINK_RE.exec(body)) !== null) {
        outgoing.push(m[1].trim());
      }
      notes.push({ path: full, title, body, outgoing });
    }
  }
  walk(vaultRoot, 0);
  return notes;
}

function buildBacklinkMap(notes) {
  const map = new Map();
  for (let i = 0; i < notes.length; i++) {
    const seen = new Set(notes[i].outgoing.map((s) => s.toLowerCase()));
    for (const target of seen) {
      const arr = map.get(target) || [];
      arr.push(i);
      map.set(target, arr);
    }
  }
  return map;
}

function tfidfScore(notes, queryTerms) {
  const docCount = notes.length || 1;
  const docFreq = new Map();
  const tokenizedDocs = notes.map((n) => {
    const tokens = (n.body.toLowerCase().match(TOKENIZE_RE) || []);
    const tf = new Map();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    for (const tok of tf.keys()) docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
    return tf;
  });
  const idf = new Map();
  for (const term of queryTerms) {
    const df = docFreq.get(term) || 0;
    idf.set(term, Math.log((docCount + 1) / (df + 1)) + 1);
  }
  return tokenizedDocs.map((tf, i) => {
    const titleLc = notes[i].title.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term) || 0;
      score += f * (idf.get(term) || 0);
      if (titleLc.includes(term)) score += 5;
    }
    return score;
  });
}

function snippetFor(body, queryLc) {
  const bodyLc = body.toLowerCase();
  const pos = bodyLc.indexOf(queryLc);
  if (pos < 0) return body.slice(0, 160).replace(/\n/g, " ");
  const start = Math.max(0, pos - 60);
  const end = Math.min(body.length, pos + queryLc.length + 100);
  let s = body.slice(start, end).replace(/\n/g, " ");
  if (start > 0) s = "…" + s;
  if (end < body.length) s = s + "…";
  return s;
}

function safeFilename(s) {
  return s.replace(/[^\p{L}\p{N} _-]+/gu, "-").trim();
}

function ensureWithinVault(vaultRoot, target) {
  const rel = relative(vaultRoot, target);
  if (rel.startsWith("..") || rel === target) {
    throw new Error("Path is outside the configured vault");
  }
}

server.tool(
  "vault_search",
  "Search the user's Obsidian vault by keyword. Returns matching notes with title, path, snippet, and TF-IDF relevance score. Use this BEFORE answering knowledge questions to ground your reply in the user's own notes.",
  {
    query: z.string().describe("Search query — single keyword or short phrase works best"),
    limit: z.number().optional().default(15).describe("Max results to return (default 15)"),
  },
  async ({ query: q, limit }) => {
    try {
      const cfg = await ensureVaultConfig();
      const trimmed = q.trim();
      if (!trimmed) return { content: [{ type: "text", text: "[]" }] };
      const queryLc = trimmed.toLowerCase();
      const queryTerms = (queryLc.match(TOKENIZE_RE) || []);
      const notes = walkVault(cfg.vaultPath);
      const scores = tfidfScore(notes, queryTerms);
      const hits = notes
        .map((n, i) => ({
          path: n.path,
          title: n.title,
          snippet: snippetFor(n.body, queryLc),
          score: Math.round(scores[i] * 100) / 100,
        }))
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
    } catch (e) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "vault_outgoing_links",
  "List the wikilinks a note links out to. Use after vault_search to follow the user's mental model from one note to related notes.",
  {
    note_path: z.string().describe("Absolute path to the note (use the path returned by vault_search)"),
  },
  async ({ note_path }) => {
    try {
      const cfg = await ensureVaultConfig();
      ensureWithinVault(cfg.vaultPath, note_path);
      const body = readFileSync(note_path, "utf-8");
      const notes = walkVault(cfg.vaultPath);
      const titleIndex = new Map(notes.map((n) => [n.title.toLowerCase(), n]));
      const seen = new Set();
      const out = [];
      let m;
      WIKILINK_RE.lastIndex = 0;
      while ((m = WIKILINK_RE.exec(body)) !== null) {
        const raw = m[1].trim();
        const key = raw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const note = titleIndex.get(key);
        out.push({ path: note ? note.path : "", title: note ? note.title : raw });
      }
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } catch (e) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "vault_backlinks",
  "List notes that link TO a given note. Use to discover where the user has referenced a topic across their second brain.",
  {
    note_path: z.string().describe("Absolute path to the target note"),
  },
  async ({ note_path }) => {
    try {
      const cfg = await ensureVaultConfig();
      ensureWithinVault(cfg.vaultPath, note_path);
      const targetTitle = basename(note_path, ".md").toLowerCase();
      if (!targetTitle) return { content: [{ type: "text", text: "[]" }] };
      const notes = walkVault(cfg.vaultPath);
      const map = buildBacklinkMap(notes);
      const idxs = map.get(targetTitle) || [];
      const out = idxs.map((i) => ({ path: notes[i].path, title: notes[i].title }));
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } catch (e) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "vault_list_orphans",
  "List notes that no other note links to. Useful for discovering forgotten or dangling content.",
  {
    limit: z.number().optional().default(50).describe("Max results (default 50)"),
  },
  async ({ limit }) => {
    try {
      const cfg = await ensureVaultConfig();
      const notes = walkVault(cfg.vaultPath);
      const map = buildBacklinkMap(notes);
      const orphans = [];
      for (const n of notes) {
        if (!map.has(n.title.toLowerCase())) {
          orphans.push({ path: n.path, title: n.title });
          if (orphans.length >= limit) break;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(orphans, null, 2) }] };
    } catch (e) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "vault_list_mocs",
  "List Maps of Content (MOCs) — notes with many outgoing links that act as the user's hub pages.",
  {
    min_links: z.number().optional().default(8).describe("Minimum outgoing wikilinks to qualify as a MOC"),
    limit: z.number().optional().default(20).describe("Max results"),
  },
  async ({ min_links, limit }) => {
    try {
      const cfg = await ensureVaultConfig();
      const notes = walkVault(cfg.vaultPath);
      const mocs = notes
        .filter((n) => n.outgoing.length >= min_links)
        .map((n) => ({ path: n.path, title: n.title, outgoingLinkCount: n.outgoing.length }))
        .sort((a, b) => b.outgoingLinkCount - a.outgoingLinkCount)
        .slice(0, limit);
      return { content: [{ type: "text", text: JSON.stringify(mocs, null, 2) }] };
    } catch (e) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "vault_stats",
  "Get aggregate statistics for the user's vault — total notes, total links, orphan count, MOC count, daily-note count.",
  {},
  async () => {
    try {
      const cfg = await ensureVaultConfig();
      const notes = walkVault(cfg.vaultPath);
      const map = buildBacklinkMap(notes);
      const totalLinks = notes.reduce((acc, n) => acc + n.outgoing.length, 0);
      const orphanCount = notes.filter((n) => !map.has(n.title.toLowerCase())).length;
      const mocCount = notes.filter((n) => n.outgoing.length >= 8).length;
      const dailyNoteCount = notes.filter((n) => /^\d{4}-\d{2}-\d{2}/.test(n.title)).length;
      const stats = {
        totalNotes: notes.length,
        totalLinks,
        orphanCount,
        mocCount,
        dailyNoteCount,
      };
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    } catch (e) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "vault_append_daily_note",
  "Append a section to the user's daily note for a given date (defaults to today). Creates the daily note if missing. Use this to log decisions, observations, or capture material the user will revisit.",
  {
    body: z.string().describe("Markdown body to append"),
    date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)"),
    section: z.string().optional().describe("Optional H2 section heading to write under (e.g. 'Captured', 'Decisions')"),
  },
  async ({ body, date, section }) => {
    try {
      const cfg = await ensureVaultConfig();
      const dateStr = (date && /^\d{4}-\d{2}-\d{2}$/.test(date))
        ? date
        : new Date().toISOString().slice(0, 10);
      const folder = join(cfg.vaultPath, "Daily");
      mkdirSync(folder, { recursive: true });
      const filePath = join(folder, `${dateStr}.md`);
      const created = !existsSync(filePath);
      let existing = created ? `# ${dateStr}\n\n` : readFileSync(filePath, "utf-8");
      if (!existing.endsWith("\n")) existing += "\n";
      const section_t = (section || "").trim();
      if (section_t && !existing.includes(`## ${section_t}`)) {
        existing += `\n## ${section_t}\n\n`;
      } else {
        existing += "\n";
      }
      existing += body.trimEnd() + "\n";
      writeFileSync(filePath, existing);
      return {
        content: [{ type: "text", text: JSON.stringify({ path: filePath, date: dateStr, created }, null, 2) }],
      };
    } catch (e) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "vault_write_meeting_note",
  "Write a structured meeting note under Meetings/ with attendees as wikilinks. Use after a meeting transcript to capture decisions and action items into the user's second brain.",
  {
    title: z.string().describe("Meeting title — becomes the filename"),
    body: z.string().describe("Markdown body — agenda, discussion, decisions, action items"),
    attendees: z.array(z.string()).optional().describe("Attendee names — each becomes a [[wikilink]]"),
  },
  async ({ title, body, attendees }) => {
    try {
      const cfg = await ensureVaultConfig();
      const trimmedTitle = title.trim();
      if (!trimmedTitle) throw new Error("Meeting title is required");
      const safe = safeFilename(trimmedTitle);
      const dateStr = new Date().toISOString().slice(0, 10);
      const folder = join(cfg.vaultPath, "Meetings");
      mkdirSync(folder, { recursive: true });
      const filePath = join(folder, `${dateStr} - ${safe}.md`);
      let md = "---\n";
      md += `title: "${trimmedTitle.replace(/"/g, "'")}"\n`;
      md += `date: "${dateStr}"\n`;
      md += `type: "meeting-note"\n`;
      if (attendees && attendees.length) {
        md += "attendees:\n";
        for (const a of attendees) md += `  - "${a.replace(/"/g, "'")}"\n`;
      }
      md += "---\n\n";
      md += `# ${trimmedTitle}\n\n`;
      if (attendees && attendees.length) {
        md += "**Attendees:** " + attendees.map((a) => `[[${a}]]`).join(", ") + "\n\n";
      }
      md += body.trimEnd() + "\n";
      writeFileSync(filePath, md);
      return {
        content: [{ type: "text", text: JSON.stringify({ path: filePath, title: trimmedTitle }, null, 2) }],
      };
    } catch (e) {
      return errorResult(e.message);
    }
  },
);

// =============================================================================
// Start
// =============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);
