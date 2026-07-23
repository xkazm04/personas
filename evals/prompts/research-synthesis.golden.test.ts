// GOLDEN EVAL — the research-lab report-synthesis prompt.
//
// `buildSynthesisPrompt` grounds the report-synthesis persona in a project's ACTUAL
// hypotheses / experiments / findings and demands a small, strictly-shaped JSON object
// so the response can be parsed defensively. This eval runs the REAL builder over a
// recorded project fixture and pins: (1) GROUNDING — every real datum reaches the prompt;
// (2) the anti-hallucination instruction survives; (3) the strict JSON output contract is
// declared; (4) empty-state placeholders and the 300-char truncation cap hold.
// Deterministic, no LLM.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSynthesisPrompt,
  type SynthesisPromptArgs,
} from "../../src/features/plugins/research-lab/sub_reports/buildSynthesisPrompt";

const fx = JSON.parse(
  readFileSync(join(process.cwd(), "evals", "fixtures", "research-synthesis", "project.json"), "utf8"),
) as SynthesisPromptArgs;

const prompt = buildSynthesisPrompt(fx);

describe("research synthesis — grounding", () => {
  it("grounds in the project identity (name, thesis, domain, context)", () => {
    expect(prompt).toContain(fx.project.name);
    expect(prompt).toContain(fx.project.thesis!);
    expect(prompt).toContain(fx.project.domain!);
    expect(prompt).toContain(fx.project.description!);
  });

  it("includes every hypothesis statement with its status + confidence", () => {
    for (const h of fx.hypotheses) {
      expect(prompt).toContain(h.statement);
      expect(prompt).toContain(`confidence ${Math.round(h.confidence * 100)}%`);
      expect(prompt).toContain(h.status);
    }
  });

  it("includes every experiment name and every finding title", () => {
    for (const e of fx.experiments) expect(prompt).toContain(e.name);
    for (const f of fx.findings) expect(prompt).toContain(f.title);
  });

  it("announces the real counts of each evidence class", () => {
    expect(prompt).toContain(`Hypotheses (${fx.hypotheses.length}):`);
    expect(prompt).toContain(`Experiments (${fx.experiments.length}):`);
    expect(prompt).toContain(`Findings (${fx.findings.length}):`);
  });
});

describe("research synthesis — anti-hallucination + output contract", () => {
  it("forbids inventing data beyond what was supplied", () => {
    expect(prompt).toMatch(/Ground every claim ONLY in the data above/i);
    expect(prompt).toMatch(/Do not invent findings, citations, or numbers/i);
  });

  it("declares the strict single-object JSON output shape", () => {
    expect(prompt).toMatch(/Return ONLY a single JSON object/i);
    expect(prompt).toContain('{ "abstract": "...", "discussion": "..." }');
  });

  it("asks for both required sections (abstract + discussion)", () => {
    expect(prompt).toMatch(/"abstract"/);
    expect(prompt).toMatch(/"discussion"/);
  });
});

describe("research synthesis — edge cases", () => {
  it("renders placeholders when a project has no recorded evidence", () => {
    const empty = buildSynthesisPrompt({ project: fx.project, hypotheses: [], experiments: [], findings: [] });
    expect(empty).toContain("_No hypotheses recorded._");
    expect(empty).toContain("_No experiments recorded._");
    expect(empty).toContain("_No findings recorded._");
  });

  it("truncates an over-long finding description at the 300-char cap", () => {
    const longFinding = fx.findings.find((f) => (f.description ?? "").length > 300)!;
    expect(longFinding).toBeTruthy();
    expect(prompt).toContain("…"); // ellipsis marker from truncate()
    // the tail past the cap must not reach the prompt verbatim
    expect(prompt).not.toContain("downstream consumers.");
  });
});
