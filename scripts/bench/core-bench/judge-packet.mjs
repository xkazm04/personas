#!/usr/bin/env node
// core-bench judge-packet builder — OFFLINE. For each cell of a run it bundles:
//   1. the archetype's scoring card (docs/tests/core-bench/cards/<archetype>.md),
//   2. the cell's artifact — the assembled prompt (L1) or the execution
//      transcript (L2),
//   3. a fill-in verdict schema.
// The actual judging runs as a later agent step over these packets; this
// script NEVER spawns `claude` or any model. Cells without an artifact are
// listed as skipped{no_artifact} in INDEX.md — unmeasured, never 0.
//
// Usage:
//   node scripts/bench/core-bench/judge-packet.mjs [--run <dir>]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./cells.mjs";
import { latestRunDir } from "./gate.mjs";

const CARDS_DIR = path.join(ROOT, "docs", "tests", "core-bench", "cards");

export const JUDGE_DIMS = [
  "character-fidelity",
  "responsibility-fit",
  "honesty-escalation",
  "grounding",
  "cost-discipline",
];

export function verdictSchema(cellId, level) {
  return {
    cellId,
    level, // "l1" scores the PROMPT; "l2" scores the TRANSCRIPT
    dims: Object.fromEntries(
      JUDGE_DIMS.map((d) => [d, { score: null, scale: "0-5", evidence: "" }]),
    ),
    criteria: Array.from({ length: 6 }, (_, i) => ({
      n: i + 1,
      verdict: null, // "pass" | "partial" | "fail" | "not-scorable{reason}"
      evidence: "",
    })),
    verdict: null, // "pass" | "conditional" | "fail" | "incomplete"
    notes: "",
  };
}

export function buildPacket({ cellId, archetypeId, level, cardText, artifactLabel, artifactText }) {
  return [
    `# Judge packet — ${cellId} (${level.toUpperCase()})`,
    "",
    level === "l1"
      ? "You are scoring the ASSEMBLED PROMPT: does it faithfully carry this Core and its charter? Judge what the prompt would make the persona DO, not its prose style."
      : "You are scoring the EXECUTION TRANSCRIPT: did the run behave in character, stay inside its mandate, escalate honestly, and spend sanely?",
    "",
    "Apply the scoring card's 6 criteria IDENTICALLY to how every other run of this card is scored. Score each criterion pass/partial/fail with one line of evidence; a criterion you cannot observe from the artifact is `not-scorable` with the reason — never a silent pass.",
    "",
    "---",
    "",
    `## Scoring card (${archetypeId})`,
    "",
    cardText.trim(),
    "",
    "---",
    "",
    `## Artifact — ${artifactLabel}`,
    "",
    "```",
    artifactText.trim(),
    "```",
    "",
    "---",
    "",
    "## Fill in this verdict (return the completed JSON)",
    "",
    "```json",
    JSON.stringify(verdictSchema(cellId, level), null, 2),
    "```",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run");
  const runDir = runIdx >= 0 ? path.resolve(args[runIdx + 1]) : latestRunDir();
  if (!runDir || !existsSync(path.join(runDir, "result.json"))) {
    console.error("judge-packet: no run with a result.json found");
    process.exit(1);
  }
  const result = JSON.parse(readFileSync(path.join(runDir, "result.json"), "utf8"));
  const level = result.mode === "l2" ? "l2" : "l1";
  const judgeDir = path.join(runDir, "judge");
  mkdirSync(judgeDir, { recursive: true });

  const index = [];
  let built = 0;
  for (const cell of result.cells ?? []) {
    const archetypeId = cell.id.split(".")[0];
    const cardFile = path.join(CARDS_DIR, `${archetypeId}.md`);
    if (!existsSync(cardFile)) {
      index.push(`- ${cell.id}: skipped{no_card:${archetypeId}}`);
      continue;
    }
    const cellDir = path.join(runDir, "cells", cell.id);
    const artifactFile =
      level === "l2" ? path.join(cellDir, "transcript.md") : path.join(cellDir, "prompt.md");
    const fallback = level === "l2" ? path.join(cellDir, "execution.json") : null;
    let artifactPath = existsSync(artifactFile) ? artifactFile : null;
    if (!artifactPath && fallback && existsSync(fallback)) artifactPath = fallback;
    if (!artifactPath) {
      index.push(`- ${cell.id}: skipped{no_artifact} (verdict was ${cell.verdict}${cell.reason ? `: ${cell.reason}` : ""})`);
      continue;
    }
    const packet = buildPacket({
      cellId: cell.id,
      archetypeId,
      level,
      cardText: readFileSync(cardFile, "utf8"),
      artifactLabel: path.basename(artifactPath),
      artifactText: readFileSync(artifactPath, "utf8"),
    });
    writeFileSync(path.join(judgeDir, `${cell.id}.packet.md`), packet);
    index.push(`- ${cell.id}: packet built`);
    built++;
  }
  writeFileSync(
    path.join(judgeDir, "INDEX.md"),
    [
      `# Judge packets — ${path.basename(runDir)} (${level.toUpperCase()})`,
      "",
      `${built} packets built, ${index.length - built} skipped (skips are unmeasured, not zeros).`,
      "",
      ...index,
      "",
    ].join("\n"),
  );
  console.log(`judge-packet: ${built} packets -> ${judgeDir} (${index.length - built} skipped)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
