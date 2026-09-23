/** Strings for the inline quick setup on a frame's page. Prototype copy, kept
 *  in one place (like ../copy.ts) so it can move into i18n at consolidation. */
export const QS = {
  heading: "Quick setup",
  more: "More options",
  moreApps: (n: number) => (n > 0 ? `All apps (${n} more)` : "All apps"),
  decided: "Decided for this draft",

  health: {
    verified: "Healthy",
    unverifiable: "No live check",
    failed: "Check failed",
    unreachable: "Unreachable",
    untested: "Not tested",
  } as Record<string, string>,
  noApps: "No apps in your vault yet. Add a credential in the vault, then pick it here.",

  when: {
    manual: "Manual",
    daily: "Daily",
    weekdays: "Weekdays",
    weekly: "Weekly",
    monthly: "Monthly",
    at: "At",
    on: "On",
    dayOfMonth: "Day of month",
    earlier: "Earlier day",
    later: "Later day",
    manualNote: "Runs when you ask, or when an event you pick fires.",
    presets: "Run rhythm",
  },

  messages: {
    alwaysOn: "Always on",
    needsDestination: "Needs a destination. Set it under More options.",
    noChannels: "Connect Slack, Telegram, Discord, Teams or email in the vault to add a channel.",
  },

  events: {
    reactWhen: "React when another agent",
    completed: "completes a task",
    error: "raises an error",
    review: "needs review",
    noAgents: "No other agents yet. Once you have one, this agent can react to it.",
    subscribed: (n: number) => `${n} subscribed`,
  },
} as const;
