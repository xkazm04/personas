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

/** Per-lens brief bundle for the sweep skill's references/lenses.md. */
function lensesMarkdown(agents) {
  const sections = agents.map((a) => {
    const examples = (a.examples || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `- ${s}`)
      .join('\n');
    return `## ${a.key} — ${a.label} ${a.emoji || ''}

Group: ${a.category_group}
Match: \`/${a.match}/i\` (against the context's name, description, keywords, tech stack, API surface, and file paths)

${a.description}

Anchor examples:
${examples}`;
  }).join('\n\n');
  return `# Scan lenses — reference for /scan-sweep

One section per lens. \`Match\` is the same keyword rule the Personas app uses
to bundle lenses for a context — apply it to the context's attributes when no
explicit \`--lenses\` list was passed.

${sections}

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs. -->
`;
}

/** The consolidated context-sweep skill: read the code once, judge through
 *  every matched lens. The findings contract matches the Personas memory
 *  outbox ingest (finding / escalation / node line types). */
function sweepMarkdown() {
  return `---
name: scan-sweep
description: "Context sweep: reads one feature-area's code once and evaluates it through every scan lens matched to it (of the 22 in references/lenses.md), reporting only grounded findings. The efficient default over running single-lens scan-* skills one by one. Emits structured findings to the Personas memory outbox for backlog ingestion, plus an escalation signal when a lens deserves a focused deep pass."
argument-hint: "[--lenses key1,key2] [context]"
category: Development
contexts: tracked
memory: project
---
# Context Sweep 🧭

You are running a **multi-lens sweep** over ONE context (feature area). The
expensive part of any scan is reading the code; do it once, then judge what you
read through each relevant lens. Depth beats breadth: a lens with nothing real
to say returns nothing.

## 1. Resolve scope

- The **final argument** is the context name. Read \`context-map.json\` at the
  project root, find the context, and stay inside its \`filePaths\`.
- **No context argument → pick an unswept context yourself.** Read
  \`context-map.json\` and \`.claude/scan-history/scan-sweep.jsonl\` (if present)
  and choose the first context, in map order, that has NO prior sweep snapshot
  (\`scope\` field). If every context has been swept, take the one whose latest
  snapshot is OLDEST. State the chosen context and why in the report header
  ("never swept" or "oldest sweep: <date>") so coverage rotation is auditable.

## 2. Load shared awareness (do this BEFORE reading code)

- \`.personas/backlog-digest.json\` (if present) — the project's live backlog
  memory: pending / accepted / rejected idea titles. **Never re-propose
  anything on those lists, including rephrasings of rejected titles.** A
  rejected title is a durable human "no".
- \`.claude/conventions.json\` (if present) — the repo's hard gates. A finding
  that violates a declared gate is a defect you are about to introduce, not a
  finding.
- \`.claude/scan-history/scan-sweep.jsonl\` (if present) — prior sweep
  snapshots for the trend line.

## 3. Pick the lens bundle

- If \`--lenses key1,key2,...\` was passed, use exactly those keys.
- Otherwise match lenses yourself: apply each lens's \`Match\` regex from
  \`references/lenses.md\` to the context's name, description, keywords, tech
  stack, API surface, and file paths. Fewer than 2 matches → fall back to
  \`architecture-analyst\` + \`code-optimizer\`.
- List the chosen lens keys in the report header.

## 4. Survey, then judge

1. Read the context's files and collect evidence FIRST — form no verdicts while
   still reading.
2. Run any cheap deterministic check that applies (type-checker, linter,
   existing script) and reconcile; deterministic findings belong to those tools,
   not to this sweep — do not restate them as findings.
3. Then walk the lens bundle **sequentially**. Per lens: at most **3** findings,
   each grounded in \`file:line\` evidence. Zero findings is a valid and common
   result — say "nothing real" and move on. Prefer one deep finding over three
   shallow ones.

## 5. Report

Header first:

- \`Method: full (context: <name>, lenses: <keys>)\` — or
  \`⚠️ DEGRADED: <what was skipped and why>\` if you sampled, skipped a lens, or
  hit a limit. A degraded sweep reported as complete is worse than no sweep.

Then per lens with findings, a short section per finding:
- **Title** — concise and actionable.
- **Finding** — what and why it matters, with \`file:line\` evidence.
- **Recommendation** — the concrete change.
- **Scores** — effort / impact / risk, each 1–10.

End with a one-line summary (N findings across M lenses, highest impact first).

## 6. Emit structured findings (memory outbox)

Append to \`.personas/memory-outbox.jsonl\` (create \`.personas/\` if needed),
ONE JSON object per line, nothing else on the line:

Each reported finding:

\`\`\`json
{"type":"finding","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","title":"<finding title>","body":"<what + why + recommendation, condensed>","evidence":"<file:line — one-line proof>","effort":3,"impact":7,"risk":2}
\`\`\`

Escalation — emit at most one per lens, ONLY when that lens produced a
critical finding (impact ≥ 8) or 3 real findings in this context:

\`\`\`json
{"type":"escalation","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","reason":"<≤120 chars: what the deep pass should chase>"}
\`\`\`

Coverage — one node line per lens you actually evaluated (found something or
not), plus one for the sweep itself:

\`\`\`json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context name>","title":"Sweep pass: <lens-key> over <context>","body":"<n> findings; <one-line gist or 'clean'>"}
{"type":"node","kind":"progress","skill":"scan-sweep","context":"<context name>","title":"Sweep of <context>","body":"<lenses evaluated>; <total> findings, <e> escalations"}
\`\`\`

Keep the outbox lean — the ingest caps at 200 lines / 512 KB; a sweep should
emit well under 40 lines. The Personas app ingests and DELETES this file when a
Fleet session exits or the Skills Manager opens; findings land in the project
backlog deduped against everything already known.

## 7. Persist a snapshot

Append one line to \`.claude/scan-history/scan-sweep.jsonl\` (create the
directory if needed):

\`\`\`json
{"at":"<ISO-8601>","scope":"<context>","lenses":<n>,"findings":<n>,"escalations":<n>,"degraded":<true|false>,"note":"<≤80 chars>"}
\`\`\`

If prior lines exist for the SAME scope, add a trend line to the report
("Trend for <context>: 12 → 7 → 9 findings"); otherwise say "first sweep of
this context, no trend yet".

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs.
     Single-lens scan-* skills remain the focused deep-dive form. -->
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
// The consolidated sweep skill — one dir with SKILL.md + references/lenses.md.
// lenses.md regenerates whenever the sweep is (re)written so lens briefs track
// the TOML; same skip-unless-forced contract as the per-lens skills.
{
  const dir = join(SKILLS_DIR, 'scan-sweep');
  const file = join(dir, 'SKILL.md');
  if (existsSync(file) && !force) {
    console.log('skip   scan-sweep (exists)');
    skipped++;
  } else if (dryRun) {
    console.log('would write  scan-sweep (+ references/lenses.md)');
    written++;
  } else {
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(file, sweepMarkdown(), 'utf8');
    writeFileSync(join(dir, 'references', 'lenses.md'), lensesMarkdown(agents.filter((a) => a.key)), 'utf8');
    console.log('write  scan-sweep (+ references/lenses.md)');
    written++;
  }
}

console.log(`\n${dryRun ? 'would write' : 'wrote'} ${written}, skipped ${skipped} → ${SKILLS_DIR}`);
