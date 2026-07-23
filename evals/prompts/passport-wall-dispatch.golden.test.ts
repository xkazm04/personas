// GOLDEN EVAL — the passport wall's Fleet dispatch-prompt library (R20 wall integration).
//
// When the user runs a unified-setup row (tests / security / evals / migrations) on the
// passport wall, `buildDirectionPrompt` composes the prompt that is dispatched to a Fleet
// Dev-runner Claude session — a real, high-value LLM call site (the prompt IS the plan).
// This eval runs the REAL builder over the REAL ROW_DIRECTIONS and pins the three
// load-bearing invariants the design doc calls out: (1) SKILLS-FIRST — every dispatch
// tells the agent to prefer a matching repo/global skill; (2) the security direction
// carries the Claude-Security impact/coverage discipline; (3) every dispatch ends with
// the working contract (atomic commits + a report). Deterministic, no LLM.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROW_DIRECTIONS, buildDirectionPrompt } from "../../src/features/teams/sub_factory/passport/rowDirections";

const input = JSON.parse(
  readFileSync(join(process.cwd(), "evals", "fixtures", "passport-wall", "dispatch-input.json"), "utf8"),
) as { projectName: string; operatorInstruction: string };

describe("passport wall — ROW_DIRECTIONS library", () => {
  it("covers the four unified-setup rows", () => {
    for (const row of ["tests", "security", "evals", "migrations"]) {
      expect(ROW_DIRECTIONS[row], `missing directions for "${row}"`).toBeTruthy();
      expect(ROW_DIRECTIONS[row].length).toBeGreaterThan(0);
    }
  });

  it("every direction is fully specified (label, hint, body, skill hints)", () => {
    for (const [row, dirs] of Object.entries(ROW_DIRECTIONS)) {
      for (const d of dirs) {
        expect(d.id, `${row} direction missing id`).toBeTruthy();
        expect(d.label).toBeTruthy();
        expect(d.hint).toBeTruthy();
        expect(d.body.length, `${d.id} body too thin`).toBeGreaterThan(40);
        expect(d.skillHints.length, `${d.id} has no skill hints (skills-first needs them)`).toBeGreaterThan(0);
      }
    }
  });

  it("the security review direction keeps the impact-ranked, honest-coverage discipline", () => {
    const scan = ROW_DIRECTIONS.security.find((d) => d.id === "g-sec-scan")!;
    expect(scan.body).toContain("HIGH");
    expect(scan.body).toContain("MEDIUM");
    expect(scan.body).toContain("LOW");
    expect(scan.body).toMatch(/confidence/i);
    expect(scan.body).toMatch(/file:line/i);
    expect(scan.body).toMatch(/coverage/i); // what was NOT examined is part of the result
  });

  it("the evals scan direction asks for a blast-radius-ranked call-site inventory, report-only", () => {
    const scan = ROW_DIRECTIONS.evals.find((d) => d.id === "g-evals-scan")!;
    expect(scan.body).toMatch(/LLM call site/i);
    expect(scan.body).toMatch(/blast radius/i);
    expect(scan.body).toMatch(/report only/i);
  });
});

describe("passport wall — buildDirectionPrompt", () => {
  const direction = ROW_DIRECTIONS.security.find((d) => d.id === "g-sec-scan")!;
  const prompt = buildDirectionPrompt({
    projectName: input.projectName,
    direction,
    instruction: input.operatorInstruction,
  });

  it("names the target project", () => {
    expect(prompt).toContain(input.projectName);
  });

  it("opens SKILLS-FIRST — prefer a matching repo/global skill over the generic plan", () => {
    expect(prompt).toContain(".claude/skills/");
    expect(prompt).toContain("~/.claude/skills/");
    expect(prompt).toMatch(/follow that skill instead/i);
    // the direction's own skill hints are surfaced for matching
    for (const hint of direction.skillHints) expect(prompt).toContain(hint);
  });

  it("carries the direction body through verbatim", () => {
    expect(prompt).toContain(direction.body);
  });

  it("folds the operator's instruction in as data, clearly labelled", () => {
    expect(prompt).toMatch(/Additional instructions from the operator:/);
    expect(prompt).toContain(input.operatorInstruction);
  });

  it("always closes with the working contract (atomic commits + a report)", () => {
    expect(prompt).toMatch(/commit atomically/i);
    expect(prompt).toMatch(/finish with a short report/i);
  });

  it("omits the operator clause when no instruction is given", () => {
    const bare = buildDirectionPrompt({ projectName: input.projectName, direction });
    expect(bare).not.toMatch(/Additional instructions from the operator:/);
    // skills-first + contract still present
    expect(bare).toMatch(/follow that skill instead/i);
    expect(bare).toMatch(/finish with a short report/i);
  });
});
