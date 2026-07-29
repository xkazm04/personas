#!/usr/bin/env node
/**
 * scan-agents-to-skills — promote the Idea Scanner's scan lenses into PRESET
 * system skills, git-tracked at `.claude/skills/scan-<key>/SKILL.md` and
 * bundled into the installer via sync-system-skills.mjs → resources/skills.
 *
 * Source: src-tauri/src/commands/infrastructure/scan_agents.toml (22 agents).
 * The interactive scanner (idea_scanner.rs) emits DB-JSON for ingestion; these
 * generated skills are the *interactive* form — explore + report findings in
 * markdown. They are context-tracked so Fleet runs populate the Memory
 * Ledger's per-context coverage. The scanner backend lane is left untouched.
 *
 * Idempotent: skips a skill whose SKILL.md already exists unless --force.
 * Usage:  node scripts/skills/scan-agents-to-skills.mjs [--force] [--dry-run]
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOML = join(REPO, 'src-tauri', 'src', 'commands', 'infrastructure', 'scan_agents.toml');
const SKILLS_DIR = join(REPO, '.claude', 'skills');
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

/** Skills-manager category per agent — finer than the 4 category groups. */
const CATEGORY_OVERRIDES = {
  'test-strategist': 'Testing',
  'dependency-auditor': 'Maintenance',
  'tech-debt-tracker': 'Maintenance',
  'analytics-planner': 'Data',
};
function skillCategory(a) {
  if (CATEGORY_OVERRIDES[a.key]) return CATEGORY_OVERRIDES[a.key];
  return a.category_group === 'technical' ? 'Development' : 'Other';
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
argument-hint: "[context]"
category: ${skillCategory(a)}
contexts: tracked
memory: project
---
# ${a.label} ${a.emoji || ''}

If a context (feature-area) name is passed as the final argument, scope the
pass to that context's files — read \`context-map.json\` at the project root to
resolve the context's \`filePaths\` and stay inside them.

You are a **${a.label}**. Analyze the codebase through this lens and surface concrete, actionable findings — not generic advice.

## What to look for
${a.description}

Anchor examples:
${exampleBullets}

## Repo conventions — read before proposing any change

If \`.claude/conventions.json\` exists at the project root, read it first. It is
the machine-readable statement of this repo's hard gates (what blocks a commit,
what codegen must run after which edit, which rules are enforced). A finding
that violates a declared gate is not a finding, it is a defect you are about to
introduce — check the manifest before recommending, not after.

## How to work

1. **Survey before you judge.** Explore the codebase with the file tools and
   collect evidence *first* — where this lens is most relevant, what the code
   actually does. Do not form the verdict while you are still reading.
2. **Then run any deterministic check available** (a linter, a type-checker, an
   existing script) and reconcile it against what you found. Order matters: a
   tool's output anchors judgment, so a finding you formed only after seeing it
   is a finding the tool gave you, not one you found.
3. Prefer depth on a few real findings over a long list of nitpicks.
4. Cite evidence — reference actual files, functions, and line numbers.
5. Note explicitly where the deterministic check and your own reading disagree:
   a clean tool run over code you judged weak is a **finding about the tool's
   coverage**, and worth reporting as such.

## Report the honest shape of the run

Begin the report with one line declaring how it ran, so a weakened pass is never
silent:

- Full pass: \`Method: full (scope: <what you actually covered>)\`
- Anything less: \`⚠️ DEGRADED: <what was skipped and why>\`

Degrade openly whenever you sampled instead of covering, could not run a check
you meant to run, or hit a limit. A degraded scan reported as complete is worse
than no scan — the gap silently becomes "we looked at that."

## Output

Report each finding as a short section:
- **Title** — concise and actionable.
- **Finding** — what it is and why it matters, with evidence (\`file:line\`).
- **Recommendation** — the concrete change to make.
- **Scores** — effort / impact / risk, each 1–10 (1 = trivial / negligible / none … 10 = epic / transformative / critical).

End with a one-line summary (N findings, highest-impact first). Be specific; skip anything you can't ground in the code.

## Persist a snapshot

After reporting, append one line to \`.claude/scan-history/scan-${a.key}.jsonl\`
(create the directory if needed) so later runs can see movement instead of
starting blind:

\`\`\`json
{"at":"<ISO-8601>","scope":"<context or 'repo'>","findings":<n>,"p1":<n>,"degraded":<true|false>,"note":"<≤80 chars>"}
\`\`\`

Then read the previous lines and, if any exist, add a trend line to your report:

> **Trend for scan-${a.key}: 12 → 7 → 9 findings** (last 3 runs)

Compare like with like — a run scoped to one context is not comparable to a
whole-repo run, so say so rather than printing a misleading arrow. If this is
the first run, say "first run, no trend yet".

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
