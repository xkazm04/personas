/**
 * Operations Assistant — Parse and dispatch operations from assistant output.
 *
 * The ops assistant outputs JSON operation lines like:
 *   {"op": "health_check"}
 *   {"op": "list_executions", "limit": 5}
 *
 * This module extracts those lines, dispatches them to Tauri commands,
 * and returns formatted result strings for display in chat.
 */

import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────

export interface OpsOperation {
  op: string;
  [key: string]: unknown;
}

export interface OpsResult {
  op: string;
  success: boolean;
  summary: string;
  detail?: string;
}

// ── Extraction ─────────────────────────────────────────────────────────

/** Extract operation JSON objects from assistant response text. */
export function extractOperations(text: string): OpsOperation[] {
  const ops: OpsOperation[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{"op":') && !trimmed.startsWith('{"op" :')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.op === "string") {
        ops.push(parsed);
      }
    } catch {
      // Not valid JSON — skip
    }
  }
  return ops;
}

// ── Dispatch ───────────────────────────────────────────────────────────

/** Dispatch a single operation to the appropriate Tauri command. */
async function dispatchOne(op: OpsOperation, personaId: string): Promise<OpsResult> {
  try {
    switch (op.op) {
      case "health_check": {
        // Health check uses design_context from the persona
        const persona = await invoke<{ design_context?: string | null }>("get_persona", { id: personaId });
        const designResult = persona.design_context || "{}";
        const result = await invoke<{ status: string; confirmed_capabilities?: string[]; issues?: { description: string; severity: string }[] }>(
          "test_design_feasibility",
          { designResult },
        );
        const issues = result.issues ?? [];
        const caps = result.confirmed_capabilities ?? [];
        return {
          op: "health_check",
          success: true,
          summary: `Health: ${result.status} — ${caps.length} capabilities confirmed, ${issues.length} issues found`,
          detail: issues.length > 0
            ? issues.map((i) => `[${i.severity}] ${i.description}`).join("\n")
            : "No issues found.",
        };
      }

      case "list_executions": {
        const limit = typeof op.limit === "number" ? op.limit : 5;
        const execs = await invoke<{ id: string; status: string; started_at: string; duration_ms?: number; cost_usd?: number }[]>(
          "list_executions",
          { personaId, limit },
        );
        if (execs.length === 0) {
          return { op: "list_executions", success: true, summary: "No executions found." };
        }
        const rows = execs.map((e) => {
          const dur = e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : "—";
          const cost = e.cost_usd ? `$${e.cost_usd.toFixed(4)}` : "—";
          const time = new Date(e.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return `  ${e.status.padEnd(10)} ${dur.padEnd(8)} ${cost.padEnd(10)} ${time}`;
        });
        return {
          op: "list_executions",
          success: true,
          summary: `Last ${execs.length} executions:`,
          detail: `  ${"Status".padEnd(10)} ${"Duration".padEnd(8)} ${"Cost".padEnd(10)} Time\n${rows.join("\n")}`,
        };
      }

      case "list_assertions": {
        const assertions = await invoke<{ id: string; name: string; assertion_type: string; severity: string; enabled: boolean }[]>(
          "list_output_assertions",
          { personaId },
        );
        if (assertions.length === 0) {
          return { op: "list_assertions", success: true, summary: "No assertions configured." };
        }
        const rows = assertions.map((a) => `  ${a.enabled ? "ON " : "OFF"} [${a.severity}] ${a.name} (${a.assertion_type})`);
        return {
          op: "list_assertions",
          success: true,
          summary: `${assertions.length} assertion(s):`,
          detail: rows.join("\n"),
        };
      }

      case "list_memories": {
        const limit = typeof op.limit === "number" ? op.limit : 5;
        const memories = await invoke<{ title: string; category: string; importance: number; created_at: string }[]>(
          "list_memories",
          { personaId, limit },
        );
        if (memories.length === 0) {
          return { op: "list_memories", success: true, summary: "No memories stored." };
        }
        const rows = memories.map((m) => `  [${m.category}:${m.importance}] ${m.title}`);
        return { op: "list_memories", success: true, summary: `${memories.length} memories:`, detail: rows.join("\n") };
      }

      case "list_versions": {
        const limit = typeof op.limit === "number" ? op.limit : 5;
        const versions = await invoke<{ id: string; tag?: string; created_at: string; change_summary?: string }[]>(
          "lab_get_versions",
          { personaId, limit },
        );
        if (versions.length === 0) {
          return { op: "list_versions", success: true, summary: "No prompt versions." };
        }
        const rows = versions.map((v) => {
          const tag = v.tag ? ` [${v.tag}]` : "";
          const time = new Date(v.created_at).toLocaleString([], { month: "short", day: "numeric" });
          return `  ${time}${tag} — ${v.change_summary?.slice(0, 60) ?? "no summary"}`;
        });
        return { op: "list_versions", success: true, summary: `${versions.length} versions:`, detail: rows.join("\n") };
      }

      case "execute": {
        const inputData = typeof op.input === "string" ? op.input : undefined;
        await invoke("execute_persona", {
          personaId,
          triggerId: null,
          inputData: inputData ?? null,
          useCaseId: null,
          continuation: null,
        });
        return { op: "execute", success: true, summary: "Execution started. Output will stream in the next message." };
      }

      case "edit_prompt": {
        const section = typeof op.section === "string" ? op.section : "";
        const content = typeof op.content === "string" ? op.content : "";
        if (!section || !content) {
          return { op: "edit_prompt", success: false, summary: "Missing section or content." };
        }
        // Get current structured_prompt, update the section, save
        const persona = await invoke<{ structured_prompt?: string | null }>("get_persona", { id: personaId });
        const sp = persona.structured_prompt ? JSON.parse(persona.structured_prompt) : {};
        sp[section] = content;
        await invoke("update_persona", {
          id: personaId,
          input: { structured_prompt: JSON.stringify(sp) },
        });
        return { op: "edit_prompt", success: true, summary: `Updated "${section}" section (${content.length} chars).` };
      }

      case "create_assertion": {
        const name = typeof op.name === "string" ? op.name : "Untitled";
        const assertionType = typeof op.assertion_type === "string" ? op.assertion_type : "contains";
        const config = typeof op.config === "string" ? op.config : JSON.stringify(op.config ?? {});
        const severity = typeof op.severity === "string" ? op.severity : "warning";
        await invoke("create_output_assertion", {
          personaId,
          name,
          description: null,
          assertionType,
          config,
          severity,
          onFailure: "log",
        });
        return { op: "create_assertion", success: true, summary: `Created assertion "${name}" [${severity}] (${assertionType}).` };
      }

      case "start_arena": {
        const models = Array.isArray(op.models) ? op.models : [{ id: "haiku" }, { id: "sonnet" }];
        const modelConfigs = models.map((m: unknown) =>
          typeof m === "string" ? { id: m, model: `claude-${m}-4-5`, provider: "anthropic" } : m,
        );
        await invoke("lab_start_arena", { personaId, models: modelConfigs, useCaseFilter: null });
        return { op: "start_arena", success: true, summary: `Arena test started with ${modelConfigs.length} models.` };
      }

      case "start_matrix": {
        const instruction = typeof op.instruction === "string" ? op.instruction : "";
        if (!instruction) {
          return { op: "start_matrix", success: false, summary: "Missing instruction for matrix improvement." };
        }
        const models = [
          { id: "haiku", model: "claude-haiku-4-5", provider: "anthropic" },
          { id: "sonnet", model: "claude-sonnet-4-6", provider: "anthropic" },
        ];
        await invoke("lab_start_matrix", { personaId, userInstruction: instruction, models, useCaseFilter: null });
        return { op: "start_matrix", success: true, summary: `Matrix improvement started: "${instruction.slice(0, 60)}..."` };
      }

      default:
        return { op: op.op, success: false, summary: `Unknown operation: ${op.op}` };
    }
  } catch (err) {
    return {
      op: op.op,
      success: false,
      summary: `Operation "${op.op}" failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Dispatch all extracted operations and return formatted results. */
export async function dispatchOperations(ops: OpsOperation[], personaId: string): Promise<OpsResult[]> {
  const results: OpsResult[] = [];
  for (const op of ops) {
    results.push(await dispatchOne(op, personaId));
  }
  return results;
}

/** Format operation results as a readable text block for display in chat. */
export function formatResults(results: OpsResult[]): string {
  if (results.length === 0) return "";
  return results
    .map((r) => {
      const icon = r.success ? "\u2705" : "\u274c";
      let text = `${icon} **${r.op}**: ${r.summary}`;
      if (r.detail) text += `\n\`\`\`\n${r.detail}\n\`\`\``;
      return text;
    })
    .join("\n\n");
}
