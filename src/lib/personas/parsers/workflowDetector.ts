/**
 * Format detection layer for multi-platform workflow import.
 * Identifies the source platform from file structure and content.
 */

export type WorkflowPlatform = 'n8n' | 'zapier' | 'make' | 'github-actions' | 'unknown';

export interface DetectionResult {
  platform: WorkflowPlatform;
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable label for the platform */
  label: string;
  /** File format hint */
  format: 'json' | 'yaml';
}

const PLATFORM_LABELS: Record<WorkflowPlatform, string> = {
  'n8n': 'n8n',
  'zapier': 'Zapier',
  'make': 'Make (Integromat)',
  'github-actions': 'GitHub Actions',
  'unknown': 'Unknown',
};

/**
 * Detect the workflow platform from parsed JSON content.
 */
function detectFromJson(json: Record<string, unknown>): DetectionResult {
  // n8n: has `nodes` array with objects containing `type` fields like "n8n-nodes-base.*"
  if (Array.isArray(json.nodes)) {
    const nodes = json.nodes as Array<Record<string, unknown>>;
    const hasN8nTypes = nodes.some(
      (n) => typeof n.type === 'string' && (n.type.startsWith('n8n-nodes-base.') || n.type.includes('n8n')),
    );
    if (hasN8nTypes) {
      return { platform: 'n8n', confidence: 'high', label: PLATFORM_LABELS['n8n'], format: 'json' };
    }
    // Could still be n8n without the prefix (custom nodes)
    const hasConnections = json.connections && typeof json.connections === 'object';
    if (hasConnections) {
      return { platform: 'n8n', confidence: 'medium', label: PLATFORM_LABELS['n8n'], format: 'json' };
    }
  }

  // Zapier: has `steps` array with objects containing `app` and `action` fields
  if (Array.isArray(json.steps)) {
    const steps = json.steps as Array<Record<string, unknown>>;
    const hasZapierShape = steps.some(
      (s) => typeof s.app === 'string' || typeof s.action === 'string' || typeof s.action_id === 'string',
    );
    if (hasZapierShape) {
      return { platform: 'zapier', confidence: 'high', label: PLATFORM_LABELS['zapier'], format: 'json' };
    }
  }

  // Zapier alternative: top-level `trigger` + `actions` array
  if (json.trigger && typeof json.trigger === 'object' && Array.isArray(json.actions)) {
    return { platform: 'zapier', confidence: 'medium', label: PLATFORM_LABELS['zapier'], format: 'json' };
  }

  // Make (Integromat): has `flow` array with `module` objects, or `modules` at top level
  if (Array.isArray(json.flow)) {
    const flow = json.flow as Array<Record<string, unknown>>;
    const hasMakeModules = flow.some(
      (m) => typeof m.module === 'string' || typeof m.type === 'string',
    );
    if (hasMakeModules) {
      return { platform: 'make', confidence: 'high', label: PLATFORM_LABELS['make'], format: 'json' };
    }
  }

  // Make alternative: `blueprint` wrapper containing `flow`
  if (json.blueprint && typeof json.blueprint === 'object') {
    const blueprint = json.blueprint as Record<string, unknown>;
    if (Array.isArray(blueprint.flow)) {
      return { platform: 'make', confidence: 'high', label: PLATFORM_LABELS['make'], format: 'json' };
    }
  }

  // Make alternative: top-level `modules` array
  if (Array.isArray(json.modules)) {
    const modules = json.modules as Array<Record<string, unknown>>;
    const hasMakeShape = modules.some(
      (m) => typeof m.module === 'string' || typeof m.mapper === 'object',
    );
    if (hasMakeShape) {
      return { platform: 'make', confidence: 'medium', label: PLATFORM_LABELS['make'], format: 'json' };
    }
  }

  // GitHub Actions arriving down the JSON path. The GHA signature lived only
  // in the YAML branch, so a jobs-shaped document reaching detection with a
  // non-YAML extension — which is every preview-card call, and any workflow
  // saved as .json — was reported as `unknown`, even though `countElements`
  // right below already counts its jobs. Same rule, one implementation.
  // Confidence is `medium`, not `high`: the structure matches but the file
  // did not arrive in the format GitHub exports, so the wizard still asks the
  // user to confirm the format.
  if (isGithubActionsShape(json)) {
    return {
      platform: 'github-actions',
      confidence: 'medium',
      label: PLATFORM_LABELS['github-actions'],
      format: 'json',
    };
  }

  return { platform: 'unknown', confidence: 'low', label: PLATFORM_LABELS['unknown'], format: 'json' };
}

/**
 * The GitHub Actions structural signature: a `jobs` map, plus either an `on`
 * trigger (which YAML may have parsed into the boolean key `true`) or a job
 * carrying `runs-on`.
 *
 * Extracted so the JSON and YAML branches share ONE definition of the rule.
 */
function isGithubActionsShape(parsed: Record<string, unknown>): boolean {
  if (!parsed.jobs || typeof parsed.jobs !== 'object') return false;
  // YAML `on:` can parse as a `true:` key.
  if ('on' in parsed || parsed.true !== undefined) return true;
  const jobs = parsed.jobs as Record<string, Record<string, unknown>>;
  return Object.values(jobs).some((j) => j && typeof j === 'object' && 'runs-on' in j);
}

/**
 * Detect if YAML content represents a GitHub Actions workflow.
 */
function detectFromYaml(parsed: Record<string, unknown>): DetectionResult {
  if (isGithubActionsShape(parsed)) {
    return { platform: 'github-actions', confidence: 'high', label: PLATFORM_LABELS['github-actions'], format: 'yaml' };
  }

  return { platform: 'unknown', confidence: 'low', label: PLATFORM_LABELS['unknown'], format: 'yaml' };
}

/**
 * Detect the workflow platform from file content.
 * For JSON files, pass the parsed JSON object.
 * For YAML files, pass the parsed YAML object.
 */
export function detectWorkflowPlatform(
  parsed: Record<string, unknown>,
  fileExtension: string,
): DetectionResult {
  const ext = fileExtension.toLowerCase();

  if (ext === '.yml' || ext === '.yaml') {
    return detectFromYaml(parsed);
  }

  return detectFromJson(parsed);
}

/**
 * Get the accepted file extensions for all supported platforms.
 */
export function getAcceptedExtensions(): string {
  return '.json,.yml,.yaml';
}

/**
 * Check if a filename has a supported extension.
 */
export function isSupportedFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.yml') || lower.endsWith('.yaml');
}

/** Count workflow elements for preview cards and quick validation UX. */
export function countElements(json: Record<string, unknown>): { count: number; label: string } {
  if (Array.isArray(json.nodes)) return { count: json.nodes.length, label: 'node' };
  if (Array.isArray(json.steps)) return { count: json.steps.length, label: 'step' };
  if (json.trigger && Array.isArray(json.actions)) return { count: (json.actions as unknown[]).length + 1, label: 'step' };
  if (json.blueprint && typeof json.blueprint === 'object') {
    const bp = json.blueprint as Record<string, unknown>;
    if (Array.isArray(bp.flow)) return { count: bp.flow.length, label: 'module' };
  }
  if (Array.isArray(json.flow)) return { count: json.flow.length, label: 'module' };
  if (Array.isArray(json.modules)) return { count: json.modules.length, label: 'module' };
  if (json.jobs && typeof json.jobs === 'object') return { count: Object.keys(json.jobs).length, label: 'job' };
  return { count: 0, label: 'element' };
}

/**
 * Render-friendly platform label for preview summaries.
 *
 * `fileExtension` defaults to `.json` because every current caller has already
 * JSON-parsed its content; pass the real extension when the document came from
 * a YAML file so the preview card and the parser cannot disagree about it.
 */
export function detectPlatformLabel(
  json: Record<string, unknown>,
  fileExtension = '.json',
): string {
  const result = detectWorkflowPlatform(json, fileExtension);
  return result.platform === 'unknown' ? 'Workflow' : result.label;
}

export { PLATFORM_LABELS };
