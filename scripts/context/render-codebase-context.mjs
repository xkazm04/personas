#!/usr/bin/env node
// Render `.claude/codebase-context.md` as a DETERMINISTIC projection of
// `context-map.json` (+ the hand-curated overrides + a provenance footer).
//
// Why this exists: `context-map.json` (written automatically by the Rust
// exporter on every scan) and `.claude/codebase-context.md` (previously
// hand-rendered by the /refresh-context skill via `sqlite3`) were two
// generators of the same data on two triggers, and they drifted — at one point
// the JSON reported 8 groups and the markdown 9. This makes the JSON the single
// source of truth and the markdown a pure derivation of it, so they can't drift.
//
// It also removes the skill's machine-specific `sqlite3` DB path (which had
// gone stale, pointing at a different user's home dir).
//
// Usage:  node scripts/context/render-codebase-context.mjs
// Reads:  <repo>/context-map.json, <repo>/.claude/codebase-context-overrides.md
// Writes: <repo>/.claude/codebase-context.md
//
// Portable methodics note (phase 2 / Vibeman): the contract is "the human-
// readable snapshot is a function of the machine-readable map, never a parallel
// hand-maintained copy." Any scanner can honor it with a renderer like this.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const jsonPath = join(repoRoot, 'context-map.json');
const overridesPath = join(repoRoot, '.claude', 'codebase-context-overrides.md');
const outPath = join(repoRoot, '.claude', 'codebase-context.md');

if (!existsSync(jsonPath)) {
  console.error(
    `context-map.json not found at ${jsonPath}.\n` +
      `Run a context scan first (Personas → Dev Tools → Context Map → Scan/Re-scan).`,
  );
  process.exit(1);
}

const map = JSON.parse(readFileSync(jsonPath, 'utf8'));
const groups = map.groups ?? [];
const contexts = map.contexts ?? [];

// Provenance: prefer the commit stamped into the JSON by the Rust exporter; fall
// back to the live git HEAD when the JSON predates provenance stamping.
const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
};
const provCommit = map.provenance?.git_commit ?? git('rev-parse HEAD');
const provCount = map.provenance?.git_commit_count ?? (Number(git('rev-list --count HEAD')) || null);
const generatedAt = map.generated_at ?? new Date().toISOString();
const shortCommit = provCommit ? provCommit.slice(0, 9) : 'unknown';
// Best-effort commit subject, only meaningful when the stamped commit is HEAD.
const commitSubject = provCommit && provCommit === git('rev-parse HEAD') ? git('log -1 --format=%s') : null;
const projectName = map.project?.name ?? 'personas';

const arr = (v) => (Array.isArray(v) ? v : []);
const lines = [];
const p = (s = '') => lines.push(s);

// ---- Header ---------------------------------------------------------------
p(`# Codebase Context Snapshot — ${projectName}`);
p();
p(`> Generated: ${generatedAt}`);
p(`> Source: context-map.json (single source of truth; rendered by scripts/context/render-codebase-context.mjs)`);
p(`> Git HEAD at generation: ${shortCommit}${commitSubject ? ` (${commitSubject})` : ''}`);
p(`> Total groups: ${groups.length} (DB) + hand-curated overrides · Total contexts: ${contexts.length}`);
p('>');
p('> **DO NOT EDIT MANUALLY.** Re-run `node scripts/context/render-codebase-context.mjs`');
p('> (or `/refresh-context`) to regenerate from context-map.json.');
p('> Consumed by `/research` for relevance scoring.');
p();
p('---');
p();
p('## How to Use This File');
p();
p('Each section below describes a feature area of the codebase, with:');
p('- **Description** — what it does');
p('- **Files** — paths that implement it');
p('- **Entry points** — key functions/components/routes');
p('- **Keywords** — searchable terms for relevance matching');
p('- **API surface** — external endpoints/IPC commands exposed');
p('- **Tech stack** — frameworks/libs used in this area');
p();
p('When `/research` extracts an idea, it scores the idea against the keywords');
p('and descriptions here to find the most likely attachment point. If no group');
p('matches, the idea is dropped as out-of-scope.');
p();
p('---');

// ---- Groups + contexts ----------------------------------------------------
const contextsByGroup = new Map();
for (const c of contexts) {
  const key = c.group_id ?? '__ungrouped__';
  if (!contextsByGroup.has(key)) contextsByGroup.set(key, []);
  contextsByGroup.get(key).push(c);
}

const renderContext = (c) => {
  p();
  p(`### ${c.name}`);
  p();
  if (c.description) {
    p(c.description);
    p();
  }
  const files = arr(c.file_paths);
  if (files.length) {
    p('**Files:**');
    for (const f of files) p(`- \`${f}\``);
    p();
  }
  const entry = arr(c.entry_points);
  if (entry.length) {
    p(`**Entry points:** ${entry.join(', ')}`);
    p();
  }
  const kw = arr(c.keywords);
  if (kw.length) {
    p(`**Keywords:** ${kw.join(', ')}`);
    p();
  }
  if (c.api_surface) {
    p(`**API surface:** ${c.api_surface}`);
    p();
  }
  const tech = arr(c.tech_stack);
  if (tech.length) {
    p(`**Tech stack:** ${tech.join(', ')}`);
    p();
  }
  p('---');
};

for (const g of groups) {
  p();
  p(`## ${g.name}`);
  p();
  p(`> **Group type:** ${g.domain ?? '—'}`);
  p(`> **Color:** ${g.color ?? '—'}`);
  for (const c of contextsByGroup.get(g.id) ?? []) renderContext(c);
}

const ungrouped = contextsByGroup.get('__ungrouped__') ?? [];
if (ungrouped.length) {
  p();
  p('## Ungrouped Contexts');
  p();
  for (const c of ungrouped) renderContext(c);
}

// ---- Hand-curated overrides (verbatim) ------------------------------------
if (existsSync(overridesPath)) {
  const overrides = readFileSync(overridesPath, 'utf8').trimEnd();
  if (overrides) {
    p();
    p(overrides);
  }
}

// ---- Provenance footer (matches the shape /research reads) -----------------
p();
p('---');
p();
p('<!-- snapshot-meta');
p(`git_head: ${provCommit ?? 'unknown'}`);
p(`git_commit_count: ${provCount ?? 'unknown'}`);
p(`generated_at: ${generatedAt}`);
p('-->');

writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(
  `Wrote ${outPath}\n` +
    `  ${groups.length} groups, ${contexts.length} contexts` +
    `${existsSync(overridesPath) ? ' + overrides' : ''}\n` +
    `  provenance: ${shortCommit} (count ${provCount ?? 'n/a'})`,
);
