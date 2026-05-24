/**
 * Shared prop contract for the CommandPanel composer.
 *
 * The panel is only shown during the Compose phase. Mid-build follow-up
 * questions are gathered through the glyph (petal click → overlay card),
 * not through a refine step inside the panel — see GlyphFullLayout.
 */
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";

export interface CommandPanelProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  /** Optional — when absent, the variant hides the quick-setup area. */
  onQuickConfigChange?: (c: QuickConfigState) => void;
  /** True while the build session is actively running (analyzing/resolving).
   *  Drives the submit button's spinner so a click feels acknowledged
   *  immediately, not after the layout finally swaps out of compose. */
  isBuilding?: boolean;
  /** Slice 4 — initial messaging channels for round-trip hydration. When the
   *  build flow resumes for an existing draft persona, the parent passes
   *  the persona's parsed `notification_channels` here so the picker
   *  shows the user's prior choices instead of starting fresh. Falls back
   *  to `[built-in inbox]` when absent. */
  initialNotificationChannels?: ChannelSpecV2[];
}
