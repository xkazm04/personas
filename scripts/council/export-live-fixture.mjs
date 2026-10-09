#!/usr/bin/env node
// Freeze the local app database's councils into a fixture the Council shot
// harness can load with `?live=1`, so prototype screenshots show real rounds
// rather than the reference artifact's invented ones.
//
//   node scripts/council/export-live-fixture.mjs [--db <personas.db>]
//
// READ-ONLY: the database is opened with `readOnly: true` and nothing is
// written to it. The output lands under `.claude/council-reference/data/live/`,
// which `.gitignore` already excludes (`.claude/*`), because it carries other
// repositories' code references and must not be committed.
//
// The shapes are the ts-rs bindings `CouncilSubjectState` and
// `CouncilRunDetail`. `state` is derived the way `derive_council_state`
// (src-tauri/db/src/repos/dev/council.rs) does it for a subject with no
// decision on its latest run - the live DB holds zero decisions - and
// `registrySubjects` carries only the subjects the members NAMED (the Rust
// reader's keyword fallback needs the repo's context map and is skipped).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argDb = process.argv.indexOf('--db');
// An unset and an empty APPDATA are the same thing: no default location.
const appData = process.env.APPDATA;
const DB = argDb > 0 ? process.argv[argDb + 1] : appData ? join(appData, 'com.personas.desktop', 'personas.db') : null;
if (!DB) {
  console.error('export-live-fixture: APPDATA is not set; pass --db <personas.db>');
  process.exit(1);
}
const OUT = join(ROOT, '.claude', 'council-reference', 'data', 'live', 'council-live.json');

const db = new DatabaseSync(DB, { readOnly: true });
const all = (sql, ...p) => db.prepare(sql).all(...p);

const subjects = all(`
  SELECT s.id, s.project_id, s.kind, s.use_case_id, s.slug, s.title, s.drift, s.drift_checked_at,
         s.created_at, s.updated_at, p.name AS project_name, u.tier, u.description
  FROM dev_council_subjects s
  JOIN dev_projects p ON p.id = s.project_id
  LEFT JOIN dev_use_cases u ON u.id = s.use_case_id`);

const runCols = `id, subject_id, round_no, supersedes_run_id, rubric_version, trust_state, outcome, overall,
  coverage, head_sha, span_digest, spanned_paths_json, hard_failures_json, must_address_json, summary,
  run_dir, started_at, finished_at, ingested_at, mode`;

const toRun = (r, description) => ({
  id: r.id,
  subjectId: r.subject_id,
  mode: r.mode,
  roundNo: Number(r.round_no),
  supersedesRunId: r.supersedes_run_id,
  rubricVersion: r.rubric_version,
  trustState: r.trust_state,
  outcome: r.outcome,
  overall: r.overall,
  coverage: r.coverage,
  headSha: r.head_sha,
  spanDigest: r.span_digest,
  spannedPathsJson: r.spanned_paths_json,
  hardFailuresJson: r.hard_failures_json,
  mustAddressJson: r.must_address_json,
  summary: r.summary,
  summaryIsSubjectFallback: Boolean(description && r.summary.trim() === description.trim()),
  // The DB stores some dirs with the Win32 long-path prefix; the app opens
  // them as they are, the browser link does not need it either way.
  runDir: r.run_dir.replace(/^\\\\\?\\/, ''),
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  ingestedAt: r.ingested_at,
});

const toVerdict = (v) => ({
  id: v.id,
  runId: v.run_id,
  dimension: v.dimension,
  kind: v.kind,
  state: v.state,
  score: v.score,
  confidence: v.confidence,
  floor: v.floor,
  floorHit: Boolean(v.floor_hit),
  advisory: Boolean(v.advisory),
  payloadJson: v.payload_json,
});

function namedSubjects(verdicts) {
  const out = new Set();
  for (const v of verdicts) {
    try {
      for (const t of JSON.parse(v.payloadJson).techniques ?? []) {
        if (typeof t?.subject === 'string' && t.subject.trim()) out.add(t.subject);
      }
    } catch {
      // A payload that does not parse names nothing; the table draws it as such.
    }
  }
  return [...out].sort();
}

const outSubjects = [];
const runs = {};
for (const s of subjects) {
  const rows = all(`SELECT ${runCols} FROM dev_council_runs WHERE subject_id = ? ORDER BY round_no`, s.id);
  const subjectRow = {
    id: s.id,
    projectId: s.project_id,
    kind: s.kind,
    useCaseId: s.use_case_id,
    slug: s.slug,
    title: s.title,
    drift: s.drift,
    driftCheckedAt: s.drift_checked_at,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
  // Newest FULL run, else newest lite: a lite run never supersedes a full one.
  const full = rows.filter((r) => r.mode === 'full');
  const lite = rows.filter((r) => r.mode === 'lite');
  const latest = (full.length ? full : lite).at(-1) ?? null;
  for (const r of rows) {
    const verdicts = all(
      `SELECT id, run_id, dimension, kind, state, score, confidence, floor, floor_hit, advisory, payload_json
       FROM dev_council_verdicts WHERE run_id = ?`,
      r.id,
    ).map(toVerdict);
    const sameMode = rows.filter((x) => x.mode === r.mode);
    runs[r.id] = {
      run: toRun(r, s.description),
      subject: subjectRow,
      verdicts,
      sawDigest: `live-fixture:${r.id}`,
      isLatest: sameMode.at(-1)?.id === r.id && r.id === latest?.id,
      decision: null,
    };
  }
  const latestDetail = latest ? runs[latest.id] : null;
  const tier = s.kind === 'use_case' ? (s.tier ?? null) : null;
  const outcome = latest?.outcome ?? null;
  const state = !outcome ? 'none' : outcome === 'ready' && tier === 'standard' ? 'machine_pass' : outcome;
  let hardFailures = 0;
  try {
    hardFailures = latest ? JSON.parse(latest.hard_failures_json).length : 0;
  } catch {
    hardFailures = 0;
  }
  outSubjects.push({
    id: s.id,
    projectId: s.project_id,
    kind: s.kind,
    useCaseId: s.use_case_id,
    slug: s.slug,
    title: s.title,
    state,
    tier,
    mode: latest?.mode ?? null,
    roundNo: latest ? Number(latest.round_no) : null,
    latestRunId: latest?.id ?? null,
    outcome,
    overall: latest?.overall ?? null,
    coverage: latest?.coverage ?? null,
    trustState: latest?.trust_state ?? null,
    floorHits: latestDetail ? latestDetail.verdicts.filter((v) => v.floorHit).length : 0,
    hardFailures,
    drift: s.drift,
    projectName: s.project_name,
    registrySubjects: latestDetail ? namedSubjects(latestDetail.verdicts) : [],
    runDir: latestDetail?.run.runDir ?? null,
    finishedAt: latest?.finished_at ?? null,
    decidedAt: null,
    rejectionReason: null,
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ exportedAt: new Date().toISOString(), subjects: outSubjects, runs }, null, 1));
console.log(`council live fixture: ${outSubjects.length} subjects, ${Object.keys(runs).length} runs -> ${OUT}`);
