// Negative claims are pinned, not coupled.
//
// A promise about what this app does NOT do - "your data never leaves your
// machine", "no telemetry dashboards" - has as its truth-maker the fact that no
// code exists. There is no module to map a document onto, so feature-doc-map.json
// cannot hold an entry for it, check-doc-map-paths.mjs cannot validate one, and
// the doc-sync Stop hook cannot nag when it changes. Those gates are not weak
// here; they are structurally blind, permanently, by construction.
//
// Such a claim rots two ways and neither produces a diff a doc gate routes:
//   1. Somebody builds the thing. No map entry pointed at the capability,
//      because the capability did not exist when the map was written.
//   2. Somebody deletes the sentence. A negative claim reads as boilerplate to
//      every editor who did not pay for it - it describes no feature, and
//      cutting it makes the page shorter.
//
// So this gate asserts WORDING: the exact substring, in the named documents,
// plus a forbidden sweep for phrasings the promise rules out.
//
// What this gate does NOT do: verify the promise is true. It proves the promise
// is still STATED. A pinned false promise is worse than an unpinned one, so
// every pin carries `reviewed` - the date a human established its truth - and
// this checker REFUSES a pin without one rather than laundering an unreviewed
// sentence into a green check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Derived from this file's location, per the note in check-doc-map-paths.mjs -
// a hardcoded root aborted `npm run check` on every machine but one.
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PINS = path.join(ROOT, 'scripts/docs/promise-pins.json');

// Assert the instrument before the result: a missing or empty pin file must
// fail loudly, never pass as "nothing to check".
if (!fs.existsSync(PINS)) {
  console.error(`FATAL: ${PINS} missing - cannot check. Failing loudly.`);
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(PINS, 'utf8'));
const pins = spec.pins || [];
if (pins.length === 0) {
  console.error('FATAL: promise-pins.json declares no pins. An empty pin set is not a pass.');
  process.exit(2);
}

const read = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
};

const problems = [];
let checkedClaims = 0;
let skippedDocs = 0;

for (const pin of pins) {
  if (!pin.reviewed || !/^\d{4}-\d{2}-\d{2}$/.test(pin.reviewed)) {
    problems.push(`pin "${pin.id}": no dated \`reviewed\` field. A pin preserves wording a human approved; without the date it is an unreviewed sentence with a green check beside it.`);
    continue;
  }
  for (const doc of pin.documents) {
    const text = read(doc);
    if (text === null) {
      problems.push(`pin "${pin.id}": document ${doc} does not exist - the pin cannot fire and fails open.`);
      skippedDocs += 1;
      continue;
    }
    for (const claim of pin.required) {
      checkedClaims += 1;
      if (!text.includes(claim)) {
        problems.push(`pin "${pin.id}": ${doc} no longer contains the pinned claim:\n      "${claim}"`);
      }
    }
  }
}

const forbidden = spec.forbidden || {};
let checkedForbidden = 0;
for (const doc of forbidden.documents || []) {
  const text = read(doc);
  if (text === null) continue; // an optional document; the pins above own existence
  const lowered = text.toLowerCase();
  for (const phrase of forbidden.phrases || []) {
    checkedForbidden += 1;
    if (lowered.includes(phrase.toLowerCase())) {
      problems.push(`forbidden phrasing in ${doc}: "${phrase}" - it contradicts a pinned promise.`);
    }
  }
}

// The headline carries what it could not check, so a run that skipped a
// document is not green in the same way as a run that checked everything.
const headline = `promise pins: ${checkedClaims} claim assertion(s), ${checkedForbidden} forbidden sweep(s), ${skippedDocs} document(s) skipped`;

if (problems.length > 0) {
  console.error(`${headline}\n\npromise pins FAILED - ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nIf a promise stopped being true, do not delete the pin: change the system, or');
  console.error('change the promise and re-date `reviewed` in scripts/docs/promise-pins.json.');
  process.exit(1);
}

console.log(`${headline} - OK`);
