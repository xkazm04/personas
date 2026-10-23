#!/usr/bin/env node
/**
 * gen-decision-index.mjs — one searchable index over every decision store.
 *
 * Decisions in this repo are recorded in four places, each with its own shape:
 *   .ai/memory/NNNN-*.md                      one fact per file, YAML frontmatter
 *   .ai/directions/ledger.jsonl               one operator verdict per line
 *   .claude/ship-loop/decisions.md            ship-loop checkpoint bullets
 *   .claude/ship-loop/archive-ai-bookkeeper/decisions.md   the archived loop's bullets
 * An agent asked "why is it this way" had no single place to grep. This writes
 * docs/decisions.md: every entry from every store, in source order, each linking
 * back to its line. The stores stay authoritative; the index is a projection.
 *
 * Usage:
 *   node scripts/docs/gen-decision-index.mjs           # write docs/decisions.md
 *   node scripts/docs/gen-decision-index.mjs --check   # exit 1 if the committed copy is stale
 *
 * Fails loud: a store that parses to zero entries, or a memory file whose
 * frontmatter lacks id/kind/date or whose id disagrees with its filename, exits 1.
 * "Found nothing" and "looked at nothing" are not the same outcome.
 *
 * The same comparison runs inside `npm test`:
 * src/__tests__/structural/decisionIndex.test.ts.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUTPUT = 'docs/decisions.md';

const MEMORY_DIR = '.ai/memory';
const LEDGER = '.ai/directions/ledger.jsonl';
const SHIP_LOOP_LOGS = [
  { path: '.claude/ship-loop/decisions.md', label: 'Ship-loop decisions (personas)' },
  { path: '.claude/ship-loop/archive-ai-bookkeeper/decisions.md', label: 'Ship-loop decisions (archived ai-bookkeeper loop)' },
];

const DATE_RE = /\d{4}-\d{2}-\d{2}/;
const LEADING_DATE_RE = /^(\d{4}-\d{2}-\d{2})\s*(?:—|-|:)?\s*/;

const read = (root, rel) => readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

/** `.ai/memory/NNNN-*.md` → entries; malformed frontmatter is a problem, not a skip. */
function readMemory(root, problems) {
  const files = readdirSync(resolve(root, MEMORY_DIR))
    .filter((f) => /^\d{4}-.+\.md$/.test(f))
    .sort();
  const entries = [];
  for (const file of files) {
    const rel = `${MEMORY_DIR}/${file}`;
    const text = read(root, rel);
    const fm = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fm) {
      problems.push(`${rel}: no frontmatter block`);
      continue;
    }
    const field = (k) => (fm[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1]?.trim();
    const id = field('id');
    const kind = field('kind');
    const date = field('date');
    if (!id || !kind || !date) {
      problems.push(`${rel}: frontmatter needs id, kind and date`);
      continue;
    }
    if (id !== file.slice(0, 4)) problems.push(`${rel}: frontmatter id ${id} disagrees with the filename`);
    const firstParagraph = fm[2].trim().split(/\n\s*\n/)[0];
    const supersedes = field('supersedes');
    entries.push({
      date,
      tag: `${kind} · ${field('scope') || 'repo'}`,
      text: oneLine(firstParagraph) + (supersedes && supersedes !== 'null' ? ` _(supersedes ${supersedes})_` : ''),
      links: [[id, `../${rel}`]],
    });
  }
  return entries;
}

/** `.ai/directions/ledger.jsonl` → one entry per verdict line. */
function readLedger(root, problems) {
  const entries = [];
  read(root, LEDGER)
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim()) return;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        problems.push(`${LEDGER}:${i + 1}: not valid JSON`);
        return;
      }
      const subject = row.direction ? `${row.subject} → ${row.direction}` : row.subject;
      const text = [subject, row.reason, row.note].filter(Boolean).map(oneLine).join(' — ');
      const links = [[`ledger:L${i + 1}`, `../${LEDGER}#L${i + 1}`]];
      const proposal = row.proposal ? String(row.proposal).split(' ')[0] : null;
      if (proposal) links.push(['proposal', `../${proposal}`]);
      entries.push({ date: row.date || 'undated', tag: row.decision || 'decided', text, links });
    });
  return entries;
}

/** A ship-loop decisions.md → one entry per non-heading line, dated by the line or its section. */
function readShipLoop(root, rel) {
  const entries = [];
  let section = '';
  read(root, rel)
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim() || line.startsWith('# ')) return;
      if (line.startsWith('## ')) {
        section = line.slice(3).trim();
        return;
      }
      let text = line.replace(/^\s*-\s+/, '');
      let date = (section.match(DATE_RE) || [])[0] || 'undated';
      const lead = text.match(LEADING_DATE_RE);
      if (lead) {
        date = lead[1];
        text = text.slice(lead[0].length);
      }
      const name = rel.split('/').slice(-2).join('/');
      entries.push({
        date,
        tag: oneLine(section),
        text: oneLine(text),
        links: [[`${name}:L${i + 1}`, `../${rel}#L${i + 1}`]],
      });
    });
  return entries;
}

/**
 * Read every store and render the index. Pure apart from reading `root`.
 * @returns {{ markdown: string, total: number, problems: string[] }}
 */
export function buildDecisionIndex(root = repoRoot) {
  const problems = [];
  const stores = [
    {
      label: 'Durable memory',
      source: MEMORY_DIR + '/',
      href: `../${MEMORY_DIR}/README.md`,
      holds: 'one fact per file: decisions, gotchas, failed approaches (append-only; supersede, never edit)',
      entries: readMemory(root, problems),
    },
    {
      label: 'Direction verdicts',
      source: LEDGER,
      href: `../${LEDGER}`,
      holds: "the operator's verdict on each proposed direction, linked to its proposal",
      entries: readLedger(root, problems),
    },
    ...SHIP_LOOP_LOGS.filter((s) => existsSync(resolve(root, s.path))).map((s) => ({
      label: s.label,
      source: s.path,
      href: `../${s.path}`,
      holds: 'checkpoint answers and auto-decisions of a /ship-loop campaign',
      entries: readShipLoop(root, s.path),
    })),
  ];
  for (const s of stores) if (s.entries.length === 0) problems.push(`${s.source}: parsed 0 entries`);

  const total = stores.reduce((n, s) => n + s.entries.length, 0);
  let md = `<!-- GENERATED by scripts/docs/gen-decision-index.mjs — DO NOT EDIT BY HAND.
     Record a decision in its store, then run \`node scripts/docs/gen-decision-index.mjs\`.
     \`--check\` reports drift; src/__tests__/structural/decisionIndex.test.ts runs the same check in \`npm test\`. -->

# Decision index

Every recorded decision in this repository, from every store that holds one, in one file to search.
Each entry links back to its source line; **the source stays authoritative**, this file is a projection.
To record a new decision, write it in the store that fits (a durable "why" belongs in \`.ai/memory/\`,
see its README) and regenerate.

| Store | Holds | Entries |
|---|---|---|
`;
  for (const s of stores) md += `| [\`${s.source}\`](${s.href}) | ${s.holds} | ${s.entries.length} |\n`;
  md += `
Decisions argued only in a commit body are not indexed here; search history with
\`git log --grep=<topic>\`, or by session trailer with \`node scripts/git/by-session.mjs\`.
`;
  for (const s of stores) {
    md += `\n## ${s.label}\n\n`;
    for (const e of s.entries) {
      const links = e.links.map(([text, href]) => `[${text}](${href})`).join(', ');
      md += `- **${e.date}** · ${e.tag} — ${e.text} (${links})\n`;
    }
  }
  md += `\n---\n_${total} decisions across ${stores.length} stores._\n`;
  return { markdown: md, total, problems };
}

const isMain = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  const { markdown, total, problems } = buildDecisionIndex();
  const refusal = problems.length === 0 ? null : problems.map((p) => `  ${p}`).join('\n');
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  const out = resolve(repoRoot, OUTPUT);
  if (process.argv.includes('--check')) {
    const current = existsSync(out) ? readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current.trim() !== markdown.trim()) {
      console.error(`${OUTPUT} is stale — run \`node scripts/docs/gen-decision-index.mjs\` and commit the result.`);
      process.exit(1);
    }
    console.log(`decision index up to date (${total} decisions).`);
  } else {
    writeFileSync(out, markdown);
    console.log(`wrote ${OUTPUT} (${total} decisions).`);
  }
}
