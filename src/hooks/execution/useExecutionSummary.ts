import { useMemo } from "react";
import type { ReasoningEntry } from "./useReasoningTrace";

export interface ToolCallSummary {
  name: string;
  inputPreview: string;
  ts: number;
}

export interface FileChangeSummary {
  path: string;
  changeType: "read" | "write" | "edit";
}

export interface ExecutionSummary {
  status: "running" | "completed" | "failed" | "cancelled";
  durationMs?: number;
  costUsd?: number;
  totalTokens?: number;
  model?: string;
  toolCalls: ToolCallSummary[];
  uniqueTools: string[];
  fileChanges: FileChangeSummary[];
  fileWriteCount: number;
  fileReadCount: number;
}

/**
 * Derives a structured execution summary from reasoning trace entries.
 * Pure computation — no side effects, no subscriptions.
 *
 * Returns `null` when there is nothing to summarise (no trace entries), so a
 * caller can fall back to its plain-text result. The previous version always
 * returned an object, which made `{summary && <Card/>}` always true and left
 * every such fallback branch unreachable.
 *
 * `knownStatus` is the authoritative terminal status of the run when the
 * caller has one (the persisted execution row). The trace alone CANNOT see a
 * cancellation — the structured stream carries no cancel event, it simply
 * stops — so `"cancelled"` is reachable only through this parameter. It is
 * deliberately not inferred from "not live and no `complete` entry": a result
 * event dropped by an ordering race would then mislabel a completed run.
 */
export function useExecutionSummary(
  entries: ReasoningEntry[],
  isLive: boolean,
  knownStatus?: ExecutionSummary["status"] | null,
): ExecutionSummary | null {
  return useMemo(() => {
    if (entries.length === 0) return null;

    const toolCalls: ToolCallSummary[] = [];
    const fileChanges: FileChangeSummary[] = [];
    const seenFiles = new Set<string>();
    let tracedTerminal: ExecutionSummary["status"] | undefined;
    let durationMs: number | undefined;
    let costUsd: number | undefined;
    let totalTokens: number | undefined;
    let model: string | undefined;

    for (const entry of entries) {
      switch (entry.type) {
        case "init":
          model = entry.model;
          break;
        case "tool_call":
          toolCalls.push({
            name: entry.toolName,
            inputPreview: entry.inputPreview,
            ts: entry.ts,
          });
          break;
        case "file_change": {
          const key = `${entry.changeType}:${entry.path}`;
          if (!seenFiles.has(key)) {
            seenFiles.add(key);
            fileChanges.push({ path: entry.path, changeType: entry.changeType });
          }
          break;
        }
        case "complete":
          durationMs = entry.durationMs;
          costUsd = entry.cost;
          totalTokens = entry.tokens;
          tracedTerminal = "completed";
          break;
        case "error":
          tracedTerminal = "failed";
          break;
      }
    }

    // A live run is running, whatever any row says. Otherwise the caller's
    // authoritative status wins over what the trace happened to witness (it is
    // the only source that can say "cancelled"), and the trace is the fallback.
    const status: ExecutionSummary["status"] = isLive
      ? "running"
      : (knownStatus ?? tracedTerminal ?? "completed");

    const uniqueTools = [...new Set(toolCalls.map((t) => t.name))];
    const fileWriteCount = fileChanges.filter(
      (f) => f.changeType === "write" || f.changeType === "edit",
    ).length;
    const fileReadCount = fileChanges.filter((f) => f.changeType === "read").length;

    return {
      status,
      durationMs,
      costUsd,
      totalTokens,
      model,
      toolCalls,
      uniqueTools,
      fileChanges,
      fileWriteCount,
      fileReadCount,
    };
  }, [entries, isLive, knownStatus]);
}
