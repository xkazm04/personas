/**
 * Format detection layer for multi-platform workflow import.
 * Identifies the source platform from file structure and content.
 */

export type WorkflowPlatform = 'n8n' | 'zapier' | 'make' | 'github-actions' | 'unknown';

/** Singular noun for the element collection a platform is counted in. */
export type ElementNoun = 'node' | 'step' | 'module' | 'job' | 'element';

export interface DetectionResult {
  platform: WorkflowPlatform;
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable label for the platform */
  label: string;
  /** File format hint */
  format: 'json' | 'yaml';
  /**
   * Size of the element collection that belongs to `platform` — produced by the
   * same walk, in the same branch, that named the platform.
   */
  count: number;
  /** Singular noun for the collection `count` came from. */
  noun: ElementNoun;
}

const PLATFORM_LABELS: Record<WorkflowPlatform, string> = {
  'n8n': 'n8n',
  'zapier': 'Zapier',
  'make': 'Make (Integromat)',
  'github-actions': 'GitHub Actions',
  'unknown': 'Unknown',
};

/**
 * Platforms each file format is allowed to resolve to. A YAML workflow document
 * is a GitHub Actions workflow; the other three platforms export JSON only.
 */
const FORMAT_PLATFORMS: Record<DetectionResult['format'], ReadonlySet<WorkflowPlatform>> = {
  json: new Set<WorkflowPlatform>(['n8n', 'zapier', 'make', 'github-actions']),
  yaml: new Set<WorkflowPlatform>(['github-actions']),
};

/** An element collection found by the walk. */
interface Collection {
  count: number;
  noun: ElementNoun;
}

/**
 * The single detection walk.
 *
 * The platform verdict and the element count used to live in two functions with
 * two rule tables and two precedence orders (`detectFromJson` required evidence
 * inside a collection; `countElements` only required the array to exist). They
 * could — and did — answer two halves of one question differently: a document
 * with an empty `nodes: []` and a populated `flow: []` was counted as 0 nodes by
 * one and detected as Make by the other, and the preview card printed both.
 *
 * Here every platform rule and the collection it counts live in the SAME branch,
 * so the number shown always comes from the collection that named the platform.
 * The first collection the walk sees is remembered as the count for a document
 * no rule claims, which keeps the preview card's "N elements" — and the
 * `count === 0` gate its callers use to reject non-workflow files — working for
 * a structured-but-unrecognized export.
 */
function analyzeWorkflow(
  json: Record<string, unknown>,
  format: DetectionResult['format'],
): DetectionResult {
  const allowed = FORMAT_PLATFORMS[format];
  let fallback: Collection | null = null;

  /** Record a collection as the unknown-platform count, and hand it back. */
  const seen = (collection: Collection): Collection => {
    fallback ??= collection;
    return collection;
  };

  const resolve = (
    platform: WorkflowPlatform,
    confidence: DetectionResult['confidence'],
    collection: Collection,
  ): DetectionResult => ({
    platform,
    confidence,
    label: PLATFORM_LABELS[platform],
    format,
    count: collection.count,
    noun: collection.noun,
  });

  // n8n: a `nodes` array whose objects carry `n8n-nodes-base.*` types.
  if (Array.isArray(json.nodes)) {
    const nodes = json.nodes as Array<Record<string, unknown>>;
    const here = seen({ count: nodes.length, noun: 'node' });
    if (allowed.has('n8n')) {
      const hasN8nTypes = nodes.some(
        (n) => typeof n.type === 'string' && (n.type.startsWith('n8n-nodes-base.') || n.type.includes('n8n')),
      );
      if (hasN8nTypes) return resolve('n8n', 'high', here);
      // Could still be n8n without the prefix (custom nodes)
      if (json.connections && typeof json.connections === 'object') {
        return resolve('n8n', 'medium', here);
      }
    }
  }

  // Zapier: a `steps` array whose objects carry `app` / `action` fields.
  if (Array.isArray(json.steps)) {
    const steps = json.steps as Array<Record<string, unknown>>;
    const here = seen({ count: steps.length, noun: 'step' });
    if (allowed.has('zapier')) {
      const hasZapierShape = steps.some(
        (s) => typeof s.app === 'string' || typeof s.action === 'string' || typeof s.action_id === 'string',
      );
      if (hasZapierShape) return resolve('zapier', 'high', here);
    }
  }

  // Zapier alternative: top-level `trigger` + `actions` array.
  if (json.trigger && typeof json.trigger === 'object' && Array.isArray(json.actions)) {
    const here = seen({ count: (json.actions as unknown[]).length + 1, noun: 'step' });
    if (allowed.has('zapier')) return resolve('zapier', 'medium', here);
  }

  // Make (Integromat): a `flow` array of `module` objects.
  if (Array.isArray(json.flow)) {
    const flow = json.flow as Array<Record<string, unknown>>;
    const here = seen({ count: flow.length, noun: 'module' });
    if (allowed.has('make')) {
      const hasMakeModules = flow.some(
        (m) => typeof m.module === 'string' || typeof m.type === 'string',
      );
      if (hasMakeModules) return resolve('make', 'high', here);
    }
  }

  // Make alternative: `blueprint` wrapper containing `flow`.
  if (json.blueprint && typeof json.blueprint === 'object') {
    const blueprint = json.blueprint as Record<string, unknown>;
    if (Array.isArray(blueprint.flow)) {
      const here = seen({ count: blueprint.flow.length, noun: 'module' });
      if (allowed.has('make')) return resolve('make', 'high', here);
    }
  }

  // Make alternative: top-level `modules` array.
  if (Array.isArray(json.modules)) {
    const modules = json.modules as Array<Record<string, unknown>>;
    const here = seen({ count: modules.length, noun: 'module' });
    if (allowed.has('make')) {
      const hasMakeShape = modules.some(
        (m) => typeof m.module === 'string' || typeof m.mapper === 'object',
      );
      if (hasMakeShape) return resolve('make', 'medium', here);
    }
  }

  // GitHub Actions. The GHA signature once lived only in the YAML branch, so a
  // jobs-shaped document reaching detection with a non-YAML extension — which is
  // every preview-card call, and any workflow saved as .json — was reported as
  // `unknown` even though the element count right below already counted its jobs.
  // Confidence is `medium` for JSON, not `high`: the structure matches but the
  // file did not arrive in the format GitHub exports, so the wizard still asks
  // the user to confirm the format.
  if (json.jobs && typeof json.jobs === 'object') {
    const here = seen({ count: Object.keys(json.jobs as object).length, noun: 'job' });
    if (allowed.has('github-actions') && isGithubActionsShape(json)) {
      return resolve('github-actions', format === 'yaml' ? 'high' : 'medium', here);
    }
  }

  return resolve('unknown', 'low', fallback ?? { count: 0, noun: 'element' });
}

/**
 * The GitHub Actions structural signature: a `jobs` map, plus either an `on`
 * trigger (which YAML may have parsed into the boolean key `true`) or a job
 * carrying `runs-on`.
 */
function isGithubActionsShape(parsed: Record<string, unknown>): boolean {
  if (!parsed.jobs || typeof parsed.jobs !== 'object') return false;
  // YAML `on:` can parse as a `true:` key.
  if ('on' in parsed || parsed.true !== undefined) return true;
  const jobs = parsed.jobs as Record<string, Record<string, unknown>>;
  return Object.values(jobs).some((j) => j && typeof j === 'object' && 'runs-on' in j);
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
  const format: DetectionResult['format'] = ext === '.yml' || ext === '.yaml' ? 'yaml' : 'json';
  return analyzeWorkflow(parsed, format);
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

/**
 * Count workflow elements for preview cards and quick validation UX.
 *
 * Derived from the detection walk rather than re-implementing it, so the number
 * a preview card prints and the platform name printed beside it can never come
 * from two different collections.
 */
export function countElements(json: Record<string, unknown>): { count: number; label: ElementNoun } {
  const { count, noun } = detectWorkflowPlatform(json, '.json');
  return { count, label: noun };
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
