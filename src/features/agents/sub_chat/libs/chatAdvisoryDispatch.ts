/**
 * Advisory Assistant — Parse and dispatch operations from assistant output.
 *
 * The advisory assistant outputs JSON operation lines like:
 *   {"op": "health_check"}
 *   {"op": "start_experiment", "hypothesis": "...", "instruction": "..."}
 *
 * This module extracts those lines, dispatches them to Tauri commands,
 * and returns formatted result strings for display in chat.
 *
 * Operations are grouped into three categories:
 *   - Diagnostic: read-only queries for analysis (health, executions, knowledge, etc.)
 *   - Experiment: start lab tests to validate improvement hypotheses
 *   - Change: propose and apply persona modifications with risk classification
 */

import { invokeWithTimeout } from "@/lib/tauriInvoke";

// ── Types ──────────────────────────────────────────────────────────────

export interface AdvisoryOperation {
  op: string;
  [key: string]: unknown;
}

export interface AdvisoryResult {
  op: string;
  success: boolean;
  summary: string;
  detail?: string;
  /** For experiment operations, the run_id that can be tracked async */
  experimentRunId?: string;
}

// ── Extraction ─────────────────────────────────────────────────────────

/**
 * Sanitize a JSON string that may contain raw control characters inside string values.
 * LLMs sometimes emit literal newlines/tabs inside JSON string fields instead of
 * proper escape sequences (\n, \t). This breaks JSON.parse.
 */
function sanitizeJsonString(raw: string): string {
  // Replace raw control characters (0x00-0x1F) that appear inside JSON string values
  // with their proper escape sequences. This handles the common LLM issue of
  // emitting real newlines instead of \n in long content fields.
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = raw.charCodeAt(i);
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && code < 0x20) {
      // Replace control character with escape sequence
      if (code === 0x0a) result += "\\n";
      else if (code === 0x0d) result += "\\r";
      else if (code === 0x09) result += "\\t";
      else result += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    result += ch;
  }
  return result;
}

/** Extract operation JSON objects from assistant response text (deduplicated). */
export function extractOperations(text: string): AdvisoryOperation[] {
  const ops: AdvisoryOperation[] = [];
  const seen = new Set<string>();
  let inCodeBlock = false;

  // Multi-line JSON accumulator: when a line starts with {"op" but doesn't parse,
  // it may span multiple lines (LLM emitted raw newlines in the content field).
  let accumulator = "";

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) { inCodeBlock = !inCodeBlock; accumulator = ""; continue; }
    if (inCodeBlock) continue;

    // Start accumulating if this line begins an operation
    if (trimmed.startsWith('{"op"') || trimmed.startsWith('{"op":')) {
      accumulator = trimmed;
    } else if (accumulator) {
      // Continue accumulating a multi-line JSON operation
      accumulator += "\\n" + trimmed;
    } else {
      continue;
    }

    // Try to parse the accumulated JSON
    const dedupKey = accumulator.slice(0, 200); // Dedup on first 200 chars (content may vary)
    try {
      const parsed = JSON.parse(accumulator);
      if (parsed && typeof parsed.op === "string" && !seen.has(dedupKey)) {
        seen.add(dedupKey);
        ops.push(parsed);
      }
      accumulator = "";
    } catch {
      // JSON incomplete — try sanitizing control characters
      try {
        const sanitized = sanitizeJsonString(accumulator);
        const parsed = JSON.parse(sanitized);
        if (parsed && typeof parsed.op === "string" && !seen.has(dedupKey)) {
          seen.add(dedupKey);
          ops.push(parsed);
        }
        accumulator = "";
      } catch {
        // Still can't parse — keep accumulating (multi-line JSON)
        // But cap accumulator to prevent unbounded growth
        if (accumulator.length > 50000) {
          console.warn("[advisory] Dropping unparseable operation (>50KB):", accumulator.slice(0, 100));
          accumulator = "";
        }
      }
    }
  }

  return ops;
}

// ── Dispatch ───────────────────────────────────────────────────────────

/** Dispatch a single operation to the appropriate Tauri command. */
async function dispatchOne(op: AdvisoryOperation, personaId: string): Promise<AdvisoryResult> {
  try {
    switch (op.op) {
      // ── Diagnostic Operations ──────────────────────────────────────

      case "health_check": {
        const persona = await invokeWithTimeout<{
          design_context?: string | null;
          last_design_result?: string | null;
          name?: string;
          enabled?: boolean;
          system_prompt?: string;
        }>("get_persona", { id: personaId });
        const designResult = persona.last_design_result || persona.design_context || "{}";
        const result = await invokeWithTimeout<{
          status: string;
          confirmed_capabilities?: string[];
          issues?: { description: string; severity: string }[];
        }>("test_design_feasibility", { designResult });
        const issues = result.issues ?? [];
        const caps = result.confirmed_capabilities ?? [];
        const statusLine = `Health: ${result.status}`;
        const capsLine = caps.length > 0 ? `Capabilities: ${caps.join(", ")}` : "No capabilities confirmed";
        const issuesLines = issues.length > 0
          ? issues.map((i) => `- [${i.severity}] ${i.description}`).join("\n")
          : "No issues found.";
        return {
          op: "health_check",
          success: true,
          summary: `${statusLine} — ${caps.length} capabilities, ${issues.length} issues`,
          detail: `Agent: ${persona.name} (${persona.enabled ? "active" : "disabled"})\n${capsLine}\n\n**Issues:**\n${issuesLines}`,
        };
      }

      case "list_executions": {
        const limit = typeof op.limit === "number" ? op.limit : 10;
        const execs = await invokeWithTimeout<{
          id: string; status: string; started_at: string;
          duration_ms?: number; cost_usd?: number; error_message?: string;
        }[]>("list_executions", { personaId, limit });
        if (execs.length === 0) {
          return { op: "list_executions", success: true, summary: "No executions found." };
        }
        const rows = execs.map((e) => {
          const dur = e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : "-";
          const cost = e.cost_usd ? `$${e.cost_usd.toFixed(4)}` : "-";
          const time = new Date(e.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          const err = e.error_message ? ` | ${e.error_message.slice(0, 60)}` : "";
          return `| ${e.status} | ${dur} | ${cost} | ${time}${err} |`;
        });
        return {
          op: "list_executions",
          success: true,
          summary: `Last ${execs.length} executions`,
          detail: `| Status | Duration | Cost | Time |\n| --- | --- | --- | --- |\n${rows.join("\n")}`,
        };
      }

      case "list_assertions": {
        const assertions = await invokeWithTimeout<{
          id: string; name: string; assertion_type: string;
          severity: string; enabled: boolean; pass_count: number; fail_count: number;
        }[]>("list_output_assertions", { personaId });
        if (assertions.length === 0) {
          return { op: "list_assertions", success: true, summary: "No assertions configured." };
        }
        const rows = assertions.map((a) => {
          const total = a.pass_count + a.fail_count;
          const rate = total > 0 ? `${Math.round(a.pass_count / total * 100)}%` : "N/A";
          return `| ${a.enabled ? "ON" : "OFF"} | ${a.name} | ${a.assertion_type} | ${a.severity} | ${rate} |`;
        });
        return {
          op: "list_assertions",
          success: true,
          summary: `${assertions.length} assertion(s)`,
          detail: `| Status | Name | Type | Severity | Pass Rate |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}`,
        };
      }

      case "list_memories": {
        const limit = typeof op.limit === "number" ? op.limit : 10;
        const memories = await invokeWithTimeout<{
          title: string; category: string; importance: number; tier: string; created_at: string;
        }[]>("list_memories", { personaId, limit });
        if (memories.length === 0) {
          return { op: "list_memories", success: true, summary: "No memories stored." };
        }
        const rows = memories.map((m) =>
          `- **[${m.tier}/${m.category}]** ${m.title} (importance: ${m.importance})`
        );
        return { op: "list_memories", success: true, summary: `${memories.length} memories`, detail: rows.join("\n") };
      }

      case "list_versions": {
        const limit = typeof op.limit === "number" ? op.limit : 5;
        const versions = await invokeWithTimeout<{
          id: string; tag?: string; created_at: string; change_summary?: string;
        }[]>("lab_get_versions", { personaId, limit });
        if (versions.length === 0) {
          return { op: "list_versions", success: true, summary: "No prompt versions." };
        }
        const rows = versions.map((v) => {
          const tag = v.tag ? ` [${v.tag}]` : "";
          const time = new Date(v.created_at).toLocaleString([], { month: "short", day: "numeric" });
          return `- **${time}${tag}** — ${v.change_summary?.slice(0, 80) ?? "no summary"}`;
        });
        return { op: "list_versions", success: true, summary: `${versions.length} versions`, detail: rows.join("\n") };
      }

      case "list_reviews": {
        const status = typeof op.status === "string" ? op.status : "pending";
        const reviews = await invokeWithTimeout<Array<{
          id: string; title: string; description: string | null; severity: string;
          status: string; context_data: string | null; suggested_actions: string | null;
          created_at: string;
        }>>("list_manual_reviews", { personaId, status: status === "all" ? null : status });
        if (reviews.length === 0) {
          return { op: "list_reviews", success: true, summary: `No ${status === "all" ? "" : status + " "}reviews.` };
        }
        const detail = reviews.map((r) => {
          const sev = r.severity === "critical" ? "CRIT" : r.severity === "warning" ? "WARN" : "INFO";
          const time = new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return `- **[${sev}] ${r.title}** (\`${r.id.slice(0, 8)}\`) — ${r.description?.slice(0, 100) ?? "no description"} | ${time}`;
        }).join("\n");
        return { op: "list_reviews", success: true, summary: `${reviews.length} review(s)`, detail };
      }

      case "get_review": {
        const reviewId = typeof op.id === "string" ? op.id : "";
        if (!reviewId) return { op: "get_review", success: false, summary: "Missing review id." };
        const allReviews = await invokeWithTimeout<Array<{
          id: string; title: string; description: string | null; severity: string;
          status: string; context_data: string | null; suggested_actions: string | null;
          reviewer_notes: string | null;
        }>>("list_manual_reviews", { personaId, status: null });
        const review = allReviews.find((r) => r.id === reviewId || r.id.startsWith(reviewId));
        if (!review) return { op: "get_review", success: false, summary: `Review "${reviewId}" not found.` };
        const parts = [
          `**${review.title}** | ${review.severity} | ${review.status}`,
          review.description ? `\n${review.description}` : "",
          review.context_data ? `\n\n**Context:**\n\`\`\`\n${review.context_data.slice(0, 500)}\n\`\`\`` : "",
          review.suggested_actions ? `\n\n**Suggested actions:** ${review.suggested_actions}` : "",
        ];
        return { op: "get_review", success: true, summary: parts.join("") };
      }

      // ── Experiment Operations ──────────────────────────────────────

      case "execute": {
        const inputData = typeof op.input === "string" ? op.input : undefined;
        await invokeWithTimeout("execute_persona", {
          personaId, triggerId: null, inputData: inputData ?? null,
          useCaseId: null, continuation: null,
        });
        return { op: "execute", success: true, summary: "Test execution started. Output will stream in the next message." };
      }

      case "start_matrix": {
        const instruction = typeof op.instruction === "string" ? op.instruction : "";
        if (!instruction) {
          return { op: "start_matrix", success: false, summary: "Missing instruction for improvement experiment." };
        }
        const models = [
          { id: "haiku", model: "claude-haiku-4-5", provider: "anthropic" },
          { id: "sonnet", model: "claude-sonnet-4-6", provider: "anthropic" },
        ];
        const result = await invokeWithTimeout<{ id?: string }>(
          "lab_start_matrix",
          { personaId, userInstruction: instruction, models, useCaseFilter: null },
        );
        const hypothesis = typeof op.hypothesis === "string" ? op.hypothesis : instruction.slice(0, 80);
        return {
          op: "start_matrix",
          success: true,
          summary: `Improvement experiment started: "${hypothesis}"`,
          detail: "The system will generate an improved prompt variant and test it against the current version. Results will appear when the experiment completes.",
          experimentRunId: result?.id,
        };
      }

      case "start_arena": {
        const models = Array.isArray(op.models) ? op.models : [{ id: "haiku" }, { id: "sonnet" }];
        const modelConfigs = models.map((m: unknown) =>
          typeof m === "string" ? { id: m, model: `claude-${m}-4-5`, provider: "anthropic" } : m,
        );
        const result = await invokeWithTimeout<{ id?: string }>(
          "lab_start_arena",
          { personaId, models: modelConfigs, useCaseFilter: null },
        );
        return {
          op: "start_arena",
          success: true,
          summary: `Arena test started with ${modelConfigs.length} models`,
          detail: "Models will compete on the same test scenarios. Results will appear when the test completes.",
          experimentRunId: result?.id,
        };
      }

      // ── Change Operations ─────────────────────────────────────────

      case "propose_change": {
        // Preview a change without applying — shows diff for user review
        const section = typeof op.section === "string" ? op.section : "";
        const content = typeof op.content === "string" ? op.content : "";
        const reason = typeof op.reason === "string" ? op.reason : "No reason provided";
        if (!section || !content) {
          return { op: "propose_change", success: false, summary: "Missing section or content." };
        }
        const persona = await invokeWithTimeout<{ structured_prompt?: string | null }>("get_persona", { id: personaId });
        const sp = persona.structured_prompt ? JSON.parse(persona.structured_prompt) : {};
        const current = typeof sp[section] === "string" ? sp[section] : "(empty)";
        const risk = classifyChangeRisk(section, current, content);
        const riskBadge = risk === "high" ? "HIGH RISK" : risk === "medium" ? "MEDIUM" : "LOW";
        return {
          op: "propose_change",
          success: true,
          summary: `Proposed change to "${section}" [${riskBadge}]`,
          detail: [
            `**Reason:** ${reason}`,
            `**Risk:** ${riskBadge}`,
            `**Section:** \`${section}\``,
            "",
            "**Current content:**",
            `\`\`\`\n${current.slice(0, 500)}${current.length > 500 ? "..." : ""}\n\`\`\``,
            "",
            "**Proposed content:**",
            `\`\`\`\n${content.slice(0, 500)}${content.length > 500 ? "..." : ""}\n\`\`\``,
            "",
            risk === "high"
              ? "> This is a high-risk change. Consider running a Matrix experiment to test it first."
              : "> Say **\"apply it\"** to apply this change, or **\"test it first\"** to run a Matrix experiment.",
          ].join("\n"),
        };
      }

      case "edit_prompt": {
        const section = typeof op.section === "string" ? op.section : "";
        const content = typeof op.content === "string" ? op.content : "";
        if (!section || !content) {
          return { op: "edit_prompt", success: false, summary: "Missing section or content." };
        }
        const persona = await invokeWithTimeout<{ structured_prompt?: string | null }>("get_persona", { id: personaId });
        const sp = persona.structured_prompt ? JSON.parse(persona.structured_prompt) : {};
        const current = typeof sp[section] === "string" ? sp[section] : "";
        const risk = classifyChangeRisk(section, current, content);
        sp[section] = content;
        await invokeWithTimeout("update_persona", {
          id: personaId,
          input: { structured_prompt: JSON.stringify(sp) },
        });
        const riskNote = risk === "high"
          ? "\n\n> **Note:** This was a high-risk change (identity/instructions rewrite). Consider running a test execution to verify."
          : risk === "medium"
            ? "\n\n> Consider running a test execution to verify this change works as expected."
            : "";
        return {
          op: "edit_prompt",
          success: true,
          summary: `Applied change to "${section}" (${content.length} chars)`,
          detail: `New content:\n\`\`\`\n${content.slice(0, 300)}${content.length > 300 ? "..." : ""}\n\`\`\`${riskNote}`,
        };
      }

      case "create_assertion": {
        const name = typeof op.name === "string" ? op.name : "Untitled";
        const assertionType = typeof op.assertion_type === "string" ? op.assertion_type : "contains";
        const config = typeof op.config === "string" ? op.config : JSON.stringify(op.config ?? {});
        const severity = typeof op.severity === "string" ? op.severity : "warning";
        await invokeWithTimeout("create_output_assertion", {
          personaId, name, description: null,
          assertionType, config, severity, onFailure: "log",
        });
        return { op: "create_assertion", success: true, summary: `Created assertion "${name}" [${severity}] (${assertionType})` };
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
          summary: `Review \`${reviewId.slice(0, 8)}\` ${newStatus}${notes ? ` — "${notes}"` : ""}`,
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
export async function dispatchOperations(ops: AdvisoryOperation[], personaId: string): Promise<AdvisoryResult[]> {
  const results: AdvisoryResult[] = [];
  for (const op of ops) {
    results.push(await dispatchOne(op, personaId));
  }
  return results;
}

/** Format operation results as rich markdown for display in chat. */
export function formatResults(results: AdvisoryResult[]): string {
  if (results.length === 0) return "";
  return results.map((r) => formatOneResult(r)).join("\n\n---\n\n");
}

function formatOneResult(r: AdvisoryResult): string {
  const icon = r.success ? "\u2705" : "\u274c";
  const header = `${icon} **${friendlyOpName(r.op)}**`;

  if (!r.detail) return `${header}: ${r.summary}`;

  // Experiment results get special formatting with tracking info
  if (r.experimentRunId) {
    return `${header}: ${r.summary}\n\n${r.detail}\n\n> Experiment ID: \`${r.experimentRunId.slice(0, 12)}\``;
  }

  return `${header}: ${r.summary}\n\n${r.detail}`;
}

/** Classify the risk level of a prompt section change. */
function classifyChangeRisk(section: string, current: string, proposed: string): "low" | "medium" | "high" {
  // High risk: rewriting identity or instructions from scratch (>80% different)
  const isKeySection = section === "identity" || section === "instructions";
  if (isKeySection) {
    // If current is empty, this is an addition (medium risk)
    if (!current || current === "(empty)") return "medium";
    // If proposed is much shorter, could be destructive
    if (proposed.length < current.length * 0.3) return "high";
    // If proposed is completely different (rough check: less than 20% overlap)
    const currentWords = new Set(current.toLowerCase().split(/\s+/));
    const proposedWords = proposed.toLowerCase().split(/\s+/);
    const overlap = proposedWords.filter((w) => currentWords.has(w)).length;
    const overlapRatio = proposedWords.length > 0 ? overlap / proposedWords.length : 0;
    if (overlapRatio < 0.2) return "high";
    return "medium";
  }
  // Medium risk: modifying existing content in non-key sections
  if (current && current !== "(empty)") return "medium";
  // Low risk: adding content to empty sections
  return "low";
}

function friendlyOpName(op: string): string {
  const names: Record<string, string> = {
    health_check: "Health Check",
    list_executions: "Execution History",
    list_assertions: "Assertion Rules",
    list_memories: "Agent Memory",
    list_versions: "Prompt Versions",
    list_reviews: "Reviews",
    get_review: "Review Detail",
    approve_review: "Approve Review",
    reject_review: "Reject Review",
    execute: "Test Execution",
    start_arena: "Arena Experiment",
    start_matrix: "Improvement Experiment",
    propose_change: "Proposed Change",
    edit_prompt: "Prompt Update",
    create_assertion: "New Assertion",
  };
  return names[op] ?? op;
}
