/** Prototype strings for "Schematic Dial" (spark onboarding-blueprint WP3).
 *  Gathered in one place so they can be extracted into i18n at consolidation,
 *  as cinema/copy.ts is. Dimension labels and descriptions are NOT here: they
 *  come from `useGlyphDimText()`. */
export const COPY = {
  root: "Schematic dial",
  sectorAria: (label: string, state: string) => `${label}${state ? `, ${state}` : ""}. Open the exploded view`,
  ink: {
    pending: "",
    drafting: "Drafting",
    asking: "Needs you",
    done: "Inked",
    error: "Did not resolve",
  },
  by: { you: "Set by you", ai: "By the build" },
  legend: { pending: "To draw", drafting: "Drafting", done: "Inked" },
  kind: {
    sector: "Inked",
    capability: "Capability",
    connector: "Connector",
    trigger: "Trigger",
    channel: "Channel",
    event: "Event",
    answer: "Answer",
    test: "Test",
    note: "Note",
  },
  plate: {
    schematic: "Schematic",
    serial: (s: string) => `No. ${s}`,
    brief: "Brief",
    rim: (n: number) => `${n} mark${n === 1 ? "" : "s"}`,
  },
  stamp: { issued: "In service", passed: "Screened", stopped: "Void" },
  fan: {
    back: "Re-seat the sector",
    esc: "Esc",
    empty: "Nothing drawn here yet",
    more: (n: number) => `+${n} more`,
    sections: {
      setup: "Set up",
      what: "What it is",
      decided: "Decided",
    },
    preLaunch: "Anything left empty is decided by the build.",
    later: "Decided during the build.",
  },
} as const;
