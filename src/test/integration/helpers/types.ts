/**
 * Shared types for CLI integration tests.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════════════════

export type ProviderName = 'claude' | 'gemini';

export interface ModelSpec {
  id: string;
  label: string;
  tier: 'budget' | 'standard' | 'premium';
}

export const PROVIDER_MODELS: Record<ProviderName, ModelSpec[]> = {
  claude: [
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', tier: 'standard' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', tier: 'budget' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6', tier: 'premium' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash-lite', label: 'Flash Lite 3.1', tier: 'budget' },
  ],
};

export interface ProviderInfo {
  name: ProviderName;
  displayName: string;
  model: string;
  available: boolean;
  version?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Test matrix configuration (env-driven scoping)
// ═══════════════════════════════════════════════════════════════════════════

export interface TestMatrixEntry {
  provider: ProviderInfo;
  model: ModelSpec;
}

export type FeatureArea =
  | 'persona-design'
  | 'credential-design'
  | 'persona-testing'
  | 'credential-healthcheck'
  | 'auto-cred-browser'
  | 'n8n-transform'
  | 'automation-design'
  | 'recipe-generation'
  | 'healing-diagnosis'
  | 'smart-search'
  | 'credential-negotiation'
  | 'persona-execution'
  | 'template-adopt'
  | 'query-debug';

// ═══════════════════════════════════════════════════════════════════════════
// Quality scoring (business + technical)
// ═══════════════════════════════════════════════════════════════════════════

export interface QualityDimension {
  name: string;
  score: number;   // 0-1
  weight: number;   // relative importance
  detail: string;
}

export interface QualityReport {
  technical: QualityDimension[];
  business: QualityDimension[];
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI Runner
// ═══════════════════════════════════════════════════════════════════════════

export interface CliRunnerConfig {
  provider: ProviderName;
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  model?: string;
}

export interface StreamEvent {
  type: 'system_init' | 'assistant_text' | 'tool_use' | 'tool_result' | 'result' | 'unknown';
  raw: string;
  timestamp: number;
  model?: string;
  sessionId?: string;
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  durationMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CliRunResult {
  provider: ProviderName;
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  events: StreamEvent[];
  stderr: string;
  totalDurationMs: number;
  reportedDurationMs?: number;
  reportedCostUsd?: number;
  reportedInputTokens?: number;
  reportedOutputTokens?: number;
  reportedModel?: string;
  sessionId?: string;
  assistantText: string;
  toolsUsed: string[];
  toolCallCount: number;
  rawStdout: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationCriteria {
  expectSuccess?: boolean;
  outputContains?: string[];
  outputContainsAny?: string[];
  outputExcludes?: string[];
  outputMatchesRegex?: RegExp[];
  toolsUsed?: string[];
  minToolCalls?: number;
  maxToolCalls?: number;
  filesCreated?: string[];
  fileContentContains?: Record<string, string[]>;
  maxDurationMs?: number;
  custom?: (result: CliRunResult) => { passed: boolean; detail: string };
}

export interface ValidationResult {
  passed: boolean;
  score: number;
  details: string[];
  penalties: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Database
// ═══════════════════════════════════════════════════════════════════════════

export interface TestExecutionRecord {
  id: string;
  round: string;
  testName: string;
  provider: ProviderName;
  model: string;
  status: 'pass' | 'fail' | 'skip' | 'timeout' | 'error';
  score: number;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  toolsUsed: string;
  assistantTextLength: number;
  errorMessage?: string;
  validationDetails: string;
}

export interface ProviderComparison {
  provider: ProviderName;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  avgScore: number;
  avgDurationMs: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgToolCalls: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Workspace
// ═══════════════════════════════════════════════════════════════════════════

export type FixtureTemplate =
  | 'empty'
  | 'data-analysis'
  | 'code-review'
  | 'sql-debugging'
  | 'multi-file-project'
  | 'large-input'
  | 'persona-design'
  | 'credential-design'
  | 'n8n-workflow'
  | 'healing-diagnosis';

export interface WorkspaceContext {
  rootDir: string;
  writeFile(relativePath: string, content: string): string;
  readFile(relativePath: string): string | null;
  fileExists(relativePath: string): boolean;
  destroy(): void;
}
