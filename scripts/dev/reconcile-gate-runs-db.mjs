#!/usr/bin/env node
// One-time reconciliation for a Gate-Master persona's workspace `gate_runs.db`,
// plus the writer-side fix that stops the corruption from recurring.
//
// Background (live incident, 2026-08-25): the KP Gate Master persona records
// every gate run in its workspace SQLite (`gate_runs(run_id, timestamp,
// gate_name, status, output)`), but its prompt never pinned the `status`
// vocabulary. Sessions improvised — some wrote 'PASS', one wrote 'pass' — and
// a case-sensitive KPI query (`status = 'PASS'`) then read actually-green runs
// as failures: the pass rate collapsed from ~90% to 11.1% with every gate
// green. Two defects, two operations here:
//
//   reconcile   re-derive each row's status from the exit-code evidence the
//               row's own `output` carries ("exit 0", "Exit: 2", "EXIT:0"),
//               flip rows that contradict it, and normalise every status to
//               the canonical lowercase 'pass'/'fail'. Rows with no exit
//               evidence keep their status (case-normalised only) and are
//               listed — a guess is not a reading.
//
//   fix-writer  pin the status contract into the persona's stored
//               structured_prompt (instructions + execute_sql tool guidance):
//               exit 0 → 'pass', non-zero → 'fail', lowercase only, exit code
//               always recorded in `output`, reads compare lower(status).
//               Idempotent — a prompt already carrying the marker is skipped.
//
// Usage:
//   node scripts/dev/reconcile-gate-runs-db.mjs --db <gate_runs.db>              # dry-run
//   node scripts/dev/reconcile-gate-runs-db.mjs --db <gate_runs.db> --apply
//   node scripts/dev/reconcile-gate-runs-db.mjs --fix-writer --app-db <personas.db> --persona <id>          # dry-run
//   node scripts/dev/reconcile-gate-runs-db.mjs --fix-writer --app-db <personas.db> --persona <id> --apply
//
// Both operations are read-only without --apply.

import { existsSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// A linked git worktree can carry a partial pnpm node_modules (created by a
// hook run) that shadows the main checkout's real install and lacks the
// native binding. Fall back to resolving better-sqlite3 from the main
// checkout, located via the git common dir.
function probe(Db) {
  new Db(":memory:").close(); // the native binding only loads on construction
  return Db;
}

async function loadDatabase() {
  try {
    return probe((await import("better-sqlite3")).default);
  } catch (primary) {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const common = execFileSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8", cwd: here }
      ).trim();
      return probe(createRequire(join(dirname(common), "package.json"))("better-sqlite3"));
    } catch {
      throw primary;
    }
  }
}
const Database = await loadDatabase();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

const CANONICAL = { pass: "pass", fail: "fail" };

/** Exit-code evidence inside a recorded output line, e.g. "exit 0",
 *  "Exit: 2", "EXIT:0", "exit code 1". Returns the code or null. */
function exitCodeIn(output) {
  if (!output) return null;
  const m = /\bexit(?:\s*code)?\s*[:=]?\s*(\d+)\b/i.exec(output);
  return m ? Number(m[1]) : null;
}

function reconcile(dbPath) {
  if (!existsSync(dbPath)) {
    console.error(`gate_runs db not found: ${dbPath}`);
    process.exit(1);
  }
  if (APPLY) {
    const backup = `${dbPath}.pre-reconcile.bak`;
    copyFileSync(dbPath, backup);
    console.log(`backup: ${backup}`);
  }
  const db = new Database(dbPath, { readonly: !APPLY });
  db.pragma("busy_timeout = 5000");

  const rows = db.prepare("SELECT rowid, run_id, gate_name, status, output FROM gate_runs").all();
  const flips = [];      // status contradicted its own exit-code evidence
  const recased = [];    // right verdict, wrong spelling/casing
  const noEvidence = []; // nothing in output to re-derive from

  for (const r of rows) {
    const code = exitCodeIn(r.output);
    const current = String(r.status ?? "").trim();
    const currentVerdict =
      /^pass(ed)?$/i.test(current) ? "pass" : /^fail(ed)?$/i.test(current) ? "fail" : null;
    let target;
    if (code !== null) {
      target = code === 0 ? CANONICAL.pass : CANONICAL.fail;
    } else if (currentVerdict) {
      target = CANONICAL[currentVerdict];
      noEvidence.push(r);
    } else {
      // Unrecognisable status AND no evidence: leave it alone, loudly.
      console.warn(
        `  ?? rowid ${r.rowid} (${r.run_id} ${r.gate_name}): status '${current}' is not ` +
          `pass/fail-shaped and output has no exit code — left untouched`
      );
      continue;
    }
    if (current === target) continue;
    const entry = { rowid: r.rowid, run_id: r.run_id, gate: r.gate_name, from: current, to: target };
    // A differing verdict can only come from exit-code evidence (without it,
    // target IS the current verdict) — so verdict==target is a spelling fix,
    // anything else is an evidence-driven flip.
    if (currentVerdict === target) recased.push(entry);
    else flips.push(entry);
  }

  const changes = [...flips, ...recased];
  for (const c of flips) {
    console.log(`  FLIP   ${c.run_id} ${c.gate}: '${c.from}' -> '${c.to}' (exit-code evidence)`);
  }
  for (const c of recased) {
    console.log(`  RECASE ${c.run_id} ${c.gate}: '${c.from}' -> '${c.to}'`);
  }

  if (APPLY && changes.length) {
    const upd = db.prepare("UPDATE gate_runs SET status = ? WHERE rowid = ?");
    const tx = db.transaction((cs) => {
      for (const c of cs) upd.run(c.to, c.rowid);
    });
    tx(changes);
  }

  // The number the KPI is computed from: runs where ALL gates passed.
  const rate = () => {
    const runs = db
      .prepare(
        `SELECT run_id, COUNT(*) AS n, SUM(lower(status) = 'pass') AS ok
         FROM gate_runs GROUP BY run_id`
      )
      .all();
    const green = runs.filter((r) => r.ok === r.n).length;
    return { runs: runs.length, green };
  };
  const { runs: totalRuns, green } = rate();

  console.log(
    `\n${rows.length} rows scanned — ${flips.length} flipped, ${recased.length} re-cased, ` +
      `${noEvidence.length} without exit evidence (kept), ${APPLY ? "written" : "DRY RUN, nothing written"}`
  );
  console.log(
    `pass rate (all-gates-green runs): ${green}/${totalRuns}` +
      (totalRuns ? ` = ${((green / totalRuns) * 100).toFixed(1)}%` : "")
  );
  db.close();
}

// The contract text pinned into the persona prompt. The marker line makes the
// patch idempotent and greppable.
const STATUS_CONTRACT =
  "STATUS VOCABULARY (contract): gate_runs.status is derived ONLY from the gate " +
  "command's exit code — exit 0 → 'pass', any non-zero exit → 'fail'. Lowercase, " +
  "exactly these two values; 'PASS'/'FAIL'/'GREEN' are display-only and are never " +
  "stored. Always include the literal exit code in output (e.g. 'exit 0'). Every " +
  "read of gate_runs.status must compare lower(status) so legacy rows cannot be " +
  "misread as failures.";
const MARKER = "STATUS VOCABULARY (contract)";

function fixWriter(appDbPath, personaId) {
  if (!existsSync(appDbPath)) {
    console.error(`app db not found: ${appDbPath}`);
    process.exit(1);
  }
  const db = new Database(appDbPath, { readonly: !APPLY });
  db.pragma("busy_timeout = 5000");
  const row = db
    .prepare("SELECT name, structured_prompt FROM personas WHERE id = ?")
    .get(personaId);
  if (!row) {
    console.error(`persona not found: ${personaId}`);
    process.exit(1);
  }
  let prompt;
  try {
    prompt = JSON.parse(row.structured_prompt);
  } catch (e) {
    console.error(`persona ${personaId} structured_prompt is not JSON: ${e.message}`);
    process.exit(1);
  }
  if ((prompt.instructions ?? "").includes(MARKER)) {
    console.log(`writer already fixed: '${row.name}' (${personaId}) carries the status contract`);
    db.close();
    return;
  }

  // Anchor after the DB schema declaration when present, else append.
  const dbLine = /(\nDB: gate_runs\([^\n]*\n)/;
  prompt.instructions = dbLine.test(prompt.instructions ?? "")
    ? prompt.instructions.replace(dbLine, `$1\n${STATUS_CONTRACT}\n`)
    : `${prompt.instructions ?? ""}\n\n${STATUS_CONTRACT}`;

  if (typeof prompt.toolGuidance === "string") {
    prompt.toolGuidance = prompt.toolGuidance.replace(
      /(execute_sql:[^\n]*)/,
      `$1 gate_runs.status: 'pass' iff exit code 0, else 'fail' (lowercase only); record 'exit <code>' in output; compare lower(status) in reads.`
    );
  }

  console.log(`writer fix for '${row.name}' (${personaId}):`);
  console.log(`  instructions += status contract (anchored at the DB schema line)`);
  console.log(`  toolGuidance.execute_sql += exit-code mapping`);
  if (APPLY) {
    db.prepare("UPDATE personas SET structured_prompt = ? WHERE id = ?").run(
      JSON.stringify(prompt),
      personaId
    );
    console.log("  written");
  } else {
    console.log("  DRY RUN, nothing written");
  }
  db.close();
}

if (args.includes("--fix-writer")) {
  const appDb = flag("--app-db");
  const persona = flag("--persona");
  if (!appDb || !persona) {
    console.error("usage: --fix-writer --app-db <personas.db> --persona <persona-id> [--apply]");
    process.exit(1);
  }
  fixWriter(appDb, persona);
} else {
  const dbPath = flag("--db");
  if (!dbPath) {
    console.error("usage: --db <gate_runs.db> [--apply]   |   --fix-writer --app-db <personas.db> --persona <id> [--apply]");
    process.exit(1);
  }
  reconcile(dbPath);
}
