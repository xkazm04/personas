#!/usr/bin/env node
/**
 * Live integration test: runs a real arena test on a persona, waits for
 * completion, then exercises improve, tag, rollback, and accept tools.
 *
 * Timeout: 300s per tool call.
 */
import { spawn } from "child_process";
import { createInterface } from "readline";

const TOOL_TIMEOUT = 300_000; // 300s

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
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  } catch {}
});

server.stderr.on("data", () => {});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout after ${TOOL_TIMEOUT / 1000}s`));
      }
    }, TOOL_TIMEOUT);
  });
}

function callTool(name, args = {}) {
  return send("tools/call", { name, arguments: args });
}

function text(resp) {
  return resp?.result?.content?.[0]?.text || JSON.stringify(resp?.result || resp?.error);
}

function parse(resp) {
  try { return JSON.parse(text(resp)); } catch { return null; }
}

function log(label, msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${label}: ${msg}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// =============================================================================

async function run() {
  // Init
  await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "live-test", version: "1.0" },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await sleep(500);

  // 1. Pick a persona
  log("STEP 1", "Listing personas...");
  const personas = parse(await callTool("list_personas"));
  if (!personas?.length) { log("ABORT", "No personas found"); return shutdown(1); }

  // Pick "Daily Programming Learner" or first available
  const target = personas.find(p => p.name.includes("Daily Programming")) || personas[0];
  log("STEP 1", `Selected: "${target.name}" (${target.id})`);

  // 2. Start arena test with Sonnet
  log("STEP 2", "Starting arena test with Sonnet...");
  const arenaResp = parse(await callTool("start_arena_test", {
    persona: target.name,
    models: [{ id: "sonnet", provider: "anthropic" }],
  }));

  if (!arenaResp?.data?.run_id) {
    log("FAIL", `Arena start failed: ${JSON.stringify(arenaResp)}`);
    return shutdown(1);
  }
  const runId = arenaResp.data.run_id;
  log("STEP 2", `Arena started: ${runId}`);

  // 3. Poll for completion
  log("STEP 3", "Waiting for arena to complete (polling every 15s, max 5min)...");
  const deadline = Date.now() + 300_000;
  let arenaStatus = "running";

  while (Date.now() < deadline) {
    await sleep(15_000);

    const runs = parse(await callTool("list_lab_runs", {
      persona: target.name,
      type: "arena",
      limit: 5,
    }));

    const thisRun = runs?.arenaRuns?.find(r => r.id === runId);
    if (thisRun) {
      arenaStatus = thisRun.status;
      log("POLL", `Status: ${arenaStatus}`);
      if (arenaStatus === "completed" || arenaStatus === "failed" || arenaStatus === "cancelled") {
        break;
      }
    } else {
      log("POLL", "Run not found in list yet...");
    }
  }

  if (arenaStatus !== "completed") {
    log("WARN", `Arena did not complete (status: ${arenaStatus}). Continuing with available tools...`);
  }

  // 4. Get arena results
  log("STEP 4", "Fetching arena results...");
  const resultsResp = await callTool("get_lab_results", { runId, type: "arena" });
  const results = parse(resultsResp);
  if (Array.isArray(results)) {
    log("STEP 4", `Got ${results.length} result(s)`);
    if (results.length > 0) {
      const r = results[0];
      log("DETAIL", `Scenario: ${r.scenario_name || "N/A"}, Score: tool=${r.tool_accuracy_score ?? "N/A"} output=${r.output_quality_score ?? "N/A"} protocol=${r.protocol_compliance_score ?? "N/A"}`);
    }
  } else {
    log("STEP 4", `Results: ${text(resultsResp).substring(0, 200)}`);
  }

  // 5. Improve prompt from arena results (this calls LLM — may take 60-120s)
  log("STEP 5", "Improving prompt from arena results (LLM call, may take 1-2 min)...");
  try {
    const improveResp = await callTool("improve_prompt_from_results", {
      persona: target.name,
      run_id: runId,
      mode: "arena",
    });
    const improved = parse(improveResp);
    if (improved?.improved) {
      log("STEP 5", `Prompt improved! Version ID: ${improved.version_id}`);
      log("PREVIEW", improved.preview?.substring(0, 150) + "...");
    } else {
      log("STEP 5", `Improvement result: ${text(improveResp).substring(0, 200)}`);
    }
  } catch (e) {
    log("STEP 5", `Improvement timed out or failed: ${e.message}`);
  }

  // 6. List prompt versions (should now have at least one)
  log("STEP 6", "Listing prompt versions...");
  const versions = parse(await callTool("list_prompt_versions", { persona: target.name }));
  if (Array.isArray(versions) && versions.length > 0) {
    log("STEP 6", `Found ${versions.length} version(s)`);
    versions.slice(0, 3).forEach(v => {
      log("VERSION", `#${v.version_number} "${v.name}" [${v.tag}] - ${v.change_summary?.substring(0, 80) || "no summary"}`);
    });

    // 7. Tag the latest version
    const latestVersion = versions[0];
    log("STEP 7", `Tagging version ${latestVersion.id} as 'experimental'...`);
    const tagResp = await callTool("tag_prompt_version", {
      version_id: latestVersion.id,
      tag: "experimental",
    });
    log("STEP 7", text(tagResp).substring(0, 150));

    // 8. Rollback (tag as production)
    if (versions.length > 1) {
      const olderVersion = versions[1];
      log("STEP 8", `Rolling back to version ${olderVersion.id}...`);
      const rollbackResp = await callTool("rollback_prompt_version", {
        version_id: olderVersion.id,
      });
      log("STEP 8", text(rollbackResp).substring(0, 150));
    } else {
      log("STEP 8", "SKIP: only 1 version, cannot rollback");
    }
  } else {
    log("STEP 6", "No versions found (improvement may not have created one)");
  }

  // 9. Get persona health after all operations
  log("STEP 9", "Getting persona health after test...");
  const health = parse(await callTool("get_persona_health", { persona: target.name }));
  if (health) {
    log("HEALTH", `Executions: ${JSON.stringify(health.recentExecutions)}`);
    log("HEALTH", `Monthly spend: $${health.monthlySpendUsd}`);
    log("HEALTH", `Healing issues: ${health.activeHealingIssues?.length || 0}`);
    log("HEALTH", `Assertions: ${health.assertions?.length || 0}`);
  }

  // 10. Get execution detail for the persona run we triggered
  log("STEP 10", "Listing recent executions for this persona...");
  const recentExecs = parse(await callTool("list_executions", {
    persona: target.name,
    limit: 3,
  }));
  if (Array.isArray(recentExecs) && recentExecs.length > 0) {
    log("STEP 10", `Found ${recentExecs.length} execution(s)`);
    recentExecs.forEach(e => {
      log("EXEC", `${e.id.substring(0, 8)}... ${e.status} ${e.durationMs ? (e.durationMs/1000).toFixed(1)+"s" : "-"} $${e.costUsd?.toFixed(4) || "0"} ${e.model || "-"}`);
    });
  }

  // 11. System overview after everything
  log("STEP 11", "Final system overview...");
  const overview = parse(await callTool("get_system_overview"));
  if (overview) {
    log("OVERVIEW", `Personas: ${overview.personas?.total}, Creds: ${overview.credentials}, Triggers: ${overview.activeTriggers}`);
    log("OVERVIEW", `24h executions: ${JSON.stringify(overview.last24Hours?.executions)}, Cost: $${overview.last24Hours?.totalCostUsd?.toFixed(4)}`);
  }

  log("DONE", "All live integration tests completed.");
  shutdown(0);
}

function shutdown(code) {
  server.kill();
  process.exit(code);
}

run().catch((e) => {
  console.error("Fatal:", e);
  shutdown(1);
});
