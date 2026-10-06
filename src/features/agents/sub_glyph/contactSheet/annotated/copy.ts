/** Prototype strings for "Annotated Sheet" (spark onboarding-blueprint WP1).
 *  Gathered in one place so they can be extracted into i18n at
 *  consolidation, the same way cinema/copy.ts is. Dimension labels and
 *  descriptions are NOT here: they come from useGlyphDimText(). Everything
 *  drawn in LETTERING is upper-cased by the lettering style, not here. */
export const COPY = {
  sheet: {
    dims: (n: number) => `${String(n).padStart(2, "0")} dimensions`,
    inked: (n: number) => `${String(n).padStart(2, "0")} inked`,
    caps: (n: number) => `${n} ${n === 1 ? "capability" : "capabilities"}`,
    buildTime: (t: string) => `Build ${t}`,
    centre: "00",
  },
  pen: {
    draw: "Draw",
    build: "Build",
  },
  ink: {
    drafting: "Drafting",
    needsYou: "Needs you",
    error: "Did not resolve",
    unused: "Not used",
  },
  kind: {
    cadence: "Cadence",
    trigger: "Trigger",
    brief: "Brief",
    caps: "Scope",
    lead: "Leads with",
    apps: "Apps",
    channel: "Delivers to",
    listens: "Listens to",
    review: "Review",
    memory: "Memory",
    onError: "On error",
    usedBy: "Used by",
  },
  usedBy: (k: number, n: number) => `${k} of ${n} capabilities`,
  more: (n: number) => `+${n}`,
  stamp: {
    screened: "Screened",
    issued: "Issued",
  },
  detail: {
    title: (num: string, label: string) => `Detail ${num} · ${label}`,
    scale: "Scale 2:1",
    zones: {
      setup: "Set up",
      purpose: "Purpose",
      decided: "Decision",
      caps: "Coverage",
    },
    notes: "Notes on this frame",
    noNotes: "Nothing annotated yet. Notes are drawn here as the build learns.",
    back: "Back to the sheet",
    esc: "Esc",
    status: {
      pending: "Pending",
      drafting: "Drafting",
      needs: "Needs you",
      inked: "Inked",
      error: "Did not resolve",
      unused: "Not used",
    },
  },
} as const;
