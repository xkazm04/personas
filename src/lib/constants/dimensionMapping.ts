/**
 * Maps CLI semantic dimensions to matrix cell keys.
 *
 * This mapping is frontend-owned so that UI iteration (e.g. splitting or
 * merging cells) can happen without backend changes. The backend emits
 * dimension names; the frontend decides which cells they populate.
 */

/** Dimension name -> list of cell keys the dimension maps to. */
export const DIMENSION_TO_CELL: Record<string, string[]> = {
  // Identity dimensions
  identity: ["use-cases"],
  purpose: ["use-cases"],
  // Capability dimensions
  capabilities: ["connectors", "use-cases"],
  tools: ["connectors"],
  integrations: ["connectors"],
  // Activation dimensions
  activation: ["triggers"],
  scheduling: ["triggers"],
  triggers: ["triggers"],
  // Policy dimensions
  oversight: ["human-review"],
  human_review: ["human-review"],
  memory: ["memory"],
  persistence: ["memory"],
  error_handling: ["error-handling"],
  fallback: ["error-handling"],
  // Communication dimensions
  notifications: ["messages"],
  messaging: ["messages"],
  events: ["events"],
  subscriptions: ["events"],
};

/** The canonical set of matrix cell keys. */
export const ALL_CELL_KEYS = [
  "use-cases",
  "connectors",
  "triggers",
  "human-review",
  "memory",
  "error-handling",
  "messages",
  "events",
] as const;

/** Union type of valid cell keys. */
export type CellKey = (typeof ALL_CELL_KEYS)[number];

/**
 * Resolve a CLI semantic dimension to the matrix cell keys it maps to.
 * Returns an empty array for unrecognized dimensions (graceful fallback).
 */
export function resolveCellKeys(dimension: string): string[] {
  return DIMENSION_TO_CELL[dimension] ?? [];
}
