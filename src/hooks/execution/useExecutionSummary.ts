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
 */
export function useExecutionSummary(
  entries: ReasoningEntry[],
  isLive: boolean,
): ExecutionSummary {
  return useMemo(() => {
    const toolCalls: ToolCallSummary[] = [];
    const fileChanges: FileChangeSummary[] = [];
    const seenFiles = new Set<string>();
    let status: ExecutionSummary["status"] = isLive ? "running" : "completed";
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
          status = "completed";
          break;
        case "error":
          status = "failed";
          break;
      }
    }

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
  }, [entries, isLive]);
}
