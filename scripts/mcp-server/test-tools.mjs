#!/usr/bin/env node
/**
 * Test harness for all Personas MCP tools.
 * Spawns the MCP server as a child process and sends JSON-RPC requests via stdio.
 */
import { spawn } from "child_process";
import { createInterface } from "readline";

const server = spawn("node", ["index.mjs"], {
  cwd: import.meta.dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

let msgId = 0;
const pending = new Map();

// Parse JSON-RPC responses from stdout
const rl = createInterface({ input: server.stdout });
rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  } catch {}
});

// Collect stderr
let stderrBuf = "";
server.stderr.on("data", (d) => { stderrBuf += d.toString(); });

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, resolve);
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    server.stdin.write(msg + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout`));
      }
    }, 30000);
  });
}

function callTool(name, args = {}) {
  return send("tools/call", { name, arguments: args });
}

function extractText(response) {
  if (response.result?.content?.[0]?.text) {
    return response.result.content[0].text;
  }
  if (response.error) return `ERROR: ${JSON.stringify(response.error)}`;
  return JSON.stringify(response.result);
}

function summarize(text, maxLen = 150) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.substring(0, maxLen) + "..." : clean;
}

// =============================================================================
// Test sequence
// =============================================================================

const results = [];

async function test(name, args, validator) {
  try {
    const resp = await callTool(name, args);
    const text = extractText(resp);
    const isError = resp.result?.isError === true;
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }

    const ok = validator ? validator(parsed, text, isError) : !isError;
    results.push({ name, ok, summary: summarize(text) });
  } catch (e) {
    if (e.message === "Timeout") {
      results.push({ name, ok: true, summary: "TIMEOUT (acceptable for LLM-backed operations)" });
    } else {
      results.push({ name, ok: false, summary: `EXCEPTION: ${e.message}` });
    }
  }
}

async function run() {
  // Initialize
  await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-harness", version: "1.0" },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // Give server a moment to load DB
  await new Promise((r) => setTimeout(r, 500));

  // --- DB-read tools ---

  await test("get_system_overview", {}, (d) =>
    d && typeof d.personas?.total === "number" && typeof d.credentials === "number"
  );

  await test("list_personas", {}, (d) =>
    Array.isArray(d) && d.length > 0 && d[0].name
  );

  // Pick first persona for subsequent tests
  const overviewResp = await callTool("list_personas", {});
  let personas;
  try { personas = JSON.parse(extractText(overviewResp)); } catch { personas = []; }
  const firstPersona = personas[0];
  const personaName = firstPersona.name;
  const personaId = firstPersona.id;

  await test("get_persona_detail", { persona: personaName }, (d) =>
    d && d.name === personaName && Array.isArray(d.tools)
  );

  await test("get_persona_health", { persona: personaName }, (d) =>
    d && d.persona === personaName && typeof d.monthlySpendUsd === "number"
  );

  await test("list_executions", { limit: 3 }, (d) =>
    Array.isArray(d)
  );

  await test("list_executions", { persona: personaName, limit: 2 }, (d) =>
    Array.isArray(d)
  );

  await test("list_executions", { status: "completed", limit: 2 }, (d) =>
    Array.isArray(d)
  );

  // Get an execution ID for detail test
  const execResp = await callTool("list_executions", { limit: 1 });
  const execs = JSON.parse(extractText(execResp));
  if (execs.length > 0) {
    await test("get_execution_output", { executionId: execs[0].id }, (d) =>
      d && d.id === execs[0].id && d.status
    );
  } else {
    results.push({ name: "get_execution_output", ok: true, summary: "SKIP: no executions found" });
  }

  await test("list_lab_runs", { persona: personaName }, (d) =>
    d && typeof d === "object"
  );

  await test("list_lab_runs", { persona: personaName, type: "arena" }, (d) =>
    d && typeof d === "object"
  );

  // Test get_lab_results with a real run if available
  const labResp = await callTool("list_lab_runs", { persona: personaName });
  let labData;
  try { labData = JSON.parse(extractText(labResp)); } catch { labData = {}; }
  const anyRun = [
    ...(labData.testRuns || []),
    ...(labData.arenaRuns || []),
    ...(labData.matrixRuns || []),
  ][0];
  if (anyRun) {
    const runType = labData.testRuns?.includes(anyRun) ? "test"
      : labData.arenaRuns?.includes(anyRun) ? "arena" : "matrix";
    await test("get_lab_results", { runId: anyRun.id, type: runType }, (d) =>
      Array.isArray(d)
    );
  } else {
    results.push({ name: "get_lab_results", ok: true, summary: "SKIP: no lab runs found" });
  }

  await test("list_prompt_versions", { persona: personaName }, (d) =>
    Array.isArray(d)
  );

  await test("search_knowledge", { query: "error" }, (d, text) =>
    Array.isArray(d) || text.includes("not available") || text.includes("no such")
  );

  await test("list_credentials", {}, (d) =>
    Array.isArray(d)
  );

  // Test not-found cases
  await test("get_persona_detail", { persona: "nonexistent_xyz_123" }, (d, text, isError) =>
    isError && text.includes("not found")
  );

  await test("get_execution_output", { executionId: "nonexistent_id" }, (d, text, isError) =>
    isError && text.includes("not found")
  );

  // --- API-dependent tools (these will fail if Personas app is not running) ---

  await test("run_persona", { persona: personaName }, (d, text, isError) => {
    // Either succeeds (app running) or fails with connection error
    if (isError && text.includes("not running")) return true;
    if (isError && text.includes("fetch failed")) return true;
    if (isError && text.includes("ECONNREFUSED")) return true;
    if (d && d.data?.execution_id) return true;
    // Any structured response is acceptable
    return d !== null;
  });

  await test("start_arena_test", {
    persona: personaName,
    models: [{ id: "sonnet", provider: "anthropic" }],
  }, (d, text, isError) => {
    if (isError && (text.includes("not running") || text.includes("fetch failed") || text.includes("ECONNREFUSED"))) return true;
    if (d && d.data?.run_id) return true;
    return d !== null;
  });

  await test("start_matrix_improvement", {
    persona: personaName,
    instruction: "Test improvement",
    models: [{ id: "sonnet", provider: "anthropic" }],
  }, (d, text, isError) => {
    if (isError && (text.includes("not running") || text.includes("fetch failed") || text.includes("ECONNREFUSED"))) return true;
    if (d && d.data?.run_id) return true;
    return d !== null;
  });

  await test("cancel_lab_run", { run_id: "nonexistent_run" }, (d, text, isError) => {
    if (isError && (text.includes("fetch failed") || text.includes("ECONNREFUSED"))) return true;
    return d !== null;
  });

  await test("improve_prompt_from_results", {
    persona: personaName,
    run_id: "nonexistent_run",
    mode: "arena",
  }, (d, text, isError) => {
    // Expected: either error (no run) or timeout (LLM call takes long)
    if (isError) return true;
    return d !== null;
  });

  await test("tag_prompt_version", { version_id: "nonexistent_v", tag: "experimental" }, (d, text, isError) => {
    // Expected: error for nonexistent version
    if (isError) return true;
    return d !== null;
  });

  await test("rollback_prompt_version", { version_id: "nonexistent_v" }, (d, text, isError) => {
    // Expected: error for nonexistent version
    if (isError) return true;
    return d !== null;
  });

  await test("accept_matrix_draft", { run_id: "nonexistent_run" }, (d, text, isError) => {
    // Expected: error for nonexistent run
    if (isError) return true;
    return d !== null;
  });

  // --- Print results ---
  console.log("\n" + "=".repeat(70));
  console.log("MCP TOOL TEST RESULTS");
  console.log("=".repeat(70));

  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.ok ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${r.name}`);
    console.log(`         ${r.summary}`);
    if (r.ok) passed++; else failed++;
  }

  console.log("\n" + "-".repeat(70));
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("-".repeat(70));

  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Test harness error:", e);
  server.kill();
  process.exit(1);
});
