// Phase C — pairing ledger. Reads all findings-*.json, aggregates by problem_shape.
import fs from 'node:fs';
const dir = process.argv[2] || '.';
const files = fs.readdirSync(dir).filter(f => /^findings-.*\.json$/.test(f));

let cells = 0, holds = 0, partial = 0, violates = 0, naConf = 0;
const shapes = {};       // problem_shape -> {sites:[], fix:0, defer:0, repos:Set, subjects:Set}
const enrich = {};       // bucket -> count
const enrichItems = [];
let fileCount = 0, findingCount = 0;

for (const f of files) {
  let j; try { j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); } catch (e) { console.error(`SKIP ${f}: ${e.message}`); continue; }
  fileCount++;
  for (const c of (j.contexts_covered || [])) {
    const v = c.verdicts || {};
    holds += v.holds || 0; partial += v.partial || 0; violates += v.violates || 0;
    cells += (c.scored || 0); naConf += (c.na_confirmed || 0);
  }
  for (const fd of (j.findings || [])) {
    findingCount++;
    const key = fd.problem_shape || 'unlabeled';
    const s = (shapes[key] ??= { sites: [], fix: 0, defer: 0, repos: new Set(), subjects: new Set() });
    s.sites.push({ repo: fd.repo || j.repo, context: fd.context, subject: fd.subject, file: fd.file, tag: fd.tag });
    if ((fd.tag || '').toUpperCase() === 'FIX') s.fix++; else s.defer++;
    s.repos.add(fd.repo || j.repo); if (fd.subject) s.subjects.add(fd.subject);
  }
  for (const e of (j.enrichment || [])) { enrich[e.bucket] = (enrich[e.bucket] || 0) + 1; enrichItems.push({ ...e, repo: j.repo }); }
}

console.log(`\n=== PHASE C — PAIRING LEDGER (${fileCount} shards) ===`);
console.log(`Cells scored: ${cells} · holds ${holds} · partial ${partial} · violates ${violates} · n/a-confirmed ${naConf}`);
console.log(`Findings: ${findingCount} raw → ${Object.keys(shapes).length} distinct problem_shapes`);
const pairRatio = (findingCount / Math.max(1, Object.keys(shapes).length)).toFixed(2);
console.log(`Pairing ratio: ${pairRatio} sites/problem\n`);

const rows = Object.entries(shapes).map(([k, s]) => ({
  shape: k, sites: s.sites.length, fix: s.fix, defer: s.defer,
  repos: [...s.repos].sort().join('+'), nrepos: s.repos.size,
  subjects: [...s.subjects].join(','), detail: s.sites,
})).sort((a, b) => b.sites - a.sites || b.nrepos - a.nrepos);

console.log('=== PROBLEM CLASSES (by site count) ===');
for (const r of rows) {
  console.log(`\n[${r.sites} sites · ${r.fix}FIX/${r.defer}DEFER · ${r.nrepos} repo(s): ${r.repos}] ${r.shape}  (${r.subjects})`);
  for (const st of r.detail) console.log(`    ${(st.tag||'').padEnd(5)} ${st.repo}/${st.context}  ${st.file || ''}`);
}

const totFix = rows.reduce((n, r) => n + r.fix, 0), totDefer = rows.reduce((n, r) => n + r.defer, 0);
console.log(`\n=== TOTALS ===  FIX ${totFix} · DEFER ${totDefer}`);
console.log(`Cross-repo problem classes (≥2 repos): ${rows.filter(r => r.nrepos >= 2).length}`);
console.log(`\n=== ENRICHMENT (flow-back) by bucket ===`);
for (const [b, n] of Object.entries(enrich).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(3)}  ${b}`);
console.log(`  total enrichment candidates: ${enrichItems.length}`);
