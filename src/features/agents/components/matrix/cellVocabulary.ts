/**
 * User-facing labels for matrix cell keys.
 *
 * Three labels are renamed for non-technical accessibility (VISL-05):
 *   - "Use Cases" -> "Tasks" (concrete, universal)
 *   - "Connectors" -> "Apps & Services" (familiar, non-technical)
 *   - "Triggers" -> "When It Runs" (describes function in plain terms)
 *
 * Five labels remain unchanged: Human Review, Messages, Memory, Errors, Events.
 *
 * Labels are always the same in build-mode and view-mode -- user learns them once.
 * Consumers render them uppercase with tracking (existing convention).
 */

/** Maps each matrix cell key to its user-facing display label. */
export const CELL_LABELS: Record<string, string> = {
  "use-cases": "Tasks",
  connectors: "Apps & Services",
  triggers: "When It Runs",
  "human-review": "Human Review",
  messages: "Messages",
  memory: "Memory",
  "error-handling": "Errors",
  events: "Events",
};
