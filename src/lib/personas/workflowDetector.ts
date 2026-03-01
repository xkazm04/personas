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

  return { platform: 'unknown', confidence: 'low', label: PLATFORM_LABELS['unknown'], format: 'json' };
}

/**
 * Detect if YAML content represents a GitHub Actions workflow.
 */
function detectFromYaml(parsed: Record<string, unknown>): DetectionResult {
  // GitHub Actions: has `on` (trigger) and `jobs` keys
  if (parsed.jobs && typeof parsed.jobs === 'object') {
    const hasOn = 'on' in parsed || parsed.true !== undefined; // YAML `on:` can parse as `true:` key
    if (hasOn || parsed.on) {
      return { platform: 'github-actions', confidence: 'high', label: PLATFORM_LABELS['github-actions'], format: 'yaml' };
    }
    // Even without `on`, having `jobs` with `runs-on` is strongly indicative
    const jobs = parsed.jobs as Record<string, Record<string, unknown>>;
    const hasRunsOn = Object.values(jobs).some((j) => j && typeof j === 'object' && 'runs-on' in j);
    if (hasRunsOn) {
      return { platform: 'github-actions', confidence: 'high', label: PLATFORM_LABELS['github-actions'], format: 'yaml' };
    }
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

export { PLATFORM_LABELS };
