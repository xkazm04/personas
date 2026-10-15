#!/usr/bin/env node
// Run every gate of an `&&`-chained npm script, keep going past failures, and
// report each gate's verdict.
//
// WHY THIS EXISTS. `npm run check` is an `&&` chain of eighteen gates, so the
// first red one stops it and every gate behind it reports nothing. Measured on
// CI run 38709479522 (2026-10-15): the step died in 4 s at `check:contracts`,
// which meant tsc, eslint and the census - the gates most likely to catch a
// real defect - had not run in CI at all, and a second red gate further down
// the chain could not be seen until the first one was fixed.
//
// The chain in package.json stays the single source of truth: this script
// PARSES it rather than listing the gates, so a gate added there is run here
// with no second edit. `npm run check` keeps its fail-fast behaviour locally.
//
// Usage: node scripts/ci/run-check-chain.mjs [script-name]   (default: check)
// Exit 0 = every gate passed, 1 = at least one failed (or the chain looked
// wrong - see the floor below).

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptName = process.argv[2] || "check";
const chain = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts?.[scriptName];
if (!chain) {
  console.error(`run-check-chain: package.json has no script '${scriptName}'.`);
  process.exit(1);
}

const gates = chain.split("&&").map((s) => s.trim()).filter(Boolean);
// Fail-loud: `check` holds eighteen gates. A chain that parses to a handful
// means the separator changed (`;`, a wrapper script), not that the gates went.
if (scriptName === "check" && gates.length < 10) {
  console.error(`run-check-chain: '${scriptName}' parsed into only ${gates.length} gate(s) - refusing to report on a chain it cannot read.`);
  process.exit(1);
}

const onCI = Boolean(process.env.GITHUB_ACTIONS);
// A bare `eslint ...` segment needs node_modules/.bin on PATH, which `npm run`
// provides and a plain `node` invocation does not.
const env = { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` };

const results = [];
for (const gate of gates) {
  const label = gate.replace(/^npm run /, "");
  if (onCI) console.log(`::group::${label}`);
  else console.log(`\n> ${label}`);
  const started = Date.now();
  const r = spawnSync(gate, { cwd: root, env, shell: true, stdio: "inherit" });
  const seconds = (Date.now() - started) / 1000;
  const ok = r.status === 0;
  if (onCI) console.log("::endgroup::");
  if (!ok) console.log(onCI ? `::error title=${label}::exit ${r.status ?? r.signal} after ${seconds.toFixed(1)} s` : `  FAILED (exit ${r.status ?? r.signal})`);
  results.push({ label, ok, seconds });
}

const failed = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => r.label.length));
console.log(`\n${scriptName}: ${results.length - failed.length}/${results.length} gates passed`);
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label.padEnd(width)}  ${r.seconds.toFixed(1)} s`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((r) => `| ${r.ok ? "pass" : "**FAIL**"} | \`${r.label}\` | ${r.seconds.toFixed(1)} s |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### \`npm run ${scriptName}\`, every gate (${results.length - failed.length}/${results.length} passed)`,
    "",
    "| verdict | gate | time |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n"));
}

process.exit(failed.length > 0 ? 1 : 0);
