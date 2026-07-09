#!/usr/bin/env node
/**
 * Build the fan-out work list for `/i18n-translate gaps`.
 *
 * Emits one task file per (locale × section × part) under .i18n-work/gaps/, each
 * holding at most --chunk keys with their English source. A translator subagent
 * reads exactly one task file and writes the same shape (key → translation) to
 * .i18n-work/out/<lang>/<file>. merge-chunks.mjs validates and merges.
 *
 * Dead keys (find-unused-i18n-keys.mjs) are excluded — never spend a token on a
 * string no user can see.
 *
 * Usage: node scripts/i18n/plan-gaps.mjs [--chunk=90] [--lang=cs,de] [--skip-dead]
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import {
  readCatalog,
  locales,
  untranslatedKeys,
  brokenPlaceholderKeys,
  loadAllowlist,
} from './lib/untranslated.mjs';

const argv = process.argv.slice(2);
const CHUNK = Number(argv.find((a) => a.startsWith('--chunk='))?.split('=')[1] ?? 90);
const onlyLangs = argv.find((a) => a.startsWith('--lang='))?.split('=')[1]?.split(',');
const skipDead = !argv.includes('--no-skip-dead');
const WORK = '.i18n-work';

const en = readCatalog('en');
const allow = loadAllowlist();
const langs = onlyLangs ?? locales();

let dead = new Set();
if (skipDead) {
  const scan = JSON.parse(
    execSync('node scripts/i18n/find-unused-i18n-keys.mjs --json --full', {
      encoding: 'utf8',
      maxBuffer: 128e6,
    }),
  );
  dead = new Set(scan.unusedKeys);
}

fs.rmSync(`${WORK}/gaps`, { recursive: true, force: true });
fs.mkdirSync(`${WORK}/gaps`, { recursive: true });

const index = [];
let totalKeys = 0;
let deadSkipped = 0;

let repairs = 0;
for (const lang of langs) {
  const loc = readCatalog(lang);
  // Untranslated values + strings whose placeholder names were mangled. The
  // latter render literal garbage ({персонаs}) and need a real retranslation,
  // not a find-and-replace, so they ride along in the same chunk.
  const broken = brokenPlaceholderKeys(en, loc);
  repairs += broken.length;
  const gaps = [...new Set([...untranslatedKeys(en, loc, lang, allow), ...broken])];
  const live = gaps.filter((k) => !dead.has(k));
  deadSkipped += gaps.length - live.length;

  const bySection = {};
  for (const k of live) (bySection[k.split('.')[0]] ||= []).push(k);

  const dir = `${WORK}/gaps/${lang}`;
  fs.mkdirSync(dir, { recursive: true });
  const emit = (name, sections, keys) => {
    fs.writeFileSync(
      `${dir}/${name}`,
      JSON.stringify(
        { lang, sections, strings: Object.fromEntries(keys.map((k) => [k, en[k]])) },
        null,
        2,
      ) + '\n',
    );
    index.push({ lang, sections, count: keys.length, file: `${dir}/${name}` });
    totalKeys += keys.length;
  };

  // Big sections get dedicated parts; small ones are bin-packed whole (never
  // split across chunks) so a translator always sees a full sibling cluster.
  const small = [];
  for (const [section, keys] of Object.entries(bySection)) {
    if (keys.length > CHUNK) {
      for (let i = 0; i < keys.length; i += CHUNK) {
        emit(`${section}-${String(Math.floor(i / CHUNK) + 1).padStart(2, '0')}.json`, [section], keys.slice(i, i + CHUNK));
      }
    } else {
      small.push([section, keys]);
    }
  }
  small.sort((a, b) => b[1].length - a[1].length); // first-fit-decreasing
  const cap = Math.round(CHUNK * 1.2);
  const bins = [];
  for (const [section, keys] of small) {
    let bin = bins.find((b) => b.keys.length + keys.length <= cap);
    if (!bin) bins.push((bin = { sections: [], keys: [] }));
    bin.sections.push(section);
    bin.keys.push(...keys);
  }
  bins.forEach((b, i) => emit(`mixed-${String(i + 1).padStart(2, '0')}.json`, b.sections, b.keys));
}

// Biggest chunks first → better packing across the concurrency cap.
index.sort((a, b) => b.count - a.count);
fs.writeFileSync(`${WORK}/index.json`, JSON.stringify({ chunk: CHUNK, totalKeys, tasks: index }, null, 2) + '\n');

console.log(`locales      : ${langs.length}`);
console.log(`live gaps    : ${totalKeys}`);
console.log(`  of which placeholder repairs: ${repairs}`);
if (skipDead) console.log(`dead skipped : ${deadSkipped}`);
console.log(`tasks        : ${index.length}  (<=${CHUNK} keys each)`);
console.log(`\nwrote ${WORK}/index.json + ${WORK}/gaps/<lang>/<section>-NN.json`);
