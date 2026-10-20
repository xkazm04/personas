// GOLDEN EVAL — the shared prompt-injection defense (Tiger cross-cutting finding #5:
// "prompt-injection guards are inconsistent" — the OPEN half of that finding).
//
// Before any untrusted text (an imported n8n workflow, a template variable value) is
// embedded into an AI prompt, it passes through the sanitizers in
// `src/lib/utils/sanitizers/`. This eval runs the REAL sanitizer code over recorded
// attack payloads and asserts the load-bearing security property: structural injection
// markers (role-override lines, "ignore previous instructions", section delimiters, XML
// role tags, zero-width chars) are removed, and the payload survives only as inert data.
// A regex quietly deleted from INJECTION_PATTERNS would fail here instead of shipping a
// hole to every AI call site downstream. Deterministic, no LLM.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  stripInjectionPatterns,
  escapeForPrompt,
  INJECTION_PATTERNS,
} from "../../src/lib/utils/sanitizers/promptInjection";
import {
  MAX_LENGTHS,
  sanitizeParamValue,
  sanitizeTextField,
} from "../../src/lib/utils/sanitizers/workflowSanitizer";

const fx = JSON.parse(
  readFileSync(join(process.cwd(), "evals", "fixtures", "prompt-injection", "attacks.json"), "utf8"),
) as {
  injectionStrings: { label: string; text: string }[];
  escapeCases: Record<string, string>;
  maliciousWorkflow: {
    name: string;
    nodes: { type: string; name: string; parameters: Record<string, unknown> }[];
  };
};

// Zero-width / invisible codepoints INJECTION_PATTERNS strips. Declared as numeric
// codepoints (not literal invisibles) so this source file stays hand-auditable.
const ZERO_WIDTH = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0xfeff, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064];
const hasZeroWidth = (s: string): boolean => [...s].some((ch) => ZERO_WIDTH.includes(ch.codePointAt(0)!));

describe("prompt-injection defense — stripInjectionPatterns", () => {
  it("has a non-trivial pattern set (a truncated blocklist is a silent regression)", () => {
    expect(INJECTION_PATTERNS.length).toBeGreaterThanOrEqual(10);
  });

  for (const { label, text } of fx.injectionStrings) {
    it(`neutralizes the "${label}" payload`, () => {
      const clean = stripInjectionPatterns(text);
      // No role-override line survives (system:/user:/assistant: at line start).
      expect(clean).not.toMatch(/(?:^|\n)\s*(?:system|user|assistant|human|ai)\s*:/i);
      // No app section-delimiter survives.
      expect(clean).not.toContain("---SECTION:");
      // No structural XML role/instruction tag survives.
      expect(clean).not.toMatch(/<\/?(?:system|instruction|prompt|role|override|ignore)[^>]*>/i);
      // The classic override phrase is gone.
      expect(clean).not.toMatch(/ignore\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?)/i);
      // No zero-width / invisible characters remain.
      expect(hasZeroWidth(clean)).toBe(false);
    });
  }

  it("erases zero-width / invisible characters used to smuggle content", () => {
    const smuggled = "hel" + String.fromCharCode(0x200b) + "lo" + String.fromCharCode(0xfeff) + "wor" + String.fromCharCode(0x2060) + "ld";
    expect(hasZeroWidth(smuggled)).toBe(true); // guard: the payload really contains them
    expect(stripInjectionPatterns(smuggled)).toBe("helloworld");
  });

  it("specifically strips the disregard/bypass/you-are-now families", () => {
    const disregard = fx.injectionStrings.find((s) => s.label === "disregard-prior")!;
    const bypass = fx.injectionStrings.find((s) => s.label === "bypass-safety")!;
    const youAreNow = fx.injectionStrings.find((s) => s.label === "you-are-now")!;
    expect(stripInjectionPatterns(disregard.text)).not.toMatch(/disregard\s+(?:all\s+)?(?:previous|prior|above)/i);
    expect(stripInjectionPatterns(bypass.text)).not.toMatch(/bypass\s+(?:safety|security|restriction|guardrail|filter)/i);
    expect(stripInjectionPatterns(youAreNow.text)).not.toMatch(/you\s+are\s+now\s+(?:a\s+different|no\s+longer|free\s+from)/i);
  });
});

describe("prompt-injection defense — escapeForPrompt", () => {
  it("defuses markdown headings so they cannot inject a prompt section", () => {
    const out = escapeForPrompt(fx.escapeCases.markdownHeading);
    expect(out).not.toMatch(/^#{1,6}\s/m); // no raw ATX heading remains at line start
  });

  it("escapes triple backticks and horizontal-rule delimiters", () => {
    expect(escapeForPrompt(fx.escapeCases.codeFence)).not.toContain("```");
    const ruled = escapeForPrompt(fx.escapeCases.sectionRule);
    expect(ruled).not.toMatch(/^---$/m); // the exact 3-dash section rule no longer stands alone
    expect(ruled).toContain("------"); // rewritten to the escaped, non-structural form
  });

  it("neutralizes template-variable syntax only when opted in", () => {
    expect(escapeForPrompt(fx.escapeCases.templateVar)).toContain("{{secret_key}}");
    expect(escapeForPrompt(fx.escapeCases.templateVar, { neutralizeTemplateVars: true })).not.toContain("{{secret_key}}");
  });

  it("returns a safe empty string for empty/undefined input", () => {
    expect(sanitizeTextField(undefined)).toBe("");
    expect(sanitizeTextField(null)).toBe("");
  });
});

// The imported-workflow door is `runExtractionPipeline` (src/lib/personas/parsers/
// workflowPipeline.ts), which every platform adapter lowers through. It applies exactly
// these calls; the eval drives them directly because the pipeline imports through the
// `@/` alias, which this config does not resolve.
describe("prompt-injection defense — imported workflow (the extraction pipeline's sanitizers)", () => {
  const wf = fx.maliciousWorkflow;
  const name = sanitizeTextField(wf.name, MAX_LENGTHS.workflowName);
  const labels = wf.nodes.map((n) => sanitizeTextField(n.name, MAX_LENGTHS.nodeName));
  const configs = wf.nodes.map((n) => sanitizeParamValue(n.parameters));
  const embedded = JSON.stringify({ name, labels, configs });

  it("strips the XML role tag out of the workflow name", () => {
    expect(name).not.toContain("<system>");
    expect(name).toContain("Payroll"); // legitimate content preserved
  });

  it("strips the section-delimiter out of node names", () => {
    expect(labels.length).toBe(1);
    expect(labels[0]).not.toContain("---SECTION:");
    expect(labels[0]).toContain("Fetch");
  });

  it("leaves NO injection marker anywhere in what the prompt embeds", () => {
    expect(embedded).not.toContain("---SECTION:");
    expect(embedded).not.toContain("<system>");
    expect(embedded).not.toMatch(/ignore\s+(?:all\s+)?previous\s+instructions/i);
    // The role-override line rides in a parameter, where it is a real newline.
    const note = String((configs[0] as Record<string, unknown>).note);
    expect(note).not.toMatch(/(?:^|\n)\s*system\s*:/i);
  });
});
