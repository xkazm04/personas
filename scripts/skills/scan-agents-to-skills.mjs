#!/usr/bin/env node
/**
 * scan-agents-to-skills — promote the Idea Scanner's scan lenses into reusable
 * GLOBAL Claude Code skills (`~/.claude/skills/scan-<key>/SKILL.md`).
 *
 * Source: src-tauri/src/commands/infrastructure/scan_agents.toml (21 agents).
 * The interactive scanner (idea_scanner.rs) emits DB-JSON for ingestion; these
 * generated skills are the *interactive* form — explore + report findings in
 * markdown. The scanner + TOML are left untouched (the alternative path).
 *
 * Idempotent: skips a skill whose SKILL.md already exists unless --force.
 * Usage:  node scripts/skills/scan-agents-to-skills.mjs [--force] [--dry-run]
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOML = join(REPO, 'src-tauri', 'src', 'commands', 'infrastructure', 'scan_agents.toml');
const SKILLS_DIR = join(homedir(), '.claude', 'skills');
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

/** Minimal parser for this flat `[[agents]]` + `key = "value"` TOML. */
function parseAgents(toml) {
  const agents = [];
  let cur = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '[[agents]]') { cur = {}; agents.push(cur); continue; }
    if (!cur) continue;
    const m = line.match(/^(\w+)\s*=\s*"(.*)"\s*$/);
    if (m) cur[m[1]] = m[2];
  }
  return agents;
}

/** Build a quality interactive SKILL.md from one scan agent. */
function skillMarkdown(a) {
  const exampleBullets = (a.examples || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join('\n');
  // Frontmatter description is double-quoted; agent text has no embedded quotes.
  const base = (a.description || '').trim();
  const sep = /[.!?]$/.test(base) ? '' : '.';
  const desc = `${base}${sep} Use for a focused ${a.label} pass over a project or a diff.`;
  return `---
name: scan-${a.key}
description: "${desc}"
---
# ${a.label} ${a.emoji || ''}

You are a **${a.label}**. Analyze the codebase through this lens and surface concrete, actionable findings — not generic advice.

## What to look for
${a.description}

Anchor examples:
${exampleBullets}

## How to work
1. Explore the codebase with the available file tools — start where this lens is most relevant and follow the evidence.
2. Prefer depth on a few real findings over a long list of nitpicks.
3. Cite evidence — reference actual files, functions, and line numbers.

## Output
Report each finding as a short section:
- **Title** — concise and actionable.
- **Finding** — what it is and why it matters, with evidence (\`file:line\`).
- **Recommendation** — the concrete change to make.
- **Scores** — effort / impact / risk, each 1–10 (1 = trivial / negligible / none … 10 = epic / transformative / critical).

End with a one-line summary (N findings, highest-impact first). Be specific; skip anything you can't ground in the code.

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs.
     The interactive Idea Scanner (DB-ingesting) remains the alternative path. -->
`;
}

const agents = parseAgents(readFileSync(TOML, 'utf8'));
let written = 0, skipped = 0;
for (const a of agents) {
  if (!a.key) continue;
  const dir = join(SKILLS_DIR, `scan-${a.key}`);
  const file = join(dir, 'SKILL.md');
  if (existsSync(file) && !force) {
    console.log(`skip   scan-${a.key} (exists)`);
    skipped++;
    continue;
  }
  if (dryRun) {
    console.log(`would write  scan-${a.key}`);
    written++;
    continue;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, skillMarkdown(a), 'utf8');
  console.log(`write  scan-${a.key}`);
  written++;
}
console.log(`\n${dryRun ? 'would write' : 'wrote'} ${written}, skipped ${skipped} → ${SKILLS_DIR}`);
