/** Prototype strings for "Drafting Sheet" (spark onboarding-blueprint, WP2).
 *  Gathered in one place so they can be extracted into i18n at consolidation,
 *  as cinema/copy.ts is. Scene names, clock labels and frame states are
 *  Cinema's (imported from ../cinema/copy); dimension labels and descriptions
 *  come from `useGlyphDimText`. */
export const COPY = {
  sheetOf: (n: number, total: number) => `Sheet ${n} of ${total}`,
  drawing: "Persona",
  untitled: "Your agent",
  rename: "Rename the agent",

  cell: {
    project: "Project",
    status: "Status",
    brief: "Brief",
    dimensions: "Dimensions",
    notes: "Notes",
    dimension: "Dimension",
    value: "Value",
    purpose: "Purpose",
    specification: "Specification",
  },

  ink: {
    drafting: "Drafting",
    done: "Done",
    asking: "Needs you",
    error: "Did not resolve",
  },

  stamp: {
    approved: "Approved",
    issued: "Issued",
    void: "Void",
  },

  /** The pen's callout kinds. */
  pen: {
    draw: "Draw",
    ink: "Ink",
    letter: "Letter",
    build: "Build",
  },

  dimLine: {
    dimensions: "8 dimensions",
    capabilities: (n: number) => `${n} ${n === 1 ? "capability" : "capabilities"}`,
    parts: (n: number) => `${n} ${n === 1 ? "part" : "parts"}`,
  },

  casting: "Casting",
  candidates: (n: number) => `${n} candidates`,
  finalists: (n: number) => `${n} finalists`,

  nested: {
    back: "Back to sheet 1",
    prev: "Previous sheet",
    next: "Next sheet",
    nothing: "Nothing drawn on this sheet yet.",
    more: (n: number) => `+${n} more`,
    open: (n: string, label: string) => `Open sheet ${n}, ${label}`,
  },
} as const;
