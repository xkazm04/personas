/**
 * Unified workflow parser that detects the platform and routes to
 * the appropriate platform-specific parser.
 *
 * All parsers output the same AgentIR type, enabling
 * the rest of the import wizard to work identically regardless of source.
 */

import yaml from 'js-yaml';
import type { LoadOptions } from 'js-yaml';
import type { AgentIR } from '@/lib/types/designTypes';
import { sanitizeTextField } from '@/lib/utils/sanitizers/workflowSanitizer';
import {
  detectWorkflowPlatform,
  PLATFORM_LABELS,
  type WorkflowPlatform,
  type DetectionResult,
} from './workflowDetector';
import { parseN8nWorkflow } from './n8nParser';
import { parseZapierWorkflow } from './zapierParser';
import { parseMakeWorkflow } from './makeParser';
import { parseGithubActionsWorkflow } from './githubActionsParser';
import { MAX_WORKFLOW_JSON_BYTES } from '@/lib/n8nLimits.generated';
import { createLogger } from '@/lib/log';
import { trackInteraction } from '@/lib/sentry';

const logger = createLogger('workflow-import');

/**
 * js-yaml 4.2 added `maxDepth` (default 100) and `maxMergeSeqLength` (default 20)
 * loader limits that abort parsing with a `YAMLException` rather than degrading
 * into the quadratic-merge / deep-nesting DoS class. Workflow files arrive from
 * external tools (n8n / Zapier / Make / GitHub Actions exports) and are only
 * semi-trusted, so we bound them well below the library defaults — no legitimate
 * exported workflow nests anywhere near this deep. `@types/js-yaml@4.0.9` predates
 * these options, so we widen `LoadOptions` locally until DefinitelyTyped catches up.
 */
type BoundedLoadOptions = LoadOptions & {
  maxDepth?: number;
  maxMergeSeqLength?: number;
};

const WORKFLOW_MAX_DEPTH = 50;

const WORKFLOW_YAML_LOAD_LIMITS: BoundedLoadOptions = {
  maxDepth: WORKFLOW_MAX_DEPTH,
  maxMergeSeqLength: 20,
};

/**
 * The one bounded YAML load in the app.
 *
 * Exported because the upload preview needs to look inside a `.yml` drop
 * BEFORE `parseWorkflowFile` runs — it used to substring-scan the raw text for
 * `jobs:` and report `nodeCount: 0`, which both mis-detected (the literal text
 * `jobs:` inside a comment passes) and promised a workflow with no steps. It
 * must not reach for a bare `yaml.load`: the loader bounds above are the DoS
 * guard for semi-trusted external exports, and a second parse site configured
 * differently is exactly how that guard goes missing.
 *
 * Throws `yaml.YAMLException` on malformed input and a plain `Error` when the
 * document is not an object; callers decide how to present that.
 */
export function loadWorkflowYaml(content: string): Record<string, unknown> {
  const loaded = yaml.load(content, WORKFLOW_YAML_LOAD_LIMITS);
  if (!loaded || typeof loaded !== 'object') {
    throw new Error('YAML file does not contain a valid object.');
  }
  return loaded as Record<string, unknown>;
}

/**
 * Ceiling on the number of values (objects, arrays, scalars) a workflow may
 * contain. Well above any real export — the largest template in this repo is
 * three orders of magnitude below it — and low enough that a hostile file
 * cannot make the downstream adapters and the prompt assembler walk forever.
 */
const WORKFLOW_MAX_VALUES = 250_000;

/**
 * The bounds `JSON.parse` never had.
 *
 * The YAML branch has been bounded since the loader options above were added,
 * with a comment naming the DoS class it closes. The JSON branch — which is the
 * COMMON one, three of the four adapters being JSON — then called bare
 * `JSON.parse(content)` with no byte, depth or entity cap, and no caller
 * imposed one either: the upload, paste and URL hooks all read the whole
 * content before handing it over. The size cap runs BEFORE the parse, because
 * after it the work is already done.
 */
function assertBoundedSize(content: string): void {
  // `length` is UTF-16 code units, which is <= the byte count for any input, so
  // this never rejects a file the byte-based cap would accept.
  if (content.length > MAX_WORKFLOW_JSON_BYTES) {
    throw new Error(
      `Workflow file is too large (limit ${Math.floor(MAX_WORKFLOW_JSON_BYTES / (1024 * 1024))} MB).`,
    );
  }
}

/**
 * Walk the parsed structure iteratively — never recursively, which would trade
 * one denial of service for another — and refuse anything nested deeper or
 * wider than the bounds above. Applied to the YAML result too: the loader
 * bounds depth but not total size.
 */
function assertBoundedStructure(root: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let seen = 0;

  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    seen += 1;
    if (seen > WORKFLOW_MAX_VALUES) {
      throw new Error('Workflow file has too many entries to import.');
    }
    if (depth > WORKFLOW_MAX_DEPTH) {
      throw new Error(`Workflow file is nested too deeply (limit ${WORKFLOW_MAX_DEPTH}).`);
    }
    if (!value || typeof value !== 'object') continue;

    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
    } else {
      for (const item of Object.values(value as Record<string, unknown>)) {
        stack.push({ value: item, depth: depth + 1 });
      }
    }
  }
}

type KnownPlatform = Exclude<WorkflowPlatform, 'unknown'>;

interface PlatformAdapter {
  parse: (data: Record<string, unknown>) => AgentIR;
  /** The file extensions this platform exports as, as shown to the user. */
  extensions: string;
}

/**
 * The single enumeration of routable platforms.
 *
 * Declared as a TOTAL `Record<KnownPlatform, ...>` on purpose: adding a member
 * to `WorkflowPlatform` now fails `tsc` here until it is routed. There used to
 * be three hand-written enumerations of the same set — the detector's labels,
 * the router's `switch`, and the speculative-parse array — and nothing compared
 * them, so `github-actions` went missing from the third while the refusal
 * message printed by that very function went on listing GitHub Actions as
 * supported: a list disagreeing with its own advertisement, under a green test
 * suite. The switch and the array are both derived from this table now, and so
 * is the advertisement.
 *
 * Declaration order IS the speculative-parse order and is load-bearing: the
 * three JSON-family adapters are tried before GitHub Actions so they win the
 * stable-sort tie-break on equal output.
 */
const PLATFORM_ADAPTERS: Record<KnownPlatform, PlatformAdapter> = {
  'n8n': { parse: parseN8nWorkflow, extensions: '.json' },
  'zapier': { parse: parseZapierWorkflow, extensions: '.json' },
  'make': { parse: parseMakeWorkflow, extensions: '.json' },
  'github-actions': { parse: parseGithubActionsWorkflow, extensions: '.yml/.yaml' },
};

/** Every platform the parser can route to, in speculative-parse order. */
export const ROUTABLE_PLATFORMS = Object.keys(PLATFORM_ADAPTERS) as readonly KnownPlatform[];

/** The refusal message's supported-format list, derived from the routing table. */
export function supportedFormatsSentence(): string {
  return ROUTABLE_PLATFORMS.map(
    (platform) => `${PLATFORM_LABELS[platform]} (${PLATFORM_ADAPTERS[platform].extensions})`,
  ).join(', ');
}

export interface WorkflowParseResult {
  /** The detected platform */
  detection: DetectionResult;
  /** The parsed analysis result (same type for all platforms) */
  result: AgentIR;
  /** The workflow name extracted from the file */
  workflowName: string;
  /** Serialized JSON representation of the parsed content */
  rawJson: string;
  /**
   * True when the detected platform is anything less than a high-confidence
   * structural match, so the UI must have the user confirm the FORMAT (not just
   * the entities) before proceeding. Covers both the speculative fallback and a
   * medium-confidence fingerprint (an envelope shape with no signature marker).
   */
  needsConfirmation: boolean;
}

/**
 * Parse a workflow file's text content, auto-detecting the platform.
 *
 * @param content - The raw file content (JSON or YAML text)
 * @param fileName - The original file name (used for extension detection)
 * @returns WorkflowParseResult with detection info and parsed result
 */
export function parseWorkflowFile(content: string, fileName: string): WorkflowParseResult {
  if (!content || content.trim().length === 0) {
    throw new Error('File is empty.');
  }

  assertBoundedSize(content);

  const ext = getExtension(fileName);
  let parsed: Record<string, unknown>;

  // Parse the content based on file extension
  if (ext === '.yml' || ext === '.yaml') {
    try {
      parsed = loadWorkflowYaml(content);
    } catch (err) {
      if (err instanceof yaml.YAMLException) {
        throw Object.assign(new Error(`Invalid YAML: ${err.message}`), { cause: err });
      }
      throw err;
    }
  } else {
    try {
      const result = JSON.parse(content);
      if (!result || typeof result !== 'object') {
        throw new Error('JSON file does not contain a valid object.');
      }
      parsed = result as Record<string, unknown>;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw Object.assign(new Error(`Invalid JSON: ${err.message}`), { cause: err });
      }
      throw err;
    }
  }

  assertBoundedStructure(parsed);

  // Detect the platform
  const detection = detectWorkflowPlatform(parsed, ext);

  // Route to platform-specific parser
  let result: AgentIR;
  let finalDetection = detection;

  if (detection.platform === 'unknown') {
    // Attempt every routable parser and pick the best candidate
    const fallback = tryParsers(parsed, detection.format);
    result = fallback.result;
    finalDetection = {
      platform: fallback.platform,
      confidence: fallback.confidence,
      label: PLATFORM_LABELS[fallback.platform],
      format: detection.format,
      // The speculative reparse renames the platform; it does not re-walk the
      // document, so the element count stays the one the detection walk produced.
      count: detection.count,
      noun: detection.noun,
    };
  } else {
    result = PLATFORM_ADAPTERS[detection.platform].parse(parsed);
  }

  // Confidence is not decoration: it is the bit that decides whether the review
  // gate must confirm the FORMAT as well as the entities. A medium-confidence
  // hit (matched on envelope shape only, no signature marker — e.g. `nodes` +
  // `connections` with no `n8n-nodes-base.*` type anywhere) used to proceed as
  // silently as a signature match, so the user was never told what was assumed.
  const needsConfirmation = finalDetection.confidence !== 'high';

  // Extract workflow name from the parsed result summary
  const workflowName = extractWorkflowName(parsed, finalDetection.platform);

  reportDetection(finalDetection, detection.platform === 'unknown');

  // Serialize to JSON for storage (normalize YAML to JSON)
  const rawJson = JSON.stringify(parsed);

  return { detection: finalDetection, result, workflowName, rawJson, needsConfirmation };
}

/**
 * The one counter that tells an operator a vendor changed its export format.
 *
 * Nothing under `parsers/` emitted anything at all, so the only way to learn
 * that n8n had shipped a new shape was a support ticket saying "import failed".
 * A rising `speculative` / `low`-confidence rate on one platform is that signal
 * arriving days earlier. `trackInteraction` is the primitive the rest of the
 * app already uses for this; nothing here carries workflow CONTENT, only the
 * shape verdict.
 */
function reportDetection(detected: DetectionResult, speculative: boolean): void {
  const outcome = `${detected.platform}:${detected.confidence}${speculative ? ':speculative' : ''}`;
  logger.info('workflow detected', {
    platform: detected.platform,
    confidence: detected.confidence,
    format: detected.format,
    speculative,
  });
  trackInteraction('workflow_import', 'detected', outcome);
}

/**
 * The refusal counter's other half: a file nothing could parse. A rise here
 * with no matching product change is the same vendor-drift signal seen from
 * the failure side.
 */
function reportDetectionFailure(format: DetectionResult['format'], errors: string[]): void {
  logger.warn('workflow detection failed', { format, adapterErrors: errors.length });
  trackInteraction('workflow_import', 'unrecognized', format);
}

interface TryParsersResult {
  result: AgentIR;
  platform: KnownPlatform;
  confidence: DetectionResult['confidence'];
}

/**
 * Try multiple parsers when platform is unknown.
 * Runs all parsers, collects successes, and picks the best candidate.
 * Confidence is 'medium' when exactly one parser succeeds, 'low' when multiple do.
 */
function tryParsers(
  parsed: Record<string, unknown>,
  format: DetectionResult['format'],
): TryParsersResult {
  const candidates: Array<{ platform: KnownPlatform; result: AgentIR; nodeCount: number }> = [];
  const errors: string[] = [];

  for (const platform of ROUTABLE_PLATFORMS) {
    try {
      const result = PLATFORM_ADAPTERS[platform].parse(parsed);
      // Count meaningful output as a quality signal
      const nodeCount = (result.suggested_tools?.length ?? 0) + (result.suggested_triggers?.length ?? 0) + (result.suggested_connectors?.length ?? 0);
      candidates.push({ platform, result, nodeCount });
    } catch (e) {
      errors.push(`${platform}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }

  if (candidates.length === 0) {
    reportDetectionFailure(format, errors);
    throw new Error(
      `Could not identify the workflow platform. Supported formats: ${supportedFormatsSentence()}.\n\nParser errors:\n${errors.join('\n')}`,
    );
  }

  // Pick the candidate that produced the most meaningful output
  candidates.sort((a, b) => b.nodeCount - a.nodeCount);
  const best = candidates[0]!;

  return {
    result: best.result,
    platform: best.platform,
    confidence: candidates.length === 1 ? 'medium' : 'low',
  };
}

/**
 * Extract a human-readable workflow name from parsed content.
 *
 * This is a SECOND derivation of the name — each adapter derives its own for the
 * prompt — and this is the copy the import wizard displays and persists as the
 * persona's name. It was the only one that stayed raw, so sanitizing inside the
 * adapters left this door open: the name reaches the persona record, and a
 * persona's name is interpolated into its assembled prompt downstream.
 */
function extractWorkflowName(parsed: Record<string, unknown>, platform: WorkflowPlatform): string {
  return sanitizeTextField(rawWorkflowName(parsed, platform), 200) || 'Imported Workflow';
}

function rawWorkflowName(parsed: Record<string, unknown>, platform: WorkflowPlatform): string {
  switch (platform) {
    case 'n8n':
      return typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Imported n8n Workflow';
    case 'zapier':
      return typeof parsed.title === 'string' && parsed.title
        ? parsed.title
        : typeof parsed.name === 'string' && parsed.name
          ? parsed.name
          : 'Imported Zapier Zap';
    case 'make': {
      const bp = parsed.blueprint as Record<string, unknown> | undefined;
      return typeof parsed.name === 'string' && parsed.name
        ? parsed.name
        : typeof bp?.name === 'string' && bp.name
          ? bp.name
          : 'Imported Make Scenario';
    }
    case 'github-actions':
      return typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Imported GitHub Actions Workflow';
    default:
      return typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Imported Workflow';
  }
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '';
}
