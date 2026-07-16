/**
 * Shared Prompt-Injection Defense Primitives
 *
 * Common structural-pattern stripping and prompt-context escaping shared by
 * `variableSanitizer.ts` and `workflowSanitizer.ts`. Both sanitize untrusted
 * text before it is embedded into AI prompts; this module is the single
 * source of truth for the union of protections either one needs, so the two
 * call sites can never drift apart again.
 *
 * Uses structural patterns that target prompt *structure* exploits rather
 * than a blocklist of specific injection phrases (which are trivially
 * bypassed via synonyms, word-splitting, homoglyphs, and encoding tricks).
 * Per OWASP LLM01, structural isolation is the primary defence.
 */

// -- Injection Patterns --------------------------------------------------
// Union of variableSanitizer's former STRUCTURAL_PATTERNS and
// workflowSanitizer's former INJECTION_PATTERNS. Every regex that either
// original file had is preserved here -- nothing was dropped.

export const INJECTION_PATTERNS: RegExp[] = [
  // Section delimiter injection (matches the app's own prompt format)
  /---SECTION:\w+---/gi,
  // Role override lines (system:, user:, assistant:, etc.)
  /(?:^|\n)\s*(?:system|user|assistant|human|ai)\s*:/gi,
  // Markdown heading injection (could break prompt structure)
  // -- from workflowSanitizer.ts only
  /(?:^|\n)\s*#{1,6}\s+(INJECT|OVERRIDE|IGNORE|IMPORTANT|CRITICAL|SYSTEM|INSTRUCTION|NOTE:|WARNING:)/gi,
  // Dangerous XML/HTML tags that could inject prompt structure
  /<\/?(?:system|instruction|prompt|role|override|ignore)[^>]*>/gi,
  // Common prompt injection phrases
  /ignore\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?)/gi,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+/gi,
  /you\s+are\s+now\s+(?:a\s+different|no\s+longer|free\s+from)/gi,
  /override\s+(?:system|safety|security)\s+(?:prompt|instruction|rule)/gi,
  /bypass\s+(?:safety|security|restriction|guardrail|filter)/gi,
  // Invisible/zero-width Unicode characters used to hide content
  // eslint-disable-next-line no-misleading-character-class
  /[\u200b\u200c\u200d\u200e\u200f\ufeff\u2060\u2061\u2062\u2063\u2064]/g,
  // ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;]*[a-zA-Z]/g,
  // Non-BMP Unicode (homoglyph defence -- e.g. Mathematical Alphanumeric
  // Symbols) -- from variableSanitizer.ts only
  /[\u{10000}-\u{10FFFF}]/gu,
];

/**
 * Strip all known prompt-injection structural patterns from text.
 */
export function stripInjectionPatterns(text: string): string {
  let clean = text;
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, '');
  }
  return clean;
}

export interface EscapeForPromptOptions {
  /**
   * Neutralize `{{...}}` template-variable syntax to prevent recursive
   * substitution when a sanitized value could itself contain another
   * template placeholder. Variable-value specific (variableSanitizer wants
   * this on); off by default since most callers (e.g. workflowSanitizer)
   * sanitize free text that legitimately may contain `{{` as literal text
   * with no template-substitution pass applied afterward.
   */
  neutralizeTemplateVars?: boolean;
}

/**
 * Escape structural characters that could break prompt formatting when
 * untrusted text is substituted into a prompt section.
 */
export function escapeForPrompt(text: string, opts: EscapeForPromptOptions = {}): string {
  let clean = text
    // Escape markdown headings that could inject prompt sections
    .replace(/^(#{1,6})\s/gm, (_, hashes: string) => `${hashes.replace(/#/g, '＃')} `)
    // Escape triple backticks (could break markdown code fences)
    .replace(/```/g, '\\`\\`\\`')
    // Escape section-like delimiters
    .replace(/^---+$/gm, '------');

  if (opts.neutralizeTemplateVars) {
    // Neutralize {{...}} patterns to prevent recursive substitution
    clean = clean.replace(/\{\{(\w+)\}\}/g, '{ {$1} }');
  }

  return clean;
}
