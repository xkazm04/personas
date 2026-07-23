// GOLDEN EVAL — the passport wall's deploy-dispatch prompts (the Tier-1/Tier-3 "improve"
// actions). "The PROMPTS are the IP" (deployActions.ts header): each `task` action deploys
// Claude Code with a precise golden-standard prompt that encodes what "good" means for a
// passport gap. This eval runs the REAL actions over a recorded passport-with-gaps and
// pins: (1) GATING — an action is offered only when the gap actually exists; (2) STACK
// GROUNDING — the detected stack is injected into the grounding-heavy prompts; (3) the
// read-the-codebase-first / non-destructive discipline survives. Deterministic, no LLM.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEPLOY_ACTIONS,
  applicableDeployActions,
  stackLine,
} from "../../src/features/teams/sub_factory/passport/improve/deployActions";
import type { AppPassport } from "../../src/features/teams/sub_factory/passport/passportModel";
import type { DevProject } from "../../src/lib/bindings/DevProject";

const fx = JSON.parse(
  readFileSync(join(process.cwd(), "evals", "fixtures", "passport-deploy", "passport.json"), "utf8"),
) as { project: DevProject; passport: AppPassport };

const { project, passport } = fx;
const stack = stackLine(passport);

describe("passport deploy — stack grounding", () => {
  it("renders the detected languages and frameworks for prompt grounding", () => {
    expect(stack).toContain("TypeScript");
    expect(stack).toContain("SQL");
    expect(stack).toContain("Fastify");
    expect(stack).toContain("Drizzle");
  });
});

describe("passport deploy — action shape", () => {
  it("every task action carries a title and a prompt; scans carry neither prompt-body", () => {
    for (const a of DEPLOY_ACTIONS) {
      if (a.kind === "task") {
        expect(a.taskTitle, `${a.id} task missing taskTitle`).toBeTruthy();
        expect(a.prompt, `${a.id} task missing prompt`).toBeTruthy();
        expect(a.prompt!(project, passport).length, `${a.id} prompt too thin`).toBeGreaterThan(80);
      } else {
        expect(a.prompt, `${a.id} scan should not carry a task prompt`).toBeUndefined();
      }
    }
  });
});

describe("passport deploy — gating (offer only real gaps)", () => {
  it("offers CLAUDE.md when the repo has no agent instructions", () => {
    const ids = applicableDeployActions("instructions", passport).map((a) => a.id);
    expect(ids).toContain("claude-md");
  });

  it("offers baseline docs + a refresh when docs are absent and rotting", () => {
    const ids = applicableDeployActions("docs", passport).map((a) => a.id);
    expect(ids).toContain("docs-baseline"); // docs === 'none'
    expect(ids).toContain("docs-refresh"); // docRot.dirty > 0
  });

  it("stops offering an action once the gap is closed", () => {
    const filled: AppPassport = structuredClone(passport);
    filled.automationReadiness.artifacts.agentInstructions = ["CLAUDE.md"];
    filled.automationReadiness.artifacts.contextGraph = "full";
    expect(applicableDeployActions("instructions", filled).map((a) => a.id)).not.toContain("claude-md");
    expect(applicableDeployActions("context", filled).map((a) => a.id)).not.toContain("context-scan");
  });
});

describe("passport deploy — golden prompt content", () => {
  const promptFor = (id: string) => {
    const a = DEPLOY_ACTIONS.find((x) => x.id === id)!;
    return a.prompt!(project, passport);
  };

  it("CLAUDE.md: read-first, stack-grounded, anti-hallucination", () => {
    const p = promptFor("claude-md");
    expect(p).toMatch(/Read the codebase first/i);
    expect(p).toContain(stack); // the detected stack is injected verbatim
    expect(p).toMatch(/Do not invent commands that do not exist/i);
  });

  it("baseline docs + memory: read-first, stack-grounded, non-destructive", () => {
    for (const id of ["docs-baseline", "memory-seed"]) {
      const p = promptFor(id);
      expect(p, id).toMatch(/Read the codebase first/i);
      expect(p, id).toContain(stack);
      expect(p, id).toMatch(/Do not touch application code/i);
    }
  });

  it("app-cost file: exact JSON skeleton, gitignore, invent-nothing", () => {
    const p = promptFor("app-cost-file");
    expect(p).toContain('"currency": "USD"');
    expect(p).toContain(".gitignore");
    expect(p).toMatch(/Do NOT invent, estimate or add any services/i);
  });
});
