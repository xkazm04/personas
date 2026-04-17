import type { AutomationDeploymentStatus, AutomationPlatform } from "@/lib/bindings/PersonaAutomation";

/** Visual config for automation deployment status badges */
export const AUTOMATION_STATUS_CONFIG: Record<
  AutomationDeploymentStatus,
  { label: string; color: string; bg: string }
> = {
  active: {
    label: "Active",
    color: "text-brand-emerald",
    bg: "bg-brand-emerald/10 border-brand-emerald/20",
  },
  draft: {
    label: "Draft",
    color: "text-primary",
    bg: "bg-primary/10 border-primary/20",
  },
  paused: {
    label: "Paused",
    color: "text-brand-amber",
    bg: "bg-brand-amber/10 border-brand-amber/20",
  },
  error: {
    label: "Error",
    color: "text-brand-rose",
    bg: "bg-brand-rose/10 border-brand-rose/20",
  },
};

/** Visual config for workflow platforms */
export const PLATFORM_CONFIG: Record<
  AutomationPlatform,
  { label: string; color: string; bg: string }
> = {
  n8n: {
    label: "n8n",
    color: "text-brand-amber",
    bg: "bg-brand-amber/10 border-brand-amber/20",
  },
  github_actions: {
    label: "GitHub Actions",
    color: "text-foreground",
    bg: "bg-secondary/40 border-border/60",
  },
  zapier: {
    label: "Zapier",
    color: "text-brand-amber",
    bg: "bg-brand-amber/10 border-brand-amber/20",
  },
  custom: {
    label: "Custom",
    color: "text-accent",
    bg: "bg-accent/10 border-accent/20",
  },
};

/** Detect platform from a webhook URL */
export function detectPlatformFromUrl(url: string): AutomationPlatform | null {
  const lower = url.toLowerCase();
  if (lower.includes(".n8n.") || lower.includes("/webhook/") || lower.includes("n8n")) return "n8n";
  if (lower.includes("hooks.zapier.com")) return "zapier";
  if (lower.includes("api.github.com") && lower.includes("dispatches")) return "github_actions";
  return null;
}

