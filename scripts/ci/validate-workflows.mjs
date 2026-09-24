#!/usr/bin/env node
// Static validation of .github/workflows/*.yml — the structural mistakes that
// GitHub reports only at run time, or never.
//
// WHY THIS EXISTS. Since 2026-09-18 ci.yml skips jobs by path (`changes`) and
// restates the outcome in one always-running job (`ci-verdict`). That design has
// a quiet failure mode per moving part, and none of them make a workflow red:
//   - a job added to ci.yml but not to ci-verdict's `needs:` is simply not
//     part of the verdict;
//   - an `if:` reading `needs.changes.outputs.rust` in a job that does not
//     `need` changes evaluates to '' — the job is skipped forever, tidily;
//   - a renamed job id silently detaches any branch-protection rule naming it;
//   - `RUSTC_WRAPPER: sccache` in a job-level env: is the configuration that
//     took the whole Rust gate offline on 2026-07-27 (see ci.yml, rust-tests).
// Workflows cannot be executed locally, so this is the only check they get
// before a push.
//
// Usage: node scripts/ci/validate-workflows.mjs
// Exit 0 = clean, 1 = findings (or nothing to look at — see the floor below).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// An explicit directory argument exists so the checks can be driven against a
// mutated COPY — the only way to show that each of them can fail.
const workflowsDir = process.argv[2]
  || join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");

// Job ids that documentation, branch protection and other workflows refer to
// by name. Removing or renaming one must be a deliberate edit of THIS list in
// the same diff, where a reviewer sees it. Adding a job needs no entry here.
const FROZEN_JOB_IDS = {
  "ci.yml": [
    "changes", "commit-lint", "frontend-checks", "rust-fmt", "rust-tests", "rust-deny",
    "rust-features", "rust-no-features", "command-name-drift", "binding-drift",
    "evidence-check", "ci-verdict",
  ],
  "release.yml": ["ci-gate", "version", "frontend", "build", "updater-manifest"],
  "installer-test.yml": ["test-release", "test-build", "test-build-macos", "test-build-linux", "test-tag"],
  "e2e-smoke.yml": ["smoke"],
};

// workflow file -> id of the job that must `need` every other job in it.
const AGGREGATORS = { "ci.yml": "ci-verdict" };

const findings = [];
const fail = (file, msg) => findings.push(`${file}: ${msg}`);
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const files = readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f)).sort();
// Fail-loud: "found nothing wrong" and "looked at nothing" are different
// outcomes. The directory holds 7 workflows today; 4 of them carry frozen ids.
if (files.length < 4) {
  console.error(`validate-workflows: only ${files.length} workflow file(s) under ${workflowsDir} — refusing to report success.`);
  process.exit(1);
}

let jobsSeen = 0;
for (const file of files) {
  const text = readFileSync(join(workflowsDir, file), "utf8");
  let doc;
  try {
    doc = yaml.load(text);
  } catch (e) {
    fail(file, `does not parse as YAML: ${e.message.split("\n")[0]}`);
    continue;
  }
  const jobs = doc?.jobs;
  if (!jobs || typeof jobs !== "object" || Object.keys(jobs).length === 0) {
    fail(file, "has no jobs");
    continue;
  }
  const ids = Object.keys(jobs);
  jobsSeen += ids.length;

  for (const frozen of FROZEN_JOB_IDS[file] ?? []) {
    if (!ids.includes(frozen)) fail(file, `job '${frozen}' is gone (renamed or removed) — it is referenced by name elsewhere; update FROZEN_JOB_IDS deliberately if that is intended.`);
  }

  if (/^\s*-?\s*uses:\s*dtolnay\/rust-toolchain@stable\b/m.test(text)) {
    fail(file, "uses dtolnay/rust-toolchain@stable, which ignores rust-toolchain.toml — read the channel from the file (see THE TOOLCHAIN PIN note in ci.yml).");
  }
  if (doc.env && "RUSTC_WRAPPER" in doc.env) fail(file, "sets RUSTC_WRAPPER in workflow-level env: — it must be opted into by the sccache health-check step.");

  for (const id of ids) {
    const job = jobs[id];
    const needs = asList(job.needs);

    for (const n of needs) {
      if (!ids.includes(n)) fail(file, `job '${id}' needs '${n}', which does not exist.`);
    }
    if (job.env && "RUSTC_WRAPPER" in job.env) {
      fail(file, `job '${id}' sets RUSTC_WRAPPER in job-level env: — a cache outage then hard-fails the job. Opt in from the health-check step instead.`);
    }

    // Every `needs.<x>.` the job mentions anywhere (if:, env:, run:, with:).
    const blob = JSON.stringify(job);
    for (const m of blob.matchAll(/\bneeds\.([A-Za-z0-9_-]+)\./g)) {
      if (!needs.includes(m[1])) fail(file, `job '${id}' reads needs.${m[1]}.* but does not list '${m[1]}' in needs: — the expression evaluates to '' and the condition is silently false.`);
    }

    // Every `steps.<x>.` must name a step id in the same job.
    const stepIds = new Set(asList(job.steps).map((s) => s?.id).filter(Boolean));
    for (const m of blob.matchAll(/\bsteps\.([A-Za-z0-9_-]+)\./g)) {
      if (!stepIds.has(m[1])) fail(file, `job '${id}' reads steps.${m[1]}.* but has no step with that id.`);
    }
  }

  const aggId = AGGREGATORS[file];
  if (aggId && jobs[aggId]) {
    const agg = jobs[aggId];
    const aggNeeds = asList(agg.needs);
    for (const id of ids) {
      if (id !== aggId && !aggNeeds.includes(id)) fail(file, `aggregator '${aggId}' does not need '${id}' — that job's result is not part of the verdict.`);
    }
    if (String(agg.if ?? "").replace(/\s/g, "") !== "always()") {
      fail(file, `aggregator '${aggId}' must run under 'if: always()' (found: ${JSON.stringify(agg.if ?? null)}).`);
    }
    // The aggregator classifies each needed job in one of three shell lists.
    const script = asList(agg.steps).map((s) => s?.run ?? "").join("\n");
    const classified = new Set();
    for (const m of script.matchAll(/^\s*(?:ALWAYS|ON_RUST|ON_FRONTEND)="([^"]*)"/gm)) {
      for (const j of m[1].split(/\s+/).filter(Boolean)) classified.add(j);
    }
    if (classified.size === 0) fail(file, `aggregator '${aggId}': could not find its ALWAYS / ON_RUST / ON_FRONTEND lists.`);
    for (const n of aggNeeds) {
      if (!classified.has(n)) fail(file, `aggregator '${aggId}' needs '${n}' but classifies it in none of its lists.`);
    }
    for (const c of classified) {
      if (!aggNeeds.includes(c)) fail(file, `aggregator '${aggId}' classifies '${c}', which is not in its needs:.`);
    }
    // `changes` decides "was this class evaluated before?" from its own copy of
    // the class lists. If the copies drift, a job's old red verdict stops being
    // carried (or a job that never existed blocks every base from being found).
    const classify = asList(jobs.changes?.steps).map((s) => s?.run ?? "").join("\n");
    for (const [theirs, ours] of [["RUST_JOBS", "ON_RUST"], ["FRONTEND_JOBS", "ON_FRONTEND"]]) {
      const pick = (src, name) => (new RegExp(`^\\s*${name}="([^"]*)"`, "m").exec(src)?.[1] ?? "").split(/\s+/).filter(Boolean).sort().join(" ");
      const a = pick(classify, theirs);
      const b = pick(script, ours);
      if (!a || a !== b) fail(file, `changes.${theirs} ("${a}") and ${aggId}.${ours} ("${b}") must list the same jobs.`);
    }

    // A path-gated job must be one the aggregator is allowed to see skipped.
    for (const id of ids) {
      const cond = String(jobs[id].if ?? "");
      const gate = cond.match(/needs\.changes\.outputs\.(rust|frontend)/);
      if (!gate) continue;
      const list = gate[1] === "rust" ? "ON_RUST" : "ON_FRONTEND";
      const listed = new RegExp(`^\\s*${list}="([^"]*)"`, "m").exec(script)?.[1].split(/\s+/) ?? [];
      if (!listed.includes(id)) fail(file, `job '${id}' is gated on outputs.${gate[1]} but is not in the aggregator's ${list} list — a legitimate skip would be reported as a failure (or a wrong skip as a pass).`);
    }
  } else if (aggId) {
    fail(file, `aggregator job '${aggId}' is missing.`);
  }
}

if (findings.length > 0) {
  console.error(`validate-workflows: ${findings.length} finding(s)\n`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`validate-workflows: ${files.length} workflow files, ${jobsSeen} jobs — clean.`);
