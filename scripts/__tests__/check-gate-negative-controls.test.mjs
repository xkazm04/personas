#!/usr/bin/env node
/**
 * Self-test for scripts/check-gate-negative-controls.mjs.
 *
 * The gate this covers exists to make an unvalidated gate impossible to add
 * quietly. A gate with that job that cannot itself fail would be the joke it
 * is named after, so the negative control here is the point of the file, not
 * ceremony around it.
 *
 * Both arms run the real script against a synthetic package.json in a temp
 * directory, so the assertions do not move when the repo's own gate count
 * changes.
 *
 * Run:  node scripts/__tests__/check-gate-negative-controls.test.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = resolve(HERE, "../check-gate-negative-controls.mjs");

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name} — got ${actual}, expected ${expected}`);
};

/**
 * Materialize a fake project: a package.json with `gates` check:* scripts, a
 * self-test for `validated` of them, and the gate script itself rewritten to
 * root at that directory with the given baseline.
 */
function scenario({ gates, validated, baseline }) {
  const dir = mkdtempSync(join(tmpdir(), "gate-nc-"));
  mkdirSync(join(dir, "scripts", "__tests__"), { recursive: true });

  const scripts = {};
  for (let i = 0; i < gates; i++) {
    scripts[`check:g${i}`] = `node scripts/check-g${i}.mjs`;
    writeFileSync(join(dir, "scripts", `check-g${i}.mjs`), "// gate\n");
    if (i < validated) {
      writeFileSync(join(dir, "scripts", "__tests__", `check-g${i}.test.mjs`), "// self-test\n");
    }
  }
  // Noise the registry must ignore: a non-check script naming a gate file.
  scripts.build = "node scripts/check-g0.mjs --not-a-gate-entrypoint";
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts }, null, 2));

  const src = readFileSync(REAL, "utf8")
    .replace('resolve(dirname(fileURLToPath(import.meta.url)), "..")', JSON.stringify(dir))
    .replace(/BASELINE_UNVALIDATED = \d+/, `BASELINE_UNVALIDATED = ${baseline}`);
  const runner = join(dir, "run.mjs");
  writeFileSync(runner, src);

  let code = 0;
  let out = "";
  try {
    out = execFileSync(process.execPath, [runner, "--json"], { encoding: "utf8" });
  } catch (e) {
    code = e.status ?? 1;
    out = e.stdout ?? "";
  }
  return { dir, code, json: out.trim() ? JSON.parse(out) : null };
}

console.log("check-gate-negative-controls self-test\n");

// Arm A — a gate was added without a negative control: the count exceeds the
// baseline and the ratchet must fire. This is the assertion the whole script
// exists for; if it ever goes quiet, the gate is decorative.
const a = scenario({ gates: 5, validated: 1, baseline: 3 });
check("A: ratchet fires when unvalidated (4) > baseline (3)", a.code, 1);
check("A: counts the registry, not the directory", a.json?.total, 5);
check("A: unvalidated counted correctly", a.json?.unvalidated, 4);

// Arm B — same tree, baseline at the true count: no growth, so it must pass.
// Paired with A on identical inputs; only the baseline differs.
const b = scenario({ gates: 5, validated: 1, baseline: 4 });
check("B: quiet when unvalidated (4) == baseline (4)", b.code, 0);

// Arm C — an empty registry must FAIL rather than report a clean pass. A
// parser that silently matches nothing is the failure mode most likely to
// make this script green forever.
const c = scenario({ gates: 0, validated: 0, baseline: 0 });
check("C: empty registry is a failure, not a pass", c.code, 1);

for (const s of [a, b, c]) rmSync(s.dir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} assertion(s)`}`);
process.exit(failures === 0 ? 0 : 1);
