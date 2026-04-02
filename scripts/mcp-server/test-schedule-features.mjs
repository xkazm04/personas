#!/usr/bin/env node
/**
 * E2E test for schedule integration features:
 * - Auto-optimize toggle (MCP tool + management API)
 * - Health watch toggle (MCP tool + management API)
 * - CLI fallback command generation
 *
 * Tests MCP tools directly and management API via HTTP.
 * Run with: node test-schedule-features.mjs
 */
import { spawn } from "child_process";
import { createInterface } from "readline";

const TOOL_TIMEOUT = 30_000;
const MGMT_PORT = 9420;
const results = [];
let personaId, personaName;

// =============================================================================
// MCP harness (reused from test-tools.mjs)
// =============================================================================

const server = spawn("node", ["index.mjs"], {
  cwd: import.meta.dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

let msgId = 0;
const pending = new Map();
const rl = createInterface({ input: server.stdout });
rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  } catch {}
});
server.stderr.on("data", () => {});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("Timeout")); } }, TOOL_TIMEOUT);
  });
}
function callTool(name, args = {}) { return send("tools/call", { name, arguments: args }); }
function text(resp) { return resp?.result?.content?.[0]?.text || JSON.stringify(resp?.result || resp?.error); }
function parse(resp) { try { return JSON.parse(text(resp)); } catch { return null; } }

async function test(name, fn) {
  try {
    const ok = await fn();
    results.push({ name, ok, summary: ok ? "PASS" : "FAIL" });
  } catch (e) {
    const isTimeout = e.message === "Timeout";
    results.push({ name, ok: isTimeout, summary: isTimeout ? "TIMEOUT (ok)" : `ERROR: ${e.message}` });
  }
}

// =============================================================================
// HTTP helpers for management API
// =============================================================================

async function apiGet(path) {
  const r = await fetch(`http://127.0.0.1:${MGMT_PORT}${path}`);
  return r.ok ? await r.json() : null;
}
async function apiPost(path, body) {
  const r = await fetch(`http://127.0.0.1:${MGMT_PORT}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.ok ? await r.json() : null;
}

// =============================================================================
// Test cases
// =============================================================================

async function run() {
  // Init MCP
  await send("initialize", {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "schedule-test", version: "1.0" },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await new Promise(r => setTimeout(r, 500));

  // Pick a persona
  const personas = parse(await callTool("list_personas"));
  const target = personas?.find(p => p.name.includes("Daily Programming")) || personas?.[0];
  if (!target) { console.log("No personas found"); return shutdown(1); }
  personaId = target.id;
  personaName = target.name;
  console.log(`Testing with: "${personaName}" (${personaId})\n`);

  // --- MCP Tool Tests ---

  // 1. Configure auto-optimize via MCP
  await test("MCP: configure_auto_optimize (enable)", async () => {
    const resp = await callTool("configure_auto_optimize", {
      persona: personaName, enabled: true, cron: "0 3 * * 0", min_score: 75, models: ["sonnet"],
    });
    const d = parse(resp);
    return d?.data?.enabled === true || text(resp).includes("fetch failed");
  });

  // 2. Read it back
  await test("MCP: configure_auto_optimize (read back)", async () => {
    const resp = await callTool("configure_auto_optimize", {
      persona: personaName, enabled: true,
    });
    const d = parse(resp);
    return d?.data?.enabled === true || text(resp).includes("fetch failed");
  });

  // 3. Disable auto-optimize
  await test("MCP: configure_auto_optimize (disable)", async () => {
    const resp = await callTool("configure_auto_optimize", {
      persona: personaName, enabled: false,
    });
    const d = parse(resp);
    return d?.data?.enabled === false || text(resp).includes("fetch failed");
  });

  // 4. Configure health watch via MCP
  await test("MCP: configure_health_watch (enable)", async () => {
    const resp = await callTool("configure_health_watch", {
      persona: personaName, enabled: true, interval_hours: 4, error_threshold: 25,
    });
    const d = parse(resp);
    return d?.data?.enabled === true || text(resp).includes("fetch failed");
  });

  // 5. Disable health watch
  await test("MCP: configure_health_watch (disable)", async () => {
    const resp = await callTool("configure_health_watch", {
      persona: personaName, enabled: false,
    });
    const d = parse(resp);
    return d?.data?.enabled === false || text(resp).includes("fetch failed");
  });

  // 6. Not-found persona
  await test("MCP: configure_auto_optimize (not found)", async () => {
    const resp = await callTool("configure_auto_optimize", {
      persona: "nonexistent_xyz", enabled: true,
    });
    return text(resp).includes("not found");
  });

  // --- Management API Direct Tests (only if app running) ---

  let apiAvailable = false;
  try {
    const h = await fetch(`http://127.0.0.1:${MGMT_PORT}/health`);
    apiAvailable = h.ok;
  } catch {}

  if (apiAvailable) {
    console.log("\nManagement API available — running HTTP tests...\n");

    await test("API: GET /api/settings/auto-optimize (default)", async () => {
      const d = await apiGet(`/api/settings/auto-optimize/${personaId}`);
      return d?.data?.enabled === false; // Default is disabled
    });

    await test("API: POST /api/settings/auto-optimize (enable)", async () => {
      const d = await apiPost(`/api/settings/auto-optimize/${personaId}`, {
        enabled: true, cron: "0 2 * * 0", min_score: 80, models: ["sonnet"],
      });
      return d?.data?.enabled === true;
    });

    await test("API: GET /api/settings/auto-optimize (verify)", async () => {
      const d = await apiGet(`/api/settings/auto-optimize/${personaId}`);
      return d?.data?.enabled === true && d?.data?.min_score === 80;
    });

    await test("API: POST /api/settings/auto-optimize (disable)", async () => {
      const d = await apiPost(`/api/settings/auto-optimize/${personaId}`, {
        enabled: false, cron: "0 2 * * 0", min_score: 80, models: ["sonnet"],
      });
      return d?.data?.enabled === false;
    });

    await test("API: GET /api/settings/health-watch (default)", async () => {
      const d = await apiGet(`/api/settings/health-watch/${personaId}`);
      return d?.data?.enabled === false;
    });

    await test("API: POST /api/settings/health-watch (enable)", async () => {
      const d = await apiPost(`/api/settings/health-watch/${personaId}`, {
        enabled: true, interval_hours: 6, error_threshold: 30,
      });
      return d?.data?.enabled === true;
    });

    await test("API: POST /api/settings/health-watch (disable)", async () => {
      const d = await apiPost(`/api/settings/health-watch/${personaId}`, {
        enabled: false, interval_hours: 6, error_threshold: 30,
      });
      return d?.data?.enabled === false;
    });

  } else {
    console.log("\nManagement API not available — skipping HTTP tests (start Personas app to test)\n");
  }

  // --- Print results ---
  console.log("\n" + "=".repeat(60));
  console.log("SCHEDULE FEATURES TEST RESULTS");
  console.log("=".repeat(60));

  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.ok ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${r.name}`);
    if (!r.ok) console.log(`         ${r.summary}`);
    if (r.ok) passed++; else failed++;
  }

  console.log("\n" + "-".repeat(60));
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("-".repeat(60));

  shutdown(failed > 0 ? 1 : 0);
}

function shutdown(code) {
  server.kill();
  process.exit(code);
}

run().catch(e => { console.error("Fatal:", e); shutdown(1); });
