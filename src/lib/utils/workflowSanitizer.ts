/**
 * Workflow Data Sanitizer
 *
 * Sanitizes untrusted data from imported n8n workflows before it is embedded
 * into AI prompts. Prevents prompt injection attacks by:
 *
 * 1. Restricting names/identifiers to an allowlist of safe characters
 * 2. Escaping special characters that could break prompt structure
 * 3. Stripping prompt injection patterns (section delimiters, role overrides)
 * 4. Truncating fields to safe maximum lengths
 * 5. Validating structural integrity of workflow JSON
 */

// ── Allowlists & Limits ──────────────────────────────────────────────

/** Safe characters for workflow and node names */
const SAFE_NAME_RE = /[^a-zA-Z0-9\s\-_.()/&+:,#@!]/g;

/** Maximum field lengths to prevent oversized injection payloads */
const MAX_LENGTHS = {
  workflowName: 200,
  nodeName: 150,
  nodeType: 200,
  description: 2000,
  parameterKey: 100,
  parameterValue: 5000,
} as const;

// ── Prompt Injection Patterns ────────────────────────────────────────

/**
 * Patterns that indicate prompt injection attempts.
 * These are stripped from all text before embedding in prompts.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Section delimiter injection (matches the app's own prompt format)
  /---SECTION:\w+---/gi,
  // Role/instruction override attempts
  /(?:^|\n)\s*(?:system|user|assistant|human|ai)\s*:/gi,
  // Markdown heading injection (could break prompt structure)
  /(?:^|\n)\s*#{1,6}\s+(INJECT|OVERRIDE|IGNORE|IMPORTANT|CRITICAL|SYSTEM|INSTRUCTION|NOTE:|WARNING:)/gi,
  // XML/HTML tag injection
  /<\/?(?:system|instruction|prompt|role|override|ignore)[^>]*>/gi,
  // Common prompt injection phrases
  /ignore\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?)/gi,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+/gi,
  /you\s+are\s+now\s+(?:a\s+different|no\s+longer|free\s+from)/gi,
  /override\s+(?:system|safety|security)\s+(?:prompt|instruction|rule)/gi,
  /bypass\s+(?:safety|security|restriction|guardrail|filter)/gi,
  // Zero-width characters used to hide content
  /[\u200b\u200c\u200d\u200e\u200f\ufeff\u2060\u2061\u2062\u2063\u2064]/g,
  // ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;]*[a-zA-Z]/g,
];

// ── Core Sanitization Functions ──────────────────────────────────────

/**
 * Sanitize a workflow or node name using a character allowlist.
 * Removes any character not in [a-zA-Z0-9 \-_.()\/&+:,#@!]
 * and truncates to the specified maximum length.
 */
export function sanitizeName(
  name: string | undefined | null,
  maxLen: number = MAX_LENGTHS.nodeName,
): string {
  if (!name || typeof name !== 'string') return '';
  let clean = name.replace(SAFE_NAME_RE, '');
  clean = stripInjectionPatterns(clean);
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean.slice(0, maxLen);
}

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

// ── Injection Pattern Stripping ──────────────────────────────────────

/**
 * Strip known prompt injection patterns from text.
 */
function stripInjectionPatterns(text: string): string {
  let clean = text;
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, '');
  }
  return clean;
}

/**
 * Escape characters that could break prompt structure.
 * Replaces markdown heading markers and triple backticks.
 */
function escapeForPrompt(text: string): string {
  return text
    // Escape markdown headings that could inject prompt sections
    .replace(/^(#{1,6})\s/gm, (_, hashes: string) => `${hashes.replace(/#/g, '＃')} `)
    // Escape triple backticks (could break markdown code fences)
    .replace(/```/g, '\\`\\`\\`')
    // Escape section-like delimiters
    .replace(/^---+$/gm, '———');
}

// ── JSON Sanitization ────────────────────────────────────────────────

/**
 * Sanitize an entire JSON string for safe embedding in prompts.
 * Parses the JSON, sanitizes all string values, and re-serializes.
 */
export function sanitizeJsonForPrompt(jsonStr: string, maxLen = 50_000): string {
  if (!jsonStr || typeof jsonStr !== 'string') return '{}';

  // Truncate before parsing to prevent DoS
  const truncated = jsonStr.slice(0, maxLen);

  let parsed: unknown;
  try {
    parsed = JSON.parse(truncated);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return sanitizeTextField(truncated, maxLen);
  }

  const sanitized = sanitizeParamValue(parsed);
  return JSON.stringify(sanitized);
}

// ── Workflow-Level Sanitization ──────────────────────────────────────

export interface SanitizedWorkflow {
  name: string;
  nodes: SanitizedNode[];
  connections: Record<string, unknown>;
}

export interface SanitizedNode {
  type: string;
  name: string;
  parameters: Record<string, unknown>;
  position?: [number, number];
  typeVersion?: number;
}

/**
 * Sanitize an entire n8n workflow JSON object.
 * This is the main entry point — call this on the raw parsed workflow
 * before passing it to the parser or embedding in prompts.
 */
export function sanitizeWorkflow(raw: unknown): SanitizedWorkflow {
  if (!raw || typeof raw !== 'object') {
    return { name: '', nodes: [], connections: {} };
  }

  const obj = raw as Record<string, unknown>;

  const name = sanitizeName(
    typeof obj.name === 'string' ? obj.name : '',
    MAX_LENGTHS.workflowName,
  );

  const nodes: SanitizedNode[] = [];
  if (Array.isArray(obj.nodes)) {
    for (const node of obj.nodes.slice(0, 200)) {
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;

      if (typeof n.type !== 'string' || typeof n.name !== 'string') continue;

      nodes.push({
        type: sanitizeName(n.type, MAX_LENGTHS.nodeType),
        name: sanitizeName(n.name, MAX_LENGTHS.nodeName),
        parameters: sanitizeParamValue(
          typeof n.parameters === 'object' && n.parameters !== null ? n.parameters : {},
        ) as Record<string, unknown>,
        position: Array.isArray(n.position) && n.position.length === 2
          ? [Number(n.position[0]) || 0, Number(n.position[1]) || 0]
          : undefined,
        typeVersion: typeof n.typeVersion === 'number' ? n.typeVersion : undefined,
      });
    }
  }

  // Sanitize connection keys (node names used as keys)
  const connections: Record<string, unknown> = {};
  if (obj.connections && typeof obj.connections === 'object') {
    for (const [key, value] of Object.entries(obj.connections as Record<string, unknown>)) {
      const safeKey = sanitizeName(key, MAX_LENGTHS.nodeName);
      if (safeKey) {
        connections[safeKey] = value; // Connection structure is structural, not embedded in prompts
      }
    }
  }

  return { name, nodes, connections };
}

/**
 * Sanitize a workflow JSON string for embedding in a prompt.
 * This sanitizes the full JSON structure and re-serializes it.
 */
export function sanitizeWorkflowJson(jsonStr: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return '{"error": "invalid JSON"}';
  }

  const sanitized = sanitizeWorkflow(parsed);
  return JSON.stringify(sanitized);
}
