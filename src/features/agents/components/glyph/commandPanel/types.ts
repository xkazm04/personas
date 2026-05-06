/**
 * Shared prop contract for the CommandPanel composer.
 *
 * The panel is only shown during the Compose phase. Mid-build follow-up
 * questions are gathered through the glyph (petal click → overlay card),
 * not through a refine step inside the panel — see GlyphFullLayout.
 */
import type { QuickConfigState } from "@/features/agents/components/matrix/quickConfigTypes";

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
}
