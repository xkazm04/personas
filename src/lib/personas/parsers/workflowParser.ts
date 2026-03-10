/**
 * Unified workflow parser that detects the platform and routes to
 * the appropriate platform-specific parser.
 *
 * All parsers output the same AgentIR type, enabling
 * the rest of the import wizard to work identically regardless of source.
 */

import yaml from 'js-yaml';
import type { AgentIR } from '@/lib/types/designTypes';
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

export interface WorkflowParseResult {
  /** The detected platform */
  detection: DetectionResult;
  /** The parsed analysis result (same type for all platforms) */
  result: AgentIR;
  /** The workflow name extracted from the file */
  workflowName: string;
  /** Serialized JSON representation of the parsed content */
  rawJson: string;
  /** True when the platform was guessed via fallback parsing and confidence is low */
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
      const loaded = yaml.load(content);
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
  let needsConfirmation = false;
  let finalDetection = detection;

  switch (detection.platform) {
    case 'n8n':
      result = parseN8nWorkflow(parsed);
      break;
    case 'zapier':
      result = parseZapierWorkflow(parsed);
      break;
    case 'make':
      result = parseMakeWorkflow(parsed);
      break;
    case 'github-actions':
      result = parseGithubActionsWorkflow(parsed);
      break;
    case 'unknown': {
      // Attempt all parsers and pick the best candidate
      const fallback = tryParsers(parsed);
      result = fallback.result;
      finalDetection = {
        platform: fallback.platform,
        confidence: fallback.confidence,
        label: PLATFORM_LABELS[fallback.platform],
        format: detection.format,
      };
      // Flag for user confirmation when confidence is not high
      needsConfirmation = true;
      break;
    }
  }

  // Extract workflow name from the parsed result summary
  const workflowName = extractWorkflowName(parsed, finalDetection.platform);

  // Serialize to JSON for storage (normalize YAML to JSON)
  const rawJson = JSON.stringify(parsed);

  return { detection: finalDetection, result, workflowName, rawJson, needsConfirmation };
}

interface TryParsersResult {
  result: AgentIR;
  platform: Exclude<WorkflowPlatform, 'unknown'>;
  confidence: DetectionResult['confidence'];
}

/**
 * Try multiple parsers when platform is unknown.
 * Runs all parsers, collects successes, and picks the best candidate.
 * Confidence is 'medium' when exactly one parser succeeds, 'low' when multiple do.
 */
function tryParsers(parsed: Record<string, unknown>): TryParsersResult {
  const candidates: Array<{ platform: Exclude<WorkflowPlatform, 'unknown'>; result: AgentIR; nodeCount: number }> = [];
  const errors: string[] = [];

  const parsers: Array<{ platform: Exclude<WorkflowPlatform, 'unknown'>; parse: (d: Record<string, unknown>) => AgentIR }> = [
    { platform: 'n8n', parse: parseN8nWorkflow },
    { platform: 'zapier', parse: parseZapierWorkflow },
    { platform: 'make', parse: parseMakeWorkflow },
  ];

  for (const { platform, parse } of parsers) {
    try {
      const result = parse(parsed);
      // Count meaningful output as a quality signal
      const nodeCount = (result.suggested_tools?.length ?? 0) + (result.suggested_triggers?.length ?? 0) + (result.suggested_connectors?.length ?? 0);
      candidates.push({ platform, result, nodeCount });
    } catch (e) {
      errors.push(`${platform}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      `Could not identify the workflow platform. Supported formats: n8n (.json), Zapier (.json), Make (.json), GitHub Actions (.yml/.yaml).\n\nParser errors:\n${errors.join('\n')}`,
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
 */
function extractWorkflowName(parsed: Record<string, unknown>, platform: WorkflowPlatform): string {
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
