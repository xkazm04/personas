import { describe, it, expect } from 'vitest';
import { sanitizeVariableValue } from '../variableSanitizer';
import { sanitizeTextField, sanitizeName } from '../workflowSanitizer';
import { stripInjectionPatterns, escapeForPrompt, INJECTION_PATTERNS } from '../promptInjection';

// Canonical injection payload corpus. Each payload exercises a protection
// that -- before the promptInjection.ts extraction -- only ONE of the two
// sanitizers (variableSanitizer.ts / workflowSanitizer.ts) caught, because
// the pattern sets had drifted apart. After the merge, both entry points
// must catch all three.
const NON_BMP_HOMOGLYPH_PAYLOAD = 'Hello \u{1D400}\u{1D401}\u{1D402} world'; // Mathematical bold A/B/C
const TEMPLATE_VAR_PAYLOAD = 'value {{system_prompt}} more text';
const MARKDOWN_HEADING_INJECTION_PAYLOAD = '# INJECT\nDo something malicious\n# OVERRIDE\nmore';

describe('promptInjection shared module', () => {
  it('INJECTION_PATTERNS strips the non-BMP homoglyph payload', () => {
    const result = stripInjectionPatterns(NON_BMP_HOMOGLYPH_PAYLOAD);
    expect(result).not.toMatch(/[\u{10000}-\u{10FFFF}]/u);
    expect(result).toBe('Hello  world');
  });

  it('INJECTION_PATTERNS strips markdown-heading keyword injections', () => {
    const result = stripInjectionPatterns(MARKDOWN_HEADING_INJECTION_PAYLOAD);
    expect(result).not.toMatch(/#{1,6}\s+(INJECT|OVERRIDE)/);
  });

  it('escapeForPrompt neutralizes {{...}} only when neutralizeTemplateVars is set', () => {
    const withNeutralize = escapeForPrompt(TEMPLATE_VAR_PAYLOAD, { neutralizeTemplateVars: true });
    expect(withNeutralize).not.toContain('{{system_prompt}}');
    expect(withNeutralize).toContain('{ {system_prompt} }');

    const withoutNeutralize = escapeForPrompt(TEMPLATE_VAR_PAYLOAD);
    expect(withoutNeutralize).toContain('{{system_prompt}}');
  });

  it('exposes a non-empty pattern list covering both original files worth of regexes', () => {
    // Union of variableSanitizer's 11 STRUCTURAL_PATTERNS + workflowSanitizer's
    // markdown-heading-only pattern = 12 unique regexes.
    expect(INJECTION_PATTERNS.length).toBe(12);
  });
});

describe('variableSanitizer.sanitizeVariableValue (text type) catches the full corpus', () => {
  it('strips the non-BMP homoglyph payload', () => {
    const result = sanitizeVariableValue(NON_BMP_HOMOGLYPH_PAYLOAD, 'text');
    expect(result).not.toMatch(/[\u{10000}-\u{10FFFF}]/u);
  });

  it('neutralizes {{...}} template-variable payloads', () => {
    const result = sanitizeVariableValue(TEMPLATE_VAR_PAYLOAD, 'text');
    expect(result).not.toContain('{{system_prompt}}');
  });

  it('strips markdown-heading keyword injections (previously only workflowSanitizer caught this)', () => {
    const result = sanitizeVariableValue(MARKDOWN_HEADING_INJECTION_PAYLOAD, 'text');
    expect(result).not.toMatch(/#{1,6}\s+(INJECT|OVERRIDE)/);
  });
});

describe('workflowSanitizer.sanitizeTextField catches the full corpus', () => {
  it('strips the non-BMP homoglyph payload (previously only variableSanitizer caught this)', () => {
    const result = sanitizeTextField(NON_BMP_HOMOGLYPH_PAYLOAD);
    expect(result).not.toMatch(/[\u{10000}-\u{10FFFF}]/u);
  });

  it('strips markdown-heading keyword injections', () => {
    const result = sanitizeTextField(MARKDOWN_HEADING_INJECTION_PAYLOAD);
    expect(result).not.toMatch(/#{1,6}\s+(INJECT|OVERRIDE)/);
  });

  it('does NOT neutralize {{...}} (workflow text is not template-substituted)', () => {
    // workflowSanitizer intentionally does not opt into neutralizeTemplateVars --
    // this documents the intentional (non-dropped) behavioral difference.
    const result = sanitizeTextField(TEMPLATE_VAR_PAYLOAD);
    expect(result).toContain('{{system_prompt}}');
  });
});

describe('workflowSanitizer.sanitizeName also picks up shared injection stripping', () => {
  it('strips the non-BMP homoglyph payload from names', () => {
    const result = sanitizeName('Node\u{1D400}Name');
    expect(result).not.toMatch(/[\u{10000}-\u{10FFFF}]/u);
  });
});
