#!/usr/bin/env node
// report.mjs - prints the dry-run tables in migration-map.md from
// dryrun.generated.json (the Chromium probe) so the numbers can be re-derived:
//   node docs/design/style-mastery/specimen/measure.mjs
//   node docs/design/style-mastery/specimen/shoot.mjs --probe     (needs Vite on :1431)
//   node docs/design/style-mastery/specimen/report.mjs [--top 30]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(join(HERE, 'dryrun.generated.json'), 'utf8'));
// Site lists live in pairs.generated.json (measure.mjs), the codemod's worklist.
const sitesOf = new Map(JSON.parse(readFileSync(join(HERE, 'pairs.generated.json'), 'utf8')).map((p) => [`${p.token}|${p.utility}`, p.sites]));
for (const p of d.pairs) p.siteList = sitesOf.get(`${p.token}|${p.utility}`) ?? [];
const top = Number(process.argv[process.argv.indexOf('--top') + 1]) || 30;

// A numeric utility whose features the token already sets changes nothing
// visible when it comes alive (tabular-nums beside typo-data).
const visible = (p) => p.orderSensitive && !(p.family === 'numeric' && p.tokenAlone.includes(p.utilityAlone));

const fams = {};
for (const p of d.pairs) {
  const f = (fams[p.family] ??= { pairs: 0, sites: 0, deadPairs: 0, deadSites: 0, orderSites: 0, liveDespiteToken: 0, tokenSilent: 0 });
  f.pairs++; f.sites += p.sites;
  if (p.deadNow) { f.deadPairs++; f.deadSites += p.sites; }
  if (visible(p)) f.orderSites += p.sites;
  if (p.tokenSetsIt && !p.deadNow) f.liveDespiteToken += p.sites;
  if (!p.tokenSetsIt) f.tokenSilent += p.sites;
}
console.log(`Reference context: ${JSON.stringify(d.context)}\n`);
console.log('| family | pairs | sites | dead today (codemod deletes) | order-sensitive (visible if layered first) | live although the token sets it | token does not set it (live, kept) |');
console.log('|---|---|---|---|---|---|---|');
const tot = { sites: 0, dead: 0, order: 0, live: 0, silent: 0 };
for (const [k, f] of Object.entries(fams)) {
  console.log(`| ${k} | ${f.pairs} | ${f.sites} | ${f.deadSites} | ${f.orderSites} | ${f.liveDespiteToken} | ${f.tokenSilent} |`);
  tot.sites += f.sites; tot.dead += f.deadSites; tot.order += f.orderSites; tot.live += f.liveDespiteToken; tot.silent += f.tokenSilent;
}
console.log(`| **total** | ${d.pairs.length} | ${tot.sites} | ${tot.dead} | ${tot.order} | ${tot.live} | ${tot.silent} |`);

const os = d.pairs.filter(visible).sort((a, b) => b.effect - a.effect || b.sites - a.sites);
const rows = [];
for (const p of os) for (const site of p.siteList) { if (rows.length < top) rows.push({ p, site }); }
console.log(`\nTop ${top} order-sensitive SITES by effect (all ${os.reduce((s, p) => s + p.sites, 0)} are listed per pair in pairs.generated.json):\n`);
console.log('| # | site | written | renders today | after a layer move without the delete | effect |');
console.log('|---|---|---|---|---|---|');
rows.forEach(({ p, site }, i) => {
  const short = (v) => (v.startsWith('color(') || v.startsWith('oklch') || v.startsWith('oklab') || v.startsWith('rgb') ? 'colour' : v);
  console.log(`| ${i + 1} | \`${site}\` | \`${p.token} ${p.utility}\` | ${p.family} ${short(p.tokenAlone)} | ${short(p.utilityAlone)} | ${p.effect} |`);
});
