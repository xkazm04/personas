import type { AutomationDeployStatus as AutomationDeploymentStatus } from "@/lib/bindings/AutomationDeployStatus";
import type { AutomationPlatform } from "@/lib/bindings/AutomationPlatform";

/**
 * Visual config for automation deployment status badges.
 *
 * `labelKey` is the trailing segment of `t.agents.connectors.<labelKey>`.
 * Consumers read the localized label via
 * `t.agents.connectors[AUTOMATION_STATUS_CONFIG[status].labelKey]`. Keeps
 * display labels in en.json (per the "Constants-with-labels" graduated
 * rule from Patterns/explorer-preferences.md). `as const` is load-bearing —
 * it narrows labelKey from `string` to a literal-union type so the index
 * access typechecks against the connectors translation block.
 */
export const AUTOMATION_STATUS_CONFIG = {
  active: {
    labelKey: "auto_status_active",
    color: "text-brand-emerald",
    bg: "bg-brand-emerald/10 border-brand-emerald/20",
  },
  draft: {
    labelKey: "auto_status_draft",
    color: "text-primary",
    bg: "bg-primary/10 border-primary/20",
  },
  paused: {
    labelKey: "auto_status_paused",
    color: "text-brand-amber",
    bg: "bg-brand-amber/10 border-brand-amber/20",
  },
  error: {
    labelKey: "auto_status_error",
    color: "text-brand-rose",
    bg: "bg-brand-rose/10 border-brand-rose/20",
  },
} as const satisfies Record<AutomationDeploymentStatus, { labelKey: string; color: string; bg: string }>;

/**
 * Visual config for workflow platforms. Same labelKey pattern as
 * AUTOMATION_STATUS_CONFIG above.
 */
export const PLATFORM_CONFIG = {
  n8n: {
    labelKey: "platform_n8n",
    color: "text-brand-amber",
    bg: "bg-brand-amber/10 border-brand-amber/20",
  },
  github_actions: {
    labelKey: "platform_github_actions",
    color: "text-foreground",
    bg: "bg-secondary/40 border-border/60",
  },
  zapier: {
    labelKey: "platform_zapier",
    color: "text-brand-amber",
    bg: "bg-brand-amber/10 border-brand-amber/20",
  },
  custom: {
    labelKey: "platform_custom",
    color: "text-accent",
    bg: "bg-accent/10 border-accent/20",
  },
} as const satisfies Record<AutomationPlatform, { labelKey: string; color: string; bg: string }>;

/** Detect platform from a webhook URL */
export function detectPlatformFromUrl(url: string): AutomationPlatform | null {
  const lower = url.toLowerCase();
  if (lower.includes(".n8n.") || lower.includes("/webhook/") || lower.includes("n8n")) return "n8n";
  if (lower.includes("hooks.zapier.com")) return "zapier";
  if (lower.includes("api.github.com") && lower.includes("dispatches")) return "github_actions";
  return null;
}

