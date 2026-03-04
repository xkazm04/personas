/**
 * Shared types for CLI integration tests.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════════════════

export type ProviderName = 'claude' | 'gemini' | 'copilot';

export interface ProviderInfo {
  name: ProviderName;
  displayName: string;
  model: string;
  available: boolean;
  version?: string;
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
  | 'large-input';

export interface WorkspaceContext {
  rootDir: string;
  writeFile(relativePath: string, content: string): string;
  readFile(relativePath: string): string | null;
  fileExists(relativePath: string): boolean;
  destroy(): void;
}
