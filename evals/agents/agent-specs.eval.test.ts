// D8 eval harness — the DETERMINISTIC floor: a contract test over the agent library.
//
// It asserts every `.claude/agents/*.md` spec declares a clear output contract, discipline rules,
// and an output budget — so an agent spec can't silently drift into ambiguity (an underspecified
// agent = unreliable output). No LLM, no fixtures, runs in milliseconds. The next layer up —
// golden-output evals that run an agent and check its real output — needs recorded transcripts and
// your judgment on what "good" means per agent; scaffold those alongside this (see evals/README.md).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS_DIR = join(process.cwd(), ".claude", "agents");
const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));

describe("agent library contract", () => {
  it("has at least one agent spec to evaluate", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const text = readFileSync(join(AGENTS_DIR, file), "utf8");
    const frontmatter = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";

    describe(file, () => {
      it("declares name, description, and tools in frontmatter", () => {
        expect(frontmatter, "missing frontmatter block").not.toBe("");
        expect(frontmatter).toMatch(/^name:\s*\S+/m);
        expect(frontmatter).toMatch(/^description:\s*\S+/m);
        expect(frontmatter).toMatch(/^tools:\s*\S+/m);
      });

      it("specifies an output contract (a '## What to return' section)", () => {
        expect(text).toMatch(/##\s*what to return/i);
      });

      it("states discipline / guardrails (a '## Discipline' section)", () => {
        expect(text).toMatch(/##\s*discipline/i);
      });

      it("bounds its output with a word budget", () => {
        // e.g. "Cap your reply at ~400 words" — an unbounded agent floods the parent context.
        expect(text).toMatch(/cap[\s\S]{0,40}?\d{2,4}\s*words/i);
      });
    });
  }
});

// Golden contract for one agent: lock the named output sections the persona-auditor promises, so a
// well-meaning edit can't quietly drop a section the chat layer depends on. This is the pattern to
// copy per agent once you decide which parts of each contract are load-bearing.
describe("golden contract — athena-persona-auditor", () => {
  it("keeps its four required output sections", () => {
    const text = readFileSync(join(AGENTS_DIR, "athena-persona-auditor.md"), "utf8");
    for (const section of ["Health snapshot", "Failure patterns", "Drift notes", "Open questions"]) {
      expect(text, `persona-auditor must keep the "${section}" section`).toContain(section);
    }
  });
});
