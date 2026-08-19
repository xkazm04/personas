#!/usr/bin/env node
// build-paths-index.mjs — the v3 recall index over the SUBJECT HIERARCHY.
//
// Reads docs/concepts/paths/ FRONTMATTER ONLY (no prose parsing — that is the
// whole point of the redesign; the flat build-golden-path-index.mjs regex-hunts
// `## Principle` heads and special-cases wave-1 docs, and the hierarchy retires
// all of it). Emits three artifacts under scripts/census/:
//
//   subject-index.json  subject -> { category, techniques:[{slug, laws[]}],
//                                    evidence[], counter_evidence[], deviations[],
//                                    applications:[{stack, technique}] }
//   law-index.json      law-anchor -> { statement?, techniques:[subject/technique],
//                                       evidence[] }   (the compact physics core)
//   router.json         evidence-glob -> [{subject, technique?, laws[]}]  (the
//                                    "what governs this file" lookup — same object
//                                    the operator asked for to validate NEW code)
//
// READ-ONLY over docs/concepts/paths/ (the parallel session's territory). Writes
// only to scripts/census/. Never mutates paths/.
//
// Design: docs — inversion-system-v3 (fork scratch). Owner: inversion-system-v3.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
// Corpus source and output dir are parameterized so the index can be built from
// EITHER personas `docs/concepts/paths/` (today's authority) OR a registry clone
// (`ai-registry/knowledge/software-engineering/`) — same subject/technique/
// application layout, `_laws.md`, `categories.json`. This survives the planned
// paths/->registry move and lets coverage run against any corpus location.
//   --corpus <dir>  or  CORPUS_DIR=<dir>   (default: personas paths/)
//   --out <dir>     or  INDEX_OUT_DIR=<dir> (default: scripts/census)
function argOf(flag) { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; }
const PATHS = path.resolve(argOf('--corpus') || process.env.CORPUS_DIR || path.join(ROOT, 'docs/concepts/paths'));
const OUT = path.resolve(argOf('--out') || process.env.INDEX_OUT_DIR || path.join(ROOT, 'scripts/census'));
if (!fs.existsSync(path.join(PATHS, '_laws.md'))) {
  console.error(`FATAL: no _laws.md under corpus ${PATHS} — not a golden-path corpus root.`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

// --- minimal frontmatter parser: scalars + `- ` lists, `[]` empty inline list.
// The hierarchy's frontmatter is deliberately simple; this handles exactly it.
function frontmatter(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  let key = null;
  for (const raw of m[1].split('\n')) {
    if (!raw.trim()) continue;
    const li = raw.match(/^\s*-\s+(.*)$/);
    if (li && key) {
      // strip inline `# comment` after a list value (evidence lines carry them)
      out[key].push(li[1].replace(/\s+#.*$/, '').trim());
      continue;
    }
    const kv = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      if (v === '' ) { out[key] = []; }          // list follows on next lines
      else if (v === '[]') { out[key] = []; key = null; }
      else if (v.startsWith('[') && v.endsWith(']')) {   // inline list: [a, b, c]
        out[key] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
        key = null;
      }
      else { out[key] = v.replace(/\s+#.*$/, '').trim(); key = null; }
    }
  }
  return out;
}

const categories = JSON.parse(fs.readFileSync(path.join(PATHS, 'categories.json'), 'utf8'));
const catOf = categories.subjects || {};

// --- law statements from _laws.md (anchor id -> first paragraph)
const lawsTxt = fs.readFileSync(path.join(PATHS, '_laws.md'), 'utf8');
const lawStmt = {};
for (const m of lawsTxt.matchAll(/<a id="([^"]+)"><\/a>\s*([^\n]*)\n+([^\n]+(?:\n[^\n#][^\n]*)*)/g)) {
  lawStmt[m[1]] = m[3].replace(/\s+/g, ' ').trim();
}

const subjectIndex = {};
const lawIndex = {};
const router = [];

const subjectDirs = fs.readdirSync(PATHS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const slug of subjectDirs) {
  const dir = path.join(PATHS, slug);
  const gpFile = path.join(dir, `${slug}.md`);
  if (!fs.existsSync(gpFile)) continue;           // not a subject folder
  const gp = frontmatter(gpFile);
  const techDir = path.join(dir, 'techniques');
  const appDir = path.join(dir, 'applications');

  const techniques = [];
  if (fs.existsSync(techDir)) {
    for (const tf of fs.readdirSync(techDir).filter((f) => f.endsWith('.md')).sort()) {
      const t = frontmatter(path.join(techDir, tf));
      const tslug = t.technique || tf.replace(/\.md$/, '');
      const laws = Array.isArray(t.laws) ? t.laws : (t.laws ? [t.laws] : []);
      techniques.push({ slug: tslug, laws, shared_with: t.shared_with || [] });
      for (const law of laws) {
        (lawIndex[law] ||= { statement: lawStmt[law] || null, techniques: [], evidence: [] })
          .techniques.push(`${slug}/${tslug}`);
      }
    }
  }

  const applications = [];
  if (fs.existsSync(appDir)) {
    for (const af of fs.readdirSync(appDir).filter((f) => f.endsWith('.md')).sort()) {
      const a = frontmatter(path.join(appDir, af));
      applications.push({ stack: a.stack || af.split('--')[0], technique: a.technique || '', file: `docs/concepts/paths/${slug}/applications/${af}` });
    }
  }

  const evidence = Array.isArray(gp.evidence) ? gp.evidence : [];
  subjectIndex[slug] = {
    category: catOf[slug] || 'uncategorized',
    status: gp.status || 'unknown',
    techniques,
    evidence,
    counter_evidence: Array.isArray(gp.counter_evidence) ? gp.counter_evidence : [],
    deviations: Array.isArray(gp.deviations) ? gp.deviations : [],
    applications,
  };

  // router: each evidence glob -> the subject + its techniques' laws
  const allLaws = [...new Set(techniques.flatMap((t) => t.laws))];
  for (const ev of evidence) {
    router.push({ glob: ev, subject: slug, laws: allLaws });
  }
  // attach evidence to the laws it witnesses
  for (const law of allLaws) if (lawIndex[law]) lawIndex[law].evidence.push(...evidence);
}

// de-dup law evidence
for (const l of Object.values(lawIndex)) l.evidence = [...new Set(l.evidence)];

const meta = {
  generated_by: 'scripts/census/build-paths-index.mjs',
  source: 'docs/concepts/paths/ (frontmatter only)',
  subjects: Object.keys(subjectIndex).length,
  techniques: Object.values(subjectIndex).reduce((n, s) => n + s.techniques.length, 0),
  applications: Object.values(subjectIndex).reduce((n, s) => n + s.applications.length, 0),
  laws: Object.keys(lawIndex).length,
  categories: categories.categories.map((c) => c.id),
};

fs.writeFileSync(path.join(OUT, 'subject-index.json'), JSON.stringify({ meta, subjects: subjectIndex }, null, 1));
fs.writeFileSync(path.join(OUT, 'law-index.json'), JSON.stringify({ meta: { laws: meta.laws }, laws: lawIndex }, null, 1));
fs.writeFileSync(path.join(OUT, 'router.json'), JSON.stringify({ meta: { entries: router.length }, routes: router }, null, 1));

console.log(`subject-index: ${meta.subjects} subjects · ${meta.techniques} techniques · ${meta.applications} applications`);
console.log(`law-index:     ${meta.laws} laws`);
console.log(`router:        ${router.length} evidence-glob routes`);
const missingLaws = Object.entries(lawIndex).filter(([, v]) => !v.statement).map(([k]) => k);
if (missingLaws.length) console.log(`WARN: ${missingLaws.length} cited laws have no statement in _laws.md: ${missingLaws.join(', ')}`);
