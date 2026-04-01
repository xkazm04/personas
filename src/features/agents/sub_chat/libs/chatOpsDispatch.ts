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

import { invokeWithTimeout } from "@/lib/tauriInvoke";

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

/** Extract operation JSON objects from assistant response text (deduplicated). */
export function extractOperations(text: string): OpsOperation[] {
  const ops: OpsOperation[] = [];
  const seen = new Set<string>();
  let inCodeBlock = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) { inCodeBlock = !inCodeBlock; continue; }
    if (!trimmed.startsWith('{"op"')) continue;
    // Deduplicate identical operation lines
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
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
        // Health check uses last_design_result (richer agent IR) or design_context as fallback
        const persona = await invokeWithTimeout<{
          design_context?: string | null;
          last_design_result?: string | null;
          name?: string;
          enabled?: boolean;
          system_prompt?: string;
        }>("get_persona", { id: personaId });
        const designResult = persona.last_design_result || persona.design_context || "{}";

        // Run feasibility check
        const result = await invokeWithTimeout<{ status: string; confirmed_capabilities?: string[]; issues?: { description: string; severity: string }[] }>(
          "test_design_feasibility",
          { designResult },
        );
        const issues = result.issues ?? [];
        const caps = result.confirmed_capabilities ?? [];

        // Build a richer summary with persona state
        const statusLine = `Health: ${result.status}`;
        const capsLine = caps.length > 0 ? `Capabilities: ${caps.join(", ")}` : "No capabilities confirmed";
        const issuesLines = issues.length > 0
          ? issues.map((i) => `[${i.severity}] ${i.description}`).join("\n")
          : "No issues found.";
        const enabledLine = `Agent enabled: ${persona.enabled ?? "unknown"}`;
        const promptLine = persona.system_prompt ? `Prompt length: ${persona.system_prompt.length} chars` : "No system prompt";

        return {
          op: "health_check",
          success: true,
          summary: `${statusLine} — ${caps.length} capabilities, ${issues.length} issues`,
          detail: `${enabledLine}\n${promptLine}\n${capsLine}\n\nIssues:\n${issuesLines}`,
        };
      }

      case "list_executions": {
        const limit = typeof op.limit === "number" ? op.limit : 5;
        const execs = await invokeWithTimeout<{ id: string; status: string; started_at: string; duration_ms?: number; cost_usd?: number }[]>(
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
        const assertions = await invokeWithTimeout<{ id: string; name: string; assertion_type: string; severity: string; enabled: boolean }[]>(
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
        const memories = await invokeWithTimeout<{ title: string; category: string; importance: number; created_at: string }[]>(
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
        const versions = await invokeWithTimeout<{ id: string; tag?: string; created_at: string; change_summary?: string }[]>(
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
        await invokeWithTimeout("execute_persona", {
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
        const persona = await invokeWithTimeout<{ structured_prompt?: string | null }>("get_persona", { id: personaId });
        const sp = persona.structured_prompt ? JSON.parse(persona.structured_prompt) : {};
        sp[section] = content;
        await invokeWithTimeout("update_persona", {
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
        await invokeWithTimeout("create_output_assertion", {
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
        await invokeWithTimeout("lab_start_arena", { personaId, models: modelConfigs, useCaseFilter: null });
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
        await invokeWithTimeout("lab_start_matrix", { personaId, userInstruction: instruction, models, useCaseFilter: null });
        return { op: "start_matrix", success: true, summary: `Matrix improvement started: "${instruction.slice(0, 60)}..."` };
      }

      case "list_reviews": {
        const status = typeof op.status === "string" ? op.status : "pending";
        const reviews = await invokeWithTimeout<Array<{
          id: string; title: string; description: string | null; severity: string;
          status: string; context_data: string | null; suggested_actions: string | null;
          created_at: string; execution_id: string;
        }>>("list_manual_reviews", { personaId, status: status === "all" ? null : status });
        if (reviews.length === 0) {
          return { op: "list_reviews", success: true, summary: `No ${status === "all" ? "" : status + " "}reviews found.` };
        }
        const rows = reviews.map((r) => {
          const time = new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          const sev = r.severity === "critical" ? "\u{1F534}" : r.severity === "warning" ? "\u{1F7E1}" : "\u{1F535}";
          const desc = r.description ? r.description.slice(0, 80) : "No description";
          return { id: r.id, sev, title: r.title, desc, status: r.status, time };
        });
        const detail = rows.map((r) =>
          `${r.sev} **${r.title}** (\`${r.id.slice(0, 8)}\`)\n  ${r.desc}\n  Status: ${r.status} | ${r.time}`
        ).join("\n\n");
        return {
          op: "list_reviews",
          success: true,
          summary: `${reviews.length} ${status === "all" ? "" : status + " "}review(s):`,
          detail,
        };
      }

      case "get_review": {
        const reviewId = typeof op.id === "string" ? op.id : "";
        if (!reviewId) return { op: "get_review", success: false, summary: "Missing review id." };
        // Find the review from the list (no dedicated get endpoint, filter from list)
        const allReviews = await invokeWithTimeout<Array<{
          id: string; title: string; description: string | null; severity: string;
          status: string; context_data: string | null; suggested_actions: string | null;
          reviewer_notes: string | null; created_at: string;
        }>>("list_manual_reviews", { personaId, status: null });
        const review = allReviews.find((r) => r.id === reviewId || r.id.startsWith(reviewId));
        if (!review) return { op: "get_review", success: false, summary: `Review "${reviewId}" not found.` };
        const parts = [
          `**${review.title}** | ${review.severity} | ${review.status}`,
          review.description ? `\n${review.description}` : "",
          review.context_data ? `\n\n**Context:**\n\`\`\`\n${review.context_data.slice(0, 500)}\n\`\`\`` : "",
          review.suggested_actions ? `\n\n**Suggested actions:** ${review.suggested_actions}` : "",
          review.reviewer_notes ? `\n\n**Reviewer notes:** ${review.reviewer_notes}` : "",
        ];
        return { op: "get_review", success: true, summary: parts.join("") };
      }

      case "approve_review":
      case "reject_review": {
        const reviewId = typeof op.id === "string" ? op.id : "";
        if (!reviewId) return { op: op.op, success: false, summary: "Missing review id." };
        const newStatus = op.op === "approve_review" ? "approved" : "rejected";
        const notes = typeof op.notes === "string" ? op.notes : undefined;
        await invokeWithTimeout("update_manual_review_status", {
          id: reviewId, status: newStatus, reviewerNotes: notes ?? null,
        });
        return {
          op: op.op, success: true,
          summary: `Review \`${reviewId.slice(0, 8)}\` ${newStatus}${notes ? ` — "${notes}"` : ""}.`,
        };
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

/** Format operation results as rich markdown for display in chat. */
export function formatResults(results: OpsResult[]): string {
  if (results.length === 0) return "";
  return results.map((r) => formatOneResult(r)).join("\n\n---\n\n");
}

function formatOneResult(r: OpsResult): string {
  const icon = r.success ? "\u2705" : "\u274c";
  const header = `${icon} **${friendlyOpName(r.op)}**`;

  // Render per-operation with tailored formatting
  switch (r.op) {
    case "list_executions":
      return r.detail ? `${header}\n\n${formatExecutionTable(r.detail)}` : `${header}: ${r.summary}`;
    case "health_check":
      return r.detail ? `${header}\n\n${formatHealthCard(r.summary, r.detail)}` : `${header}: ${r.summary}`;
    case "list_memories":
      return r.detail ? `${header}\n\n${formatMemoryList(r.detail)}` : `${header}: ${r.summary}`;
    case "list_versions":
      return r.detail ? `${header}\n\n${formatVersionList(r.detail)}` : `${header}: ${r.summary}`;
    case "list_reviews":
      return r.detail ? `${header} — ${r.summary}\n\n${r.detail}` : `${header}: ${r.summary}`;
    case "get_review":
    case "approve_review":
    case "reject_review":
      return `${header}: ${r.summary}`;
    default:
      return r.detail ? `${header}: ${r.summary}\n\n\`\`\`\n${r.detail}\n\`\`\`` : `${header}: ${r.summary}`;
  }
}

function friendlyOpName(op: string): string {
  const names: Record<string, string> = {
    list_executions: "Recent Executions",
    health_check: "Health Check",
    list_memories: "Agent Memories",
    list_versions: "Prompt Versions",
    list_assertions: "Assertions",
    list_reviews: "Pending Reviews",
    get_review: "Review Detail",
    approve_review: "Approve Review",
    reject_review: "Reject Review",
    execute: "Execute",
    edit_prompt: "Edit Prompt",
    start_arena: "Arena Test",
    start_matrix: "Matrix Improvement",
    create_assertion: "Create Assertion",
  };
  return names[op] ?? op;
}

/** Convert execution list detail into a markdown table. */
function formatExecutionTable(detail: string): string {
  const lines = detail.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return `\`\`\`\n${detail}\n\`\`\``;

  // Parse header + data rows from the padded text format
  const rows: string[][] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length >= 3) rows.push(parts);
  }
  if (rows.length < 2) return `\`\`\`\n${detail}\n\`\`\``;

  // First row is header
  const header = rows[0]!;
  const data = rows.slice(1);
  const md = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...data.map((r) => `| ${r.join(" | ")} |`),
  ];
  return md.join("\n");
}

/** Format health check as a structured card. */
function formatHealthCard(summary: string, detail: string): string {
  const lines = detail.split("\n").filter((l) => l.trim());
  const parts: string[] = [`> ${summary}`];

  for (const line of lines) {
    if (line.startsWith("Agent enabled:")) parts.push(`- **Status**: ${line.replace("Agent enabled: ", "")}`);
    else if (line.startsWith("Prompt length:")) parts.push(`- **Prompt**: ${line.replace("Prompt length: ", "")}`);
    else if (line.startsWith("Capabilities:")) parts.push(`- **Capabilities**: ${line.replace("Capabilities: ", "")}`);
    else if (line.startsWith("[")) parts.push(`- \u26A0\uFE0F ${line}`);
    else if (line === "No issues found.") parts.push(`- \u2705 No issues found`);
  }
  return parts.join("\n");
}

/** Format memories as a bulleted list with category badges. */
function formatMemoryList(detail: string): string {
  const lines = detail.split("\n").filter((l) => l.trim());
  return lines
    .map((l) => {
      const match = l.trim().match(/^\[([^\]]+)\]\s*(.*)/);
      if (match) return `- **\`${match[1]}\`** ${match[2]}`;
      return `- ${l.trim()}`;
    })
    .join("\n");
}

/** Format versions as a timeline list. */
function formatVersionList(detail: string): string {
  const lines = detail.split("\n").filter((l) => l.trim());
  return lines
    .map((l) => {
      const match = l.trim().match(/^(\w+ \d+)(.*)/);
      if (match) return `- **${match[1]}**${match[2]}`;
      return `- ${l.trim()}`;
    })
    .join("\n");
}
