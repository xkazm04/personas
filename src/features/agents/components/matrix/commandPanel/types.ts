/**
 * Shared prop contract for the CommandPanel composer.
 */
import type { QuickConfigState } from "@/features/agents/components/matrix/DimensionQuickConfig";
import type { BuildQuestion } from "@/lib/types/buildTypes";

export interface CommandPanelProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  /** Optional — when absent, the variant hides the quick-setup area. */
  onQuickConfigChange?: (c: QuickConfigState) => void;
  /** Mid-build questions surfaced by the LLM. When non-empty, the panel
   *  flips to its Refine step so the user can answer in place. */
  pendingQuestions?: BuildQuestion[] | null;
  /** Submit a single answer for one cell key. */
  onAnswer?: (cellKey: string, answer: string) => void;
}
