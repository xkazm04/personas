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

const WORKFLOW_YAML_LOAD_LIMITS: BoundedLoadOptions = {
  maxDepth: 50,
  maxMergeSeqLength: 20,
};

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

  const ext = getExtension(fileName);
  let parsed: Record<string, unknown>;

  // Parse the content based on file extension
  if (ext === '.yml' || ext === '.yaml') {
    try {
      const loaded = yaml.load(content, WORKFLOW_YAML_LOAD_LIMITS);
      if (!loaded || typeof loaded !== 'object') {
        throw new Error('YAML file does not contain a valid object.');
      }
      parsed = loaded as Record<string, unknown>;
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

  // Detect the platform
  const detection = detectWorkflowPlatform(parsed, ext);

  // Route to platform-specific parser
  let result: AgentIR;
  let finalDetection = detection;

  if (detection.platform === 'unknown') {
    // Attempt every routable parser and pick the best candidate
    const fallback = tryParsers(parsed);
    result = fallback.result;
    finalDetection = {
      platform: fallback.platform,
      confidence: fallback.confidence,
      label: PLATFORM_LABELS[fallback.platform],
      format: detection.format,
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

  // Serialize to JSON for storage (normalize YAML to JSON)
  const rawJson = JSON.stringify(parsed);

  return { detection: finalDetection, result, workflowName, rawJson, needsConfirmation };
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
function tryParsers(parsed: Record<string, unknown>): TryParsersResult {
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
