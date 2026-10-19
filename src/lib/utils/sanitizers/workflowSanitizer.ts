/**
 * Workflow Data Sanitizer
 *
 * Sanitizes untrusted data from imported n8n workflows before it is embedded
 * into AI prompts. Prevents prompt injection attacks by:
 *
 * 1. Escaping special characters that could break prompt structure
 * 2. Stripping prompt injection patterns (section delimiters, role overrides)
 * 3. Restricting parameter keys to identifier characters
 * 4. Truncating fields to safe maximum lengths
 */

import { stripInjectionPatterns, escapeForPrompt } from './promptInjection';

// -- Allowlists & Limits ----------------------------------------------

/**
 * Maximum field lengths to prevent oversized injection payloads.
 *
 * Exported because `workflowPipeline` hand-copied `workflowName` and `nodeName`
 * into its own `MAX_NAME_LEN` / `MAX_LABEL_LEN`, with a comment saying they were
 * "sized to match" these — a mirror that nothing compared. Same rule, one
 * definition.
 */
export const MAX_LENGTHS = {
  workflowName: 200,
  nodeName: 150,
  nodeType: 200,
  description: 2000,
  parameterKey: 100,
  parameterValue: 5000,
} as const;

// -- Prompt Injection Patterns ----------------------------------------
//
// The shared pattern set (plus a non-BMP homoglyph defense this file didn't
// previously have) and strip/escape helpers now live in `promptInjection.ts`
// so this file and every other prompt-embedding caller strip the same set.

// -- Core Sanitization Functions --------------------------------------

/**
 * Sanitize a description or free-text field for prompt embedding.
 * Escapes structural characters and strips injection patterns.
 */
export function sanitizeTextField(
  text: string | undefined | null,
  maxLen: number = MAX_LENGTHS.description,
): string {
  if (!text || typeof text !== 'string') return '';
  let clean = text;
  // Strip injection patterns
  clean = stripInjectionPatterns(clean);
  // Escape characters that could break prompt structure
  clean = escapeForPrompt(clean);
  // Normalize whitespace (preserve single newlines, collapse runs)
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();
  return clean.slice(0, maxLen);
}

/**
 * Sanitize a parameter key (identifier-like string).
 */
export function sanitizeParamKey(key: string): string {
  if (!key || typeof key !== 'string') return '';
  return key
    .replace(/[^a-zA-Z0-9_\-.]/g, '')
    .slice(0, MAX_LENGTHS.parameterKey);
}

/**
 * Sanitize a parameter value. Handles strings, numbers, booleans,
 * and recursively sanitizes objects/arrays.
 */
export function sanitizeParamValue(value: unknown, depth = 0): unknown {
  // Prevent deep recursion attacks
  if (depth > 10) return null;

  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;

  if (typeof value === 'string') {
    return sanitizeTextField(value, MAX_LENGTHS.parameterValue);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => sanitizeParamValue(v, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries.slice(0, 100)) {
      result[sanitizeParamKey(k)] = sanitizeParamValue(v, depth + 1);
    }
    return result;
  }

  return null;
}
