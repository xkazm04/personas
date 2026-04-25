/**
 * Shared prop contract for CommandPanel variants.
 *
 * Every variant (Baseline, Composer, …) accepts the same shape so the
 * switcher can swap them without touching call sites.
 */
import type { QuickConfigState } from "@/features/agents/components/matrix/DimensionQuickConfig";

export interface CommandPanelProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  /** Optional — when absent, the variant hides the quick-setup area. */
  onQuickConfigChange?: (c: QuickConfigState) => void;
}

export type CommandPanelVariant = "baseline" | "composer";
