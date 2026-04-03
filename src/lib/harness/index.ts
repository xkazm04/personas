/* ==============================================================================
   Harness — Public API
   ============================================================================== */

// Orchestrator
export { createHarnessOrchestrator } from './orchestrator';

// Plan Builder
export { buildPlan, pickNextArea, updatePlanStats } from './plan-builder';

// Executor
export { executeArea, parseAreaResult, readAgentsMd, appendAgentsMd } from './executor';

// Verifier
export { verify, PERSONAS_GATES, typographyAuditGate, i18nAuditGate, notificationCoverageGate } from './verifier';

// Guide Generator
export { createEmptyGuide, appendGuideStep, loadGuide, saveGuide, renderGuideMarkdown } from './guide-generator';

// Scenario
export { getPersonasScenario } from './scenario-parser';

// Types
export type {
  // Status
  FeatureStatus,
  AreaStatus,
  // Plan
  PlannedFeature,
  ModuleArea,
  HarnessPlan,
  // Progress
  ProgressEntry,
  // Verification
  GateType,
  VerificationGate,
  VerificationResult,
  VerificationReport,
  // Executor
  ExecutorConfig,
  ExecutorResult,
  ParsedAreaResult,
  // Guide
  GuideStep,
  HarnessGuide,
  // Config
  HarnessConfig,
  // Events
  HarnessEventType,
  HarnessEvent,
  HarnessEventListener,
  // Orchestrator
  HarnessOrchestrator,
  // Scenario
  ScenarioArea,
  ScenarioGoal,
  ScenarioDefinition,
} from './types';
