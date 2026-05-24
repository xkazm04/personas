import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import type { BuildQuestion, CellBuildStatus, BuildPhase, ToolTestResult } from "@/lib/types/buildTypes";
import type { QuickConfigState } from "@/features/agents/components/matrix/quickConfigTypes";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { PetalState } from "@/features/shared/glyph/persona-sigil/types";

export type { PetalState };

export interface GlyphFullLayoutProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  isBuilding: boolean;
  buildPhase: BuildPhase | null;
  completeness: number;
  cellStates: Record<string, CellBuildStatus>;
  pendingQuestions: BuildQuestion[] | null;
  onAnswer: (cellKey: string, answer: string) => void;
  agentName: string;
  onAgentNameChange: (v: string) => void;
  hasDesignResult: boolean;
  glyphRows: GlyphRow[];
  onStartTest: () => void | Promise<void>;
  onPromote: () => void;
  onPromoteForce?: () => void;
  onRejectTest?: () => void;
  onRefine?: (prompt: string) => void | Promise<void>;
  onViewAgent: () => void;
  buildError: string | null;
  testOutputLines?: string[];
  testPassed?: boolean | null;
  testError?: string | null;
  /** Structured tool-test outcomes (populated by useLifecycle).
   *  Drives the rich split-pane TestReportModal that the legacy
   *  matrix view also uses. */
  toolTestResults?: ToolTestResult[];
  /** LLM-generated test summary text (parsed into sections by the
   *  TestReportModal). */
  testSummary?: string | null;
  cliOutputLines?: string[];
  onQuickConfigChange?: (c: QuickConfigState) => void;
  /** Slice 4 — initial messaging channels for picker hydration when the
   *  build flow resumes for an existing persona. */
  initialNotificationChannels?: ChannelSpecV2[];
}

export type { GlyphDimension, GlyphRow, BuildQuestion, CellBuildStatus, BuildPhase, QuickConfigState };
