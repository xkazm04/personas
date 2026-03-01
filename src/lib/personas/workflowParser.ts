/**
 * Unified workflow parser that detects the platform and routes to
 * the appropriate platform-specific parser.
 *
 * All parsers output the same DesignAnalysisResult type, enabling
 * the rest of the import wizard to work identically regardless of source.
 */

import yaml from 'js-yaml';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import {
  detectWorkflowPlatform,
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
  result: DesignAnalysisResult;
  /** The workflow name extracted from the file */
  workflowName: string;
  /** Serialized JSON representation of the parsed content */
  rawJson: string;
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
  let result: DesignAnalysisResult;
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
    case 'unknown':
      // Attempt n8n first (most common), then Zapier, then Make
      result = tryParsers(parsed);
      break;
  }

  // Extract workflow name from the parsed result summary
  const workflowName = extractWorkflowName(parsed, detection.platform);

  // Serialize to JSON for storage (normalize YAML to JSON)
  const rawJson = JSON.stringify(parsed);

  return { detection, result, workflowName, rawJson };
}

/**
 * Try multiple parsers when platform is unknown.
 */
function tryParsers(parsed: Record<string, unknown>): DesignAnalysisResult {
  const errors: string[] = [];

  // Try n8n first
  try {
    return parseN8nWorkflow(parsed);
  } catch (e) {
    errors.push(`n8n: ${e instanceof Error ? e.message : 'failed'}`);
  }

  // Try Zapier
  try {
    return parseZapierWorkflow(parsed);
  } catch (e) {
    errors.push(`Zapier: ${e instanceof Error ? e.message : 'failed'}`);
  }

  // Try Make
  try {
    return parseMakeWorkflow(parsed);
  } catch (e) {
    errors.push(`Make: ${e instanceof Error ? e.message : 'failed'}`);
  }

  throw new Error(
    `Could not identify the workflow platform. Supported formats: n8n (.json), Zapier (.json), Make (.json), GitHub Actions (.yml/.yaml).\n\nParser errors:\n${errors.join('\n')}`,
  );
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
