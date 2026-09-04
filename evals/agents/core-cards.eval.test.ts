// core-bench scoring-card schema pin — deterministic contract test in the same
// lane as agent-specs.eval.test.ts: every living-agent archetype has a scoring
// card, and every card keeps the inverted-UAT shape the judge packets are
// built from (frontmatter, the five sections, exactly six criteria, valid dim
// tags). No LLM, no fixtures, runs in milliseconds. The harness that consumes
// these cards is scripts/bench/core-bench/ (judge-packet.mjs reads them by
// archetype id).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CARDS_DIR = join(process.cwd(), "docs", "tests", "core-bench", "cards");
const ARCHETYPES_FILE = join(process.cwd(), "scripts", "templates", "_archetypes.json");

const VALID_TAGS = [
  "character-fidelity",
  "responsibility-fit",
  "honesty-escalation",
  "grounding",
  "cost-discipline",
];

const REQUIRED_SECTIONS = [
  "## Who this Core is",
  "## Motivation",
  "## Senior-quality bar",
  "## Surface binding",
  "## Scored acceptance criteria (applied IDENTICALLY every run)",
];

// The archetype catalog is a committed JSON fixture; its shape is validated by
// src-tauri/engine/src/archetype_catalog.rs. Narrowing to the two fields this
// test reads.
const archetypes = (
  JSON.parse(readFileSync(ARCHETYPES_FILE, "utf8")) as {
    archetypes: Array<{ id: string; name: string }>;
  }
).archetypes;

const cardFiles = readdirSync(CARDS_DIR).filter(
  (f) => f.endsWith(".md") && !f.startsWith("_"),
);

describe("core-bench scoring cards", () => {
  it("every archetype has a card, and every card names a real archetype", () => {
    const cardIds = cardFiles.map((f) => f.replace(/\.md$/, "")).sort();
    const archetypeIds = archetypes.map((a) => a.id).sort();
    expect(cardIds).toEqual(archetypeIds);
  });

  for (const file of cardFiles) {
    const text = readFileSync(join(CARDS_DIR, file), "utf8");
    const frontmatter = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";

    describe(file, () => {
      it("declares name, archetype, and version in frontmatter", () => {
        expect(frontmatter, "missing frontmatter block").not.toBe("");
        expect(frontmatter).toMatch(/^name:\s*\S+/m);
        expect(frontmatter).toMatch(/^archetype:\s*\S+/m);
        expect(frontmatter).toMatch(/^version:\s*1\b/m);
      });

      it("frontmatter archetype matches the filename", () => {
        const declared = (frontmatter.match(/^archetype:\s*(\S+)/m) || [])[1];
        expect(declared).toBe(file.replace(/\.md$/, ""));
      });

      it("keeps all five required sections", () => {
        for (const section of REQUIRED_SECTIONS) {
          expect(text, `card must keep the "${section}" section`).toContain(section);
        }
      });

      it("has exactly 6 numbered scored criteria, each opening with valid dim tags", () => {
        const criteriaBlock = text.split(
          "## Scored acceptance criteria (applied IDENTICALLY every run)",
        )[1];
        expect(criteriaBlock, "criteria section is empty").toBeTruthy();
        const criteria = criteriaBlock
          .split("\n")
          .filter((line) => /^\d+\.\s/.test(line.trim()));
        expect(criteria.length, "exactly six criteria per card").toBe(6);
        criteria.forEach((line, i) => {
          expect(line, `criterion ${i + 1} numbered in order`).toMatch(
            new RegExp(`^${i + 1}\\.\\s`),
          );
          const tags = [...line.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]);
          expect(tags.length, `criterion ${i + 1} carries at least one dim tag`).toBeGreaterThan(0);
          for (const tag of tags) {
            expect(VALID_TAGS, `criterion ${i + 1} tag [${tag}] is a valid dim`).toContain(tag);
          }
          // Each criterion must open with its tag(s), the UAT-character shape:
          // "N. [dim] ..." — a tag buried mid-sentence is prose, not a rubric.
          expect(line.trim(), `criterion ${i + 1} opens with a dim tag`).toMatch(
            /^\d+\.\s*(\[[a-z-]+\]\s*)+/,
          );
        });
      });

      it("scores both levels: mentions L1 (prompt) and L2 (transcript/run)", () => {
        expect(text).toMatch(/L1/);
        expect(text).toMatch(/L2/);
      });
    });
  }
});
