import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import type { CellBuildStatus } from "@/lib/types/buildTypes";
import type { PetalState } from "./glyphLayoutTypes";

export const CELL_KEY_TO_DIM: Record<string, GlyphDimension> = {
  "use-cases": "task",
  connectors: "connector",
  triggers: "trigger",
  "human-review": "review",
  messages: "message",
  memory: "memory",
  "error-handling": "error",
  events: "event",
};

export const DIM_TO_CELL_KEY: Record<GlyphDimension, string> = Object.fromEntries(
  Object.entries(CELL_KEY_TO_DIM).map(([k, v]) => [v, k]),
) as Record<GlyphDimension, string>;

export const DIM_LABEL: Record<GlyphDimension, string> = {
  trigger: "When",
  task: "What",
  connector: "Apps",
  message: "Messages",
  review: "Review",
  memory: "Memory",
  event: "Events",
  error: "Errors",
};

export function derivePetalState(
  dim: GlyphDimension,
  cellStates: Record<string, CellBuildStatus>,
  pendingDims: Set<GlyphDimension>,
  activeRow: GlyphRow | null,
): PetalState {
  if (pendingDims.has(dim)) return "pending";
  const cellStatus = cellStates[DIM_TO_CELL_KEY[dim]];
  if (cellStatus === "error") return "error";
  // Prefer the active row's presence once the LLM has produced results —
  // a persona with multiple capabilities then shows which leaves the
  // selected capability actually uses, not the global build union.
  if (activeRow) {
    if (activeRow.presence[dim] !== "none") return "resolved";
    if (cellStatus === "filling" || cellStatus === "pending") return "filling";
    return "idle";
  }
  if (cellStatus === "resolved" || cellStatus === "updated" || cellStatus === "highlighted") return "resolved";
  if (cellStatus === "filling" || cellStatus === "pending") return "filling";
  return "idle";
}
