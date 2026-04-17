/**
 * ResearchExperiment.inputSchema is a free-form JSON string on the Rust side.
 * We use it to store UI-facing run config such as the linked persona id.
 */
export interface ExperimentConfig {
  linkedPersonaId?: string;
  inputDataTemplate?: string;
  /**
   * JavaScript regular expression (source only — no slashes/flags) matched case-insensitively
   * against the execution's output_data. When set, a match means the run passed. When unset,
   * pass/fail falls back to the execution's terminal status.
   */
  passPattern?: string;
}

/** Evaluate a run result against the experiment's pass pattern. */
export function evaluatePass(output: string | null | undefined, passPattern: string | undefined, statusPassed: boolean): boolean {
  if (!passPattern || !passPattern.trim()) return statusPassed;
  if (!output) return false;
  try {
    const re = new RegExp(passPattern, 'i');
    return re.test(output);
  } catch {
    // Invalid regex — fall back to status-based evaluation but surface intent.
    return statusPassed;
  }
}

export function parseExperimentConfig(raw: string | null | undefined): ExperimentConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ExperimentConfig;
    return {};
  } catch {
    return {};
  }
}

export function serializeExperimentConfig(config: ExperimentConfig): string | undefined {
  const hasAny = Object.values(config).some((v) => v !== undefined && v !== null && v !== '');
  if (!hasAny) return undefined;
  return JSON.stringify(config);
}
