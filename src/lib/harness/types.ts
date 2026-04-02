/* ==============================================================================
   Harness Types
   Complete type system for the autonomous Plan → Execute → Verify loop.
   ============================================================================== */

// ---------------------------------------------------------------------------
//  Feature & Area Status
// ---------------------------------------------------------------------------

export type FeatureStatus = 'pending' | 'in-progress' | 'pass' | 'fail' | 'skipped';
export type AreaStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'blocked';

// ---------------------------------------------------------------------------
//  Plan Types
// ---------------------------------------------------------------------------

export interface PlannedFeature {
  id: string;
  name: string;
  status: FeatureStatus;
  quality: number | null;       // 1-5 scale
  lastSession: string | null;   // session ID
  failReason: string | null;
}

export interface ModuleArea {
  id: string;
  moduleId: string;             // e.g., 'typography', 'i18n', 'notifications'
  label: string;
  description: string;
  scope: string[];              // file/directory globs this area covers
  featureNames: string[];
  dependsOn: string[];          // area IDs
  status: AreaStatus;
  features: PlannedFeature[];
  completedAt: number | null;   // iteration number
  retries: number;
}

export interface HarnessPlan {
  project: string;
  projectPath: string;
  scenario: string;
  areas: ModuleArea[];
  iteration: number;
  totalFeatures: number;
  passingFeatures: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
//  Progress Tracking
// ---------------------------------------------------------------------------

export interface ProgressEntry {
  iteration: number;
  areaId: string;
  moduleId: string;
  action: 'execute' | 'retry' | 'skip';
  outcome: 'completed' | 'partial' | 'failed' | 'skipped';
  summary: string;
  durationMs: number;
  featuresChanged: Record<string, FeatureStatus>;
  errors: string[];
  learnings: string[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
//  Verification
// ---------------------------------------------------------------------------

export type GateType = 'typecheck' | 'lint' | 'test' | 'build' | 'custom';

export interface VerificationGate {
  name: string;
  type: GateType;
  required: boolean;
  command: string;
  timeoutMs?: number;
}

export interface VerificationResult {
  gate: string;
  passed: boolean;
  output: string;
  durationMs: number;
  errors: string[] | undefined;
}

export interface VerificationReport {
  iteration: number;
  areaId: string;
  timestamp: string;
  gates: VerificationResult[];
  allPassed: boolean;
  requiredFailures: number;
}

// ---------------------------------------------------------------------------
//  Executor
// ---------------------------------------------------------------------------

export interface ExecutorConfig {
  sessionTimeoutMs: number;     // max time per area (default: 600_000 = 10min)
  maxRetriesPerArea: number;    // default: 2
  allowedTools: string[];       // e.g., ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep']
  skipPermissions: boolean;     // --dangerously-skip-permissions
  bareMode: boolean;            // --bare
}

export interface ExecutorResult {
  completed: boolean;
  sessionId: string | null;
  durationMs: number;
  assistantOutput: string;
  touchedTsx: boolean;
  touchedCss: boolean;
  touchedStore: boolean;
  touchedI18n: boolean;
  exitCode: number | null;
  costUsd: number | null;
  errors: string[];
}

export interface ParsedAreaResult {
  areaId: string;
  completed: boolean;
  features: Record<string, FeatureStatus>;
  filesCreated: string[];
  filesModified: string[];
  learnings: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
//  Guide
// ---------------------------------------------------------------------------

export interface GuideStep {
  phase: number;
  areaId: string;
  moduleId: string;
  label: string;
  description: string;
  actions: string[];
  filesModified: string[];
  filesCreated: string[];
  decisions: string[];
  gotchas: string[];
  verification: string;
  durationMs: number;
}

export interface HarnessGuide {
  title: string;
  project: string;
  scenario: string;
  generatedAt: string;
  totalIterations: number;
  totalDurationMs: number;
  buildOrder: string[];
  steps: GuideStep[];
  learnings: string[];
  prerequisites: string[];
}

// ---------------------------------------------------------------------------
//  Configuration
// ---------------------------------------------------------------------------

export interface HarnessConfig {
  projectPath: string;
  projectName: string;
  scenario: string;             // path to scenario .md file
  statePath: string;            // default: '.harness'
  executor: ExecutorConfig;
  gates: VerificationGate[];
  maxIterations: number;        // default: 100
  targetPassRate: number;       // default: 0.9
  generateGuide: boolean;       // default: true
  updateAgentsMd: boolean;      // default: true
}

// ---------------------------------------------------------------------------
//  Events
// ---------------------------------------------------------------------------

export type HarnessEventType =
  | 'harness:started'
  | 'harness:planning'
  | 'harness:executing'
  | 'harness:verifying'
  | 'harness:area-completed'
  | 'harness:area-failed'
  | 'harness:area-skipped'
  | 'harness:guide-updated'
  | 'harness:learning'
  | 'harness:progress'
  | 'harness:paused'
  | 'harness:resumed'
  | 'harness:completed'
  | 'harness:error';

export interface HarnessEvent {
  type: HarnessEventType;
  timestamp: string;
  iteration: number;
  areaId?: string;
  message: string;
  data?: unknown;
}

export type HarnessEventListener = (event: HarnessEvent) => void;

// ---------------------------------------------------------------------------
//  Orchestrator Interface
// ---------------------------------------------------------------------------

export interface HarnessOrchestrator {
  start(): Promise<HarnessGuide>;
  pause(): void;
  resume(): Promise<HarnessGuide>;
  getPlan(): HarnessPlan | null;
  getGuide(): HarnessGuide | null;
  on(listener: HarnessEventListener): () => void;
}

// ---------------------------------------------------------------------------
//  Scenario Definition (parsed from markdown)
// ---------------------------------------------------------------------------

export interface ScenarioArea {
  id: string;
  moduleId: string;
  label: string;
  description: string;
  scope: string[];
  features: string[];
  dependsOn: string[];
  verificationCommand?: string;
}

export interface ScenarioGoal {
  id: string;
  title: string;
  description: string;
  successCriteria: string[];
}

export interface ScenarioDefinition {
  title: string;
  goals: ScenarioGoal[];
  areas: ScenarioArea[];
  customGates: VerificationGate[];
}
