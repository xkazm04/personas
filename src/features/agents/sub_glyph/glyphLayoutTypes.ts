import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import type { BuildQuestion, CellBuildStatus, BuildPhase, ToolTestResult } from "@/lib/types/buildTypes";
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { PetalState } from "@/features/shared/glyph/persona-sigil/types";
import type { PersonaCoreLaunchSnapshot } from "./personaCore";

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
  /** Persona Core Codex → typed runtime Core. Fired at Launch with the codex
   *  snapshot (typed state + resolved archetype); the matrix entry holds it
   *  until promote, where `composeCoreProfile` turns it into
   *  `personas.core_profile` (an explicit `update_persona` AFTER the Rust
   *  seed-if-absent stamp has run inside `promote_build_draft`). BOTH compose
   *  surfaces call it: the dialogue panel and, since sweep #41, GlyphFullLayout
   *  (the `cinema` layout's compose step), which had no codex at all - so the
   *  build-layout toggle could silently strip mentality/traits/model from the
   *  promote stamp. */
  onLaunchCoreSnapshot?: (snapshot: PersonaCoreLaunchSnapshot) => void;
  /** Optional reference context ("Add reference context"). The container renders its own
   *  BuildContextField for the cinema layouts; the Contact Sheet prototypes own it one
   *  layer down instead, so they receive the value and setter. */
  contextText?: string;
  onContextChange?: (v: string) => void;
}

export type { GlyphDimension, GlyphRow, BuildQuestion, CellBuildStatus, BuildPhase, QuickConfigState };
