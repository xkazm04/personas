#!/usr/bin/env node
// Mirror docs/concepts/paths/ into a knowledge registry bundle.
//
// ONE DIRECTION, ALWAYS. This repository is the authority for the hierarchy until the
// migration plan's P3 flip (docs/concepts/knowledge-registry-migration.md); the mirror
// reads here and writes there, and never the reverse. It does not delete anything on
// either side except files it previously generated in the target bundle.
//
// What it changes on the way across, and why:
//
//   1. `evidence`, `counter_evidence` and `deviations` are LIFTED OUT of published
//      frontmatter into `<subject>/.evidence.local.md`, which the registry gitignores.
//      Those pointers name files in this tree; to a reader without this checkout they are
//      unusable, and the operator's call (2026-08-18) is that they stay local. The
//      registry's own gate fails any published file that still declares them, so this is
//      belt and braces rather than a convention.
//   2. `type:` is added beside `layer:`, same value. `type` is the one field OKF requires;
//      `layer` is what this repo's reader already parses. Emitting both means the bundle
//      is OKF-valid immediately and nothing here has to change at the same moment.
//   3. Links into this repo's deviation register are neutralized — the register is
//      consumer-side, so a published link to it would dangle by construction.
//
// Frontmatter is edited as TEXT, line by line, not parsed and re-serialized: comments,
// key order and spacing survive, and a file that only needed a key removed differs by
// exactly those lines.
//
// Usage:
//   node scripts/registry/mirror-paths.mjs [--target <dir>] [--dry-run]
//     --target   registry checkout (default: ../ai-registry beside this repo)
//     --dry-run  report what would change, write nothing
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { splitDoc, isTopLevelKey } from './lib/frontmatter.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SOURCE = path.join(ROOT, 'docs/concepts/paths');
const DOMAIN = 'software-engineering';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const targetArg = argv.indexOf('--target');
const TARGET_REPO = targetArg !== -1 && argv[targetArg + 1]
  ? path.resolve(argv[targetArg + 1])
  : path.resolve(ROOT, '..', 'ai-registry');
const BUNDLE = path.join(TARGET_REPO, 'knowledge', DOMAIN);

// Keys that never publish. Kept in one place so the sidecar writer and the strip logic
// cannot disagree about what "evidence" means.
const LOCAL_ONLY_KEYS = ['evidence', 'counter_evidence', 'deviations'];

// Bundle-level files: what crosses, and what deliberately does not.
// `_laws.md` is markdown and carries links out of the hierarchy, so it goes through the
// link neutralizer like any body. `categories.json` is data and is copied byte for byte.
const COPY_NEUTRALIZED = ['_laws.md'];
const COPY_VERBATIM = ['categories.json'];
const NOT_MIRRORED = {
  'GRAPH.md': 'superseded registry-side by docs/rkb-profile.md, which states the same contract without this repo\'s paths',
  'corpus-map.json': 'maps THIS repo\'s legacy corpus to subjects — consumer bookkeeping, meaningless in the registry',
  'subject-inventory.md': 'planning artifact; its exemplar column is a table of internal file paths',
};

// ---------------------------------------------------------------- inputs
if (!fs.existsSync(SOURCE)) {
  console.error(`FATAL: no source hierarchy at ${SOURCE}. Nothing to mirror; refusing to report success.`);
  process.exit(2);
}
if (!fs.existsSync(TARGET_REPO)) {
  console.error(`FATAL: registry checkout not found at ${TARGET_REPO}`);
  console.error('Clone it first: git clone https://github.com/xkazm04/ai-registry.git');
  process.exit(2);
}
if (!fs.existsSync(path.join(TARGET_REPO, 'registry.yaml'))) {
  console.error(`FATAL: ${TARGET_REPO} has no registry.yaml — that is not a knowledge registry.`);
  console.error('Refusing to write a bundle into an unknown directory.');
  process.exit(2);
}

// P3 flip guard (2026-08-23). This mirror writes the FLAT layout
// (`knowledge/<domain>/<subject>/`). The registry restructured the bundle into
// nested taxonomy rings (`taxonomy.json`, layout: "nested") and became the
// authority; running the flat mirror against it would scatter duplicate
// subjects beside the nested ones and corrupt the tree that every other
// consumer reads. Whole-corpus mirroring is retired — improvements now travel
// registry-first, and anything personas needs locally is mirrored back by hand
// or by a nested-aware tool that does not exist yet.
try {
  const tax = JSON.parse(
    fs.readFileSync(path.join(TARGET_REPO, 'knowledge', DOMAIN, 'taxonomy.json'), 'utf8'),
  );
  if (tax.layout === 'nested') {
    console.error(
      `FATAL: the ${DOMAIN} bundle declares layout "nested" (taxonomy.json) — this mirror ` +
        'only writes the retired flat layout and would corrupt the bundle. The registry is ' +
        'the authority now (migration plan P3); do not mirror the corpus into it.',
    );
    process.exit(2);
  }
} catch {
  // No taxonomy.json → the pre-restructure flat bundle this mirror was built for.
}

const subjectDirs = fs.readdirSync(SOURCE, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

if (subjectDirs.length === 0) {
  console.error('FATAL: source hierarchy holds zero subjects. THE READER IS BROKEN.');
  process.exit(2);
}

let sourceCommit = 'unknown';
try {
  sourceCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch { /* provenance is best-effort; a missing SHA must not stop a mirror */ }

// ---------------------------------------------------------------- transforms

// `splitDoc` / `isTopLevelKey` live in ./lib/frontmatter.mjs — shared with
// evidence-check.mjs so the registry lane reads frontmatter one way, not two.

/**
 * Remove the local-only key blocks from a frontmatter line list, returning the surviving
 * lines and the removed blocks verbatim (for the sidecar). A key's block is its own line
 * plus every following line that is indented or blank — i.e. up to the next top-level key.
 */
const liftLocalOnly = (fmLines) => {
  const kept = [];
  const lifted = {};
  let capturing = null;
  for (const line of fmLines) {
    if (isTopLevelKey(line)) {
      const key = line.slice(0, line.indexOf(':'));
      if (LOCAL_ONLY_KEYS.includes(key)) {
        capturing = key;
        lifted[key] = [line];
        continue;
      }
      capturing = null;
      kept.push(line);
      continue;
    }
    if (capturing) { lifted[capturing].push(line); continue; }
    kept.push(line);
  }
  return { kept, lifted };
};

/** Add `type:` beside `layer:` — OKF requires `type`; this repo's reader parses `layer`. */
const addTypeField = (fmLines, rel) => {
  if (fmLines.some((l) => /^type:/.test(l))) return fmLines;
  const i = fmLines.findIndex((l) => /^layer:\s*\S/.test(l));
  if (i === -1) {
    console.warn(`  warn: ${rel} has no layer: field — cannot derive type:`);
    return fmLines;
  }
  const value = fmLines[i].slice(fmLines[i].indexOf(':') + 1).replace(/\s+#.*$/, '').trim();
  const out = fmLines.slice();
  out.splice(i + 1, 0, `type: ${value}`);
  return out;
};

/**
 * Neutralize references that cannot survive the crossing.
 *
 * Two kinds, and the distinction matters:
 *
 *   1. The consumer's deviation register. Deviations are consumer-side by definition — the
 *      registry holds the standard, not who falls short of it — so these become prose, not
 *      a path anyone could follow.
 *   2. Any other relative link that escapes the bundle: citations into this repo's source,
 *      into the legacy corpus, into planning docs. The CITATION is legitimate and stays
 *      (an application's job is to cite real code) but as inline code, because as a link
 *      it would resolve to nothing in the registry. The path is normalized to
 *      repo-relative so it still reads as an address rather than a pile of `../`.
 *
 * Links that resolve INSIDE the source hierarchy are bundle-internal and pass untouched.
 */
const neutralizeEscapingLinks = (body, srcAbs) => {
  let register = 0;
  let escaping = 0;

  // The register first: it has its own wording, and doing it here stops the generic pass
  // from turning it into a citation of a file the reader is not meant to look for.
  let out = body.replace(
    /\[([^\]]*)\]\((?:\.\.\/)*(?:docs\/concepts\/)?golden-path-deferred-fixes\.md(#[A-Za-z0-9-]+)?\)/g,
    (_m, label) => { register++; return `\`${label}\` in the consumer's deviation register`; },
  );
  out = out.replace(
    /`?(?:\.\.\/)*(?:docs\/concepts\/)?golden-path-deferred-fixes\.md`?/g,
    () => { register++; return "the consumer's deviation register"; },
  );

  const dir = path.dirname(srcAbs);
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return whole;
    const [pathPart] = target.split('#');
    if (!pathPart) return whole;
    const resolved = path.resolve(dir, pathPart);
    // Inside the hierarchy → a bundle-internal link, which stays a link.
    if (resolved === SOURCE || resolved.startsWith(SOURCE + path.sep)) return whole;
    escaping++;
    const repoRel = resolved.startsWith(ROOT + path.sep)
      ? path.relative(ROOT, resolved).replace(/\\/g, '/')
      : pathPart;
    // Drop a label that only repeats the address; keep one that says something.
    const redundant = label === repoRel || label === path.basename(repoRel) || label === pathPart;
    return redundant ? `\`${repoRel}\`` : `${label} (\`${repoRel}\`)`;
  });

  return { out, register, escaping };
};

// ---------------------------------------------------------------- walk

const written = [];      // published files
const sidecars = [];     // local-only overlays
const stats = { subjects: 0, goldenPaths: 0, techniques: 0, applications: 0, lifted: 0, refs: 0, escaping: 0 };

const write = (abs, content) => {
  written.push(path.relative(TARGET_REPO, abs).replace(/\\/g, '/'));
  if (dryRun) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

/** Transform one concept document; returns its lifted keys for the subject's sidecar. */
const mirrorDoc = (srcAbs, dstAbs, relLabel) => {
  const raw = fs.readFileSync(srcAbs, 'utf8');
  const doc = splitDoc(raw);
  if (!doc) {
    console.warn(`  warn: ${relLabel} has no frontmatter — copied verbatim`);
    write(dstAbs, raw);
    return null;
  }
  const { kept, lifted } = liftLocalOnly(doc.fmLines);
  const withType = addTypeField(kept, relLabel);
  const { out: body, register, escaping } = neutralizeEscapingLinks(doc.body, srcAbs);
  stats.refs += register;
  stats.escaping += escaping;
  if (Object.keys(lifted).length) stats.lifted += Object.keys(lifted).length;
  write(dstAbs, `---${doc.eol}${withType.join(doc.eol)}${doc.eol}---${doc.eol}${body}`);
  return Object.keys(lifted).length ? lifted : null;
};

for (const slug of subjectDirs) {
  stats.subjects++;
  const srcDir = path.join(SOURCE, slug);
  const dstDir = path.join(BUNDLE, slug);
  const overlay = {}; // relative file → lifted key blocks

  const gp = path.join(srcDir, `${slug}.md`);
  if (!fs.existsSync(gp)) {
    console.warn(`  warn: ${slug}/ has no ${slug}.md — skipped`);
    continue;
  }
  const gpLifted = mirrorDoc(gp, path.join(dstDir, `${slug}.md`), `${slug}/${slug}.md`);
  if (gpLifted) overlay[`${slug}.md`] = gpLifted;
  stats.goldenPaths++;

  for (const kind of ['techniques', 'applications']) {
    const sub = path.join(srcDir, kind);
    if (!fs.existsSync(sub)) continue;
    for (const f of fs.readdirSync(sub).filter((x) => x.endsWith('.md')).sort()) {
      const lifted = mirrorDoc(path.join(sub, f), path.join(dstDir, kind, f), `${slug}/${kind}/${f}`);
      if (lifted) overlay[`${kind}/${f}`] = lifted;
      if (kind === 'techniques') stats.techniques++; else stats.applications++;
    }
  }

  if (Object.keys(overlay).length) {
    const lines = [
      '---',
      'layer: evidence-overlay',
      `subject: ${slug}`,
      'consumer: personas',
      `source_commit: ${sourceCommit}`,
      '---',
      '',
      `# Local evidence overlay — ${slug}`,
      '',
      'GENERATED by the consumer\'s mirror, and gitignored by this registry. It carries the',
      'pointers that only mean something inside the consuming repository: which files witness',
      'each claim, which one contradicts it, and which registered gaps that consumer currently',
      'carries against this standard.',
      '',
      'Regenerate with `node scripts/registry/mirror-paths.mjs` in the consuming repo. Do not',
      'hand-edit: the authority is the frontmatter in that repo, not this copy.',
      '',
    ];
    for (const [file, keys] of Object.entries(overlay)) {
      lines.push(`## ${file}`, '', '```yaml');
      for (const block of Object.values(keys)) lines.push(...block);
      lines.push('```', '');
    }
    const abs = path.join(dstDir, '.evidence.local.md');
    sidecars.push(path.relative(TARGET_REPO, abs).replace(/\\/g, '/'));
    if (!dryRun) {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.writeFileSync(abs, lines.join('\n'));
    }
  }
}

for (const f of COPY_NEUTRALIZED) {
  const src = path.join(SOURCE, f);
  if (!fs.existsSync(src)) { console.warn(`  warn: ${f} absent at source`); continue; }
  const { out, register, escaping } = neutralizeEscapingLinks(fs.readFileSync(src, 'utf8'), src);
  stats.refs += register;
  stats.escaping += escaping;
  write(path.join(BUNDLE, f), out);
}
for (const f of COPY_VERBATIM) {
  const src = path.join(SOURCE, f);
  if (!fs.existsSync(src)) { console.warn(`  warn: ${f} absent at source`); continue; }
  write(path.join(BUNDLE, f), fs.readFileSync(src, 'utf8'));
}

// Bundle metadata. Regenerated every run so counts cannot drift from content.
write(path.join(BUNDLE, 'index.md'), `---
okf_version: "0.1"
okf_bundle_name: ${DOMAIN}
okf_bundle_title: Software engineering
profile: rkb/0.1
purity: software
---

# Software engineering

${stats.subjects} subjects, each a Golden Path with its Techniques and per-stack
Applications. Read a subject's \`<subject>.md\` first: it states what the subject is and
what a principal engineer holds true about it, then names the techniques that carry the
procedures.

The upper two layers are transplant-clean — no repo paths, no file extensions, no product
or framework names — so they are usable in any codebase, not only the one they were forged
against. Applications are the opposite by design: they cite real code and name their stack
in the filename.

Cross-cutting invariants live in [\`_laws.md\`](./_laws.md); techniques cite them by anchor.
Graph consumers group subjects with [\`categories.json\`](./categories.json).

Format: [RKB profile v0.1](../../docs/rkb-profile.md), an OKF profile.
Evidence: consumer-local by design — see the profile, §5.
`);

// ---------------------------------------------------------------- report
console.log(`${dryRun ? 'DRY RUN — ' : ''}mirrored docs/concepts/paths → ${path.relative(process.cwd(), BUNDLE) || BUNDLE}`);
console.log(`  source commit:  ${sourceCommit}`);
console.log(`  subjects:       ${stats.subjects}`);
console.log(`  golden paths:   ${stats.goldenPaths}`);
console.log(`  techniques:     ${stats.techniques}`);
console.log(`  applications:   ${stats.applications}`);
console.log(`  published files: ${written.length}`);
console.log(`  local overlays:  ${sidecars.length} (gitignored in the registry)`);
console.log(`  frontmatter key blocks lifted out: ${stats.lifted}`);
console.log(`  deviation-register references neutralized: ${stats.refs}`);
 console.log(`  escaping links turned into citations:      ${stats.escaping}`);
console.log('  not mirrored (deliberate):');
for (const [f, why] of Object.entries(NOT_MIRRORED)) console.log(`    ${f} — ${why}`);
if (dryRun) console.log('\nNothing written. Re-run without --dry-run to apply.');
else console.log('\nNext: run the registry\'s own gate — node scripts/check-bundles.mjs');
