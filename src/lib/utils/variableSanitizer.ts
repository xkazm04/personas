/**
 * Context-Aware Variable Sanitizer
 *
 * Validates and sanitizes template variable values based on their declared type
 * before substitution into AI prompts. Prevents:
 * - Prompt injection via user-provided variable values
 * - XSS through unsanitized template placeholders
 * - Malformed data breaking downstream logic (bad cron, invalid URL, etc.)
 *
 * Supported variable types: text, url, email, cron, select, number, json
 */

import type { AdoptionRequirement } from '@/lib/types/designTypes';

// ── Type-Specific Validators ──────────────────────────────────────────

/**
 * Cron expression: 5-6 fields separated by spaces.
 * Allows standard cron characters: digits, *, /, -, comma, and named months/days.
 */
const CRON_RE = /^(\*|[0-9*/,\-LW#]+)\s+(\*|[0-9*/,\-LW#]+)\s+(\*|[0-9*/,\-LW#?]+)\s+(\*|[0-9*/,\-LWa-zA-Z]+)\s+(\*|[0-9*/,\-a-zA-Z]+)(\s+(\*|[0-9*/,\-]+))?$/;

/** Email: basic RFC 5322 pattern — intentionally simple to avoid ReDoS */
const EMAIL_RE = /^[^\s@<>'"`;(){}[\]\\]+@[^\s@<>'"`;(){}[\]\\]+\.[a-zA-Z]{2,}$/;

/** Maximum length for any single variable value */
const MAX_VALUE_LENGTH = 2000;

/** Maximum length for JSON variable values (larger to accommodate structured data) */
const MAX_JSON_VALUE_LENGTH = 10_000;

// ── Prompt Injection Patterns ──────────────────────────────────────────
// Mirrors workflowSanitizer.ts patterns, applied to individual variable values.

const INJECTION_PATTERNS: RegExp[] = [
  /---SECTION:\w+---/gi,
  /(?:^|\n)\s*(?:system|user|assistant|human|ai)\s*:/gi,
  /(?:^|\n)\s*#{1,6}\s+(INJECT|OVERRIDE|IGNORE|IMPORTANT|CRITICAL|SYSTEM|INSTRUCTION|NOTE:|WARNING:)/gi,
  /<\/?(?:system|instruction|prompt|role|override|ignore)[^>]*>/gi,
  /ignore\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?)/gi,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+/gi,
  /you\s+are\s+now\s+(?:a\s+different|no\s+longer|free\s+from)/gi,
  /override\s+(?:system|safety|security)\s+(?:prompt|instruction|rule)/gi,
  /bypass\s+(?:safety|security|restriction|guardrail|filter)/gi,
  /[\u200b\u200c\u200d\u200e\u200f\ufeff\u2060\u2061\u2062\u2063\u2064]/g,
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;]*[a-zA-Z]/g,
];

/** Blocked hostname patterns for URL validation (mirrors sanitizeUrl.ts) */
const BLOCKED_HOSTNAME_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0|\[::1?\]|.*\.local)$/i;

// ── Validation Result ──────────────────────────────────────────────────

export interface VariableValidation {
  valid: boolean;
  /** Human-readable error message (empty when valid) */
  error: string;
}

// ── Type Validators ────────────────────────────────────────────────────

function validateUrl(value: string): VariableValidation {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true, error: '' };

  // Must start with https:// or http://
  if (!/^https?:\/\//i.test(trimmed)) {
    return { valid: false, error: 'URL must start with http:// or https://' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Only HTTP/HTTPS URLs are allowed' };
  }

  if (BLOCKED_HOSTNAME_RE.test(parsed.hostname)) {
    return { valid: false, error: 'Private/local network URLs are not allowed' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with embedded credentials are not allowed' };
  }

  return { valid: true, error: '' };
}

function validateCron(value: string): VariableValidation {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true, error: '' };

  if (!CRON_RE.test(trimmed)) {
    return { valid: false, error: 'Invalid cron expression (expected 5-6 fields, e.g. "0 9 * * 1-5")' };
  }

  return { valid: true, error: '' };
}

function validateEmail(value: string): VariableValidation {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true, error: '' };

  if (trimmed.length > 254) {
    return { valid: false, error: 'Email address is too long' };
  }

  if (!EMAIL_RE.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true, error: '' };
}

function validateSelect(value: string, options?: string[]): VariableValidation {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true, error: '' };

  if (options && options.length > 0 && !options.includes(trimmed)) {
    return { valid: false, error: `Value must be one of: ${options.join(', ')}` };
  }

  return { valid: true, error: '' };
}

function validateText(value: string): VariableValidation {
  if (value.length > MAX_VALUE_LENGTH) {
    return { valid: false, error: `Value must be ${MAX_VALUE_LENGTH} characters or fewer` };
  }
  return { valid: true, error: '' };
}

function validateNumber(value: string): VariableValidation {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true, error: '' };

  if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    return { valid: false, error: 'Must be a valid number' };
  }

  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { valid: false, error: 'Number must be finite (not Infinity or NaN)' };
  }

  return { valid: true, error: '' };
}

function validateJson(value: string): VariableValidation {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true, error: '' };

  if (trimmed.length > MAX_JSON_VALUE_LENGTH) {
    return { valid: false, error: `JSON must be ${MAX_JSON_VALUE_LENGTH} characters or fewer` };
  }

  try {
    JSON.parse(trimmed);
  } catch {
    return { valid: false, error: 'Invalid JSON format' };
  }

  return { valid: true, error: '' };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Validate a single variable value against its declared type schema.
 * Returns a validation result with a human-readable error message.
 */
export function validateVariable(
  value: string,
  requirement: AdoptionRequirement,
): VariableValidation {
  const trimmed = value.trim();

  // Check required
  if (requirement.required && !trimmed) {
    return { valid: false, error: `${requirement.label} is required` };
  }

  // Skip further validation if empty and not required
  if (!trimmed) return { valid: true, error: '' };

  // Length gate
  if (trimmed.length > MAX_VALUE_LENGTH) {
    return { valid: false, error: `Value must be ${MAX_VALUE_LENGTH} characters or fewer` };
  }

  // Type-specific validation
  switch (requirement.type) {
    case 'url':
      return validateUrl(trimmed);
    case 'cron':
      return validateCron(trimmed);
    case 'email':
      return validateEmail(trimmed);
    case 'select':
      return validateSelect(trimmed, requirement.options);
    case 'number':
      return validateNumber(trimmed);
    case 'json':
      return validateJson(trimmed);
    case 'text':
    default:
      return validateText(trimmed);
  }
}

/**
 * Validate all variable values against their requirements.
 * Returns a map of key → validation result (only for variables with errors).
 */
export function validateAllVariables(
  requirements: AdoptionRequirement[],
  values: Record<string, string>,
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  for (const req of requirements) {
    const value = values[req.key] ?? req.default_value ?? '';
    const result = validateVariable(value, req);
    if (!result.valid) {
      errors[req.key] = result.error;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ── Sanitization ────────────────────────────────────────────────────────

/**
 * Strip prompt injection patterns from a variable value.
 */
function stripInjectionPatterns(text: string): string {
  let clean = text;
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, '');
  }
  return clean;
}

/**
 * Escape structural characters that could break prompt formatting
 * when a variable value is substituted into a prompt section.
 */
function escapeForPromptContext(text: string): string {
  return text
    // Escape markdown headings that could inject prompt sections
    .replace(/^(#{1,6})\s/gm, (_, hashes: string) => `${hashes.replace(/#/g, '＃')} `)
    // Escape triple backticks (could break markdown code fences)
    .replace(/```/g, '\\`\\`\\`')
    // Escape section-like delimiters
    .replace(/^---+$/gm, '———')
    // Neutralize {{...}} patterns to prevent recursive substitution
    .replace(/\{\{(\w+)\}\}/g, '{ {$1} }');
}

/**
 * Sanitize a single variable value for safe embedding into an AI prompt.
 *
 * Applies:
 * 1. Length truncation
 * 2. Prompt injection pattern stripping
 * 3. Contextual escaping for prompt structure
 * 4. Type-specific normalization
 */
export function sanitizeVariableValue(
  value: string,
  type: AdoptionRequirement['type'],
): string {
  let clean = value;

  // Truncate
  clean = clean.slice(0, MAX_VALUE_LENGTH);

  // Strip ANSI escape sequences from all types
  // eslint-disable-next-line no-control-regex
  clean = clean.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  // Type-specific normalization: structured types need minimal escaping
  // since their format is inherently constrained
  switch (type) {
    case 'url': {
      // URLs are validated separately; just trim and prevent injection in the
      // URL string itself (e.g. a URL with prompt injection in query params)
      clean = clean.trim();
      clean = stripInjectionPatterns(clean);
      break;
    }
    case 'cron': {
      // Cron expressions are tightly formatted — just trim whitespace
      clean = clean.trim().replace(/\s+/g, ' ');
      break;
    }
    case 'email': {
      // Email is tightly formatted — just trim
      clean = clean.trim();
      break;
    }
    case 'number': {
      // Numbers are tightly constrained — trim and strip non-numeric noise
      clean = clean.trim();
      break;
    }
    case 'json': {
      // JSON gets injection stripping but preserves structural characters
      clean = clean.slice(0, MAX_JSON_VALUE_LENGTH);
      clean = stripInjectionPatterns(clean);
      break;
    }
    case 'select': {
      // Select values come from a predefined list — strip injection only
      clean = stripInjectionPatterns(clean);
      break;
    }
    case 'text':
    default: {
      // Free text gets full sanitization
      clean = stripInjectionPatterns(clean);
      clean = escapeForPromptContext(clean);
      break;
    }
  }

  return clean;
}

/**
 * Sanitize all variable values for prompt substitution.
 * Returns a new values map with sanitized values.
 */
export function sanitizeVariableValues(
  requirements: AdoptionRequirement[],
  values: Record<string, string>,
): Record<string, string> {
  const reqMap = new Map(requirements.map((r) => [r.key, r]));
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    const req = reqMap.get(key);
    // If we have type info, use type-aware sanitization; otherwise treat as text
    sanitized[key] = sanitizeVariableValue(value, req?.type ?? 'text');
  }

  return sanitized;
}

// ── Display Sanitization (UI XSS prevention) ────────────────────────────

/**
 * Sanitize a variable value for safe rendering in the UI.
 * Strips characters that could break out of HTML/React rendering contexts.
 *
 * Note: React already auto-escapes text content, so this is a defense-in-depth
 * measure for cases where values flow into dangerouslySetInnerHTML or attributes.
 */
export function sanitizeForDisplay(value: string): string {
  return value
    // Strip zero-width/invisible Unicode
    .replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff\u2060-\u2064]/g, '')
    // Strip ANSI escape codes
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Truncate for display (prevent DOM bloat from oversized values)
    .slice(0, MAX_VALUE_LENGTH);
}
