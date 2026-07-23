// KPI simulation — the dispatch prompt (docs/plans/kpi-simulation-skill.md).
//
// THE PROMPT IS THE ENGINE. Most managed repos have never seen the /uat or
// /kpi-sim skills, so the dispatched session must carry the full doctrine
// itself (the "run from Personas into managed repos" distribution decision).
// It is skill-AWARE, not skill-dependent: when the target repo does have a
// `.claude/skills/kpi-sim` skill or a `uat/` overlay (Characters, journeys),
// the session uses them; otherwise the embedded procedure applies.
//
// Same doctrine family as passport/improve/deployActions.ts + rowDirections.ts:
// read-the-repo-first, non-destructive, every number needs evidence, all KPI
// mutations proposal-gated. The three epistemic classes and the result.json
// contract here MUST stay in sync with `kpi_sim.rs::dev_tools_kpi_sim_ingest`.
import type { DevProject } from '@/lib/bindings/DevProject';

export type KpiSimMode = 'l1' | 'l1l2';

export function kpiSimDispatchKey(projectId: string): string {
  return `kpi-sim:${projectId}`;
}

export function kpiSimTaskTitle(project: DevProject): string {
  return `KPI simulation — ${project.name}`;
}

export function buildKpiSimPrompt(project: DevProject, mode: KpiSimMode): string {
  const l2Block = mode === 'l1l2'
    ? [
        'L2 (LIVE simulation) IS ENABLED for this run. After L1, if the app can actually be exercised:',
        '- Probe for a driving mechanism, in order: a documented test/automation harness (grep README/docs for a local HTTP test server or driver lib); Playwright/Puppeteer already in devDependencies (author a MINIMAL driver script per journey — start the dev server, drive, capture, tear down); a plain HTTP API you can curl.',
        '- Drive each KPI-bound journey live with the pattern: act → wait for the result to settle → capture the REAL output. Judge the captured output, not your expectation of it.',
        '- If no mechanism exists or the app cannot start, record ONE finding ("no live-simulation path") and fall back to L1 for those KPIs — never fake an L2 result.',
        '- L2 measurements carry env "test"; note "cert":"L2" inside their evidence.',
      ].join('\n')
    : [
        'L2 (live) is DISABLED for this run — theoretical (L1) simulation only. L1 measurements carry env "test" with "cert":"L1" inside their evidence.',
      ].join('\n');

  return [
    `You are orchestrating a KPI SIMULATION for the project "${project.name}" (this repo). You are the ORCHESTRATOR — plan, dispatch research subagents, execute measurements, and synthesize a machine-readable result. Use the Task/Agent tool for fan-out research; when the harness lets you pick a subagent model, use a faster sonnet-class model for research subagents and keep synthesis/judgement in this session.`,
    '',
    'GROUND TRUTH: read `kpi-sim/snapshot.json` at the repo root first. It holds the project identity and every managed KPI (id, name, category, measure_kind, measure_config, unit, direction, baseline/target/current, cadence, tier, status). KPI ids in your output MUST come from this file verbatim. KPIs with status "proposed" are PENDING HUMAN REVIEW from an earlier run/scan — never re-propose them (by id or by name) and do not measure them; they are context only.',
    '',
    'SKILL AWARENESS: check `.claude/skills/` for a kpi-sim or uat skill, and the repo root for a `uat/` overlay (characters/, journeys/) or a `kpi-sim/bindings/` directory. If present, follow/reuse them (Characters especially — do not invent a second cast). If absent, use the embedded procedure below — do NOT install anything.',
    '',
    '== THE THREE EPISTEMIC CLASSES (never blend them) ==',
    'Classify every KPI from the snapshot into exactly one:',
    '- CLASS 1 — MEASURABLE LOCALLY: technical/quality KPIs a repo command can measure (coverage, test pass rate, lint count, bundle size, local bench). If its measure_config already works, just note that. If the KPI is parked manual/unmeasured but COULD be measured, author the procedure: find the real command, RUN it, parse the number. Output a proposal kind:"adopt_measure_config" with payload {"cmd": "...", "parse": "..."} plus the verified value + output tail as evidence. The app applies it only after human accept.',
    '- CLASS 2 — SIMULATED USER BEHAVIOR: user-facing outcome KPIs (onboarding completion, time-to-value, task success). Simulate 3-5 representative user Characters (role, goal, patience, quality bar — reuse uat/characters if present) walking the KPI-relevant journeys OVER THE CODE (L1): read the actual routes/components/handlers, walk the journey step by step against what the code really affords, record completion/failure/time estimates per Character. Aggregate into a measurement (e.g. completion rate 0.6) with evidence {"characters": N, "completed": M, "journals": [...]} and a confidence 0-1.',
    '- CLASS 3 — REAL-WORLD TRAFFIC/VALUE: users, visitors, revenue, retention. These CANNOT be simulated — never emit a measurement for them. Instead: web-research 2-4 comparable products/benchmarks (WebSearch/WebFetch if available; else clearly-marked training-data estimates), then emit proposal kind:"adjust_target" (or "new_kpi"/"retire") with rationale + citations. A forecast is a proposal about what to aim for, never a data point.',
    '- Honestly unsimulatable → one finding explaining why; skip it. Never force a number.',
    '',
    l2Block,
    '',
    '== HARD RULES ==',
    '- NEVER invent a number. Every measurement carries evidence tracing it to a command output, a per-Character walk journal, or (proposals) citations. The ingester REFUSES evidence-free measurements.',
    '- Simulated measurements use env "local" (repo commands) or "test" (journey walks / live driving) ONLY. Production is reserved for real telemetry and the ingester rejects it.',
    '- Do not modify the application code, its config, or its KPIs. Your ONLY writes: `kpi-sim/runs/<run-id>/` artifacts, and appending `kpi-sim/` to .gitignore if it is not ignored yet (operational data stays out of version control).',
    '- At most 8 new-KPI proposals; prefer adjusting/adopting over inventing.',
    '- Run repo commands with sensible timeouts; a command that fails is evidence of a class-1 gap (finding), not a reason to fabricate.',
    '',
    '== OUTPUT (the contract — the app ingests this file) ==',
    'Create `kpi-sim/runs/<YYYY-MM-DD-HHmm>/` containing:',
    '1. `result.json` — EXACTLY this shape (unknown fields are ignored; bad rows are skipped and reported):',
    '{',
    '  "sim_run_id": "<run dir name>",',
    '  "measurements": [ { "kpi_id": "<from snapshot>", "value": <number>, "env": "local"|"test", "confidence": <0-1>, "evidence": { ...cmd/output_tail OR characters/completed/journals..., "cert": "L1"|"L2" }, "note": "<one line>" } ],',
    '  "proposals": [ { "kind": "adopt_measure_config"|"adjust_target"|"retire", "kpi_id": "<from snapshot>", "payload": { ... }, "rationale": "<why>", "citations": ["<url or source>"] },',
    '                 { "kind": "new_kpi", "payload": { "name", "description", "category": "technical"|"quality"|"traffic"|"value", "measure_kind": "codebase"|"manual"|"derived"|"connector", "measure_config": {...}, "unit", "direction": "up"|"down", "baseline_value", "target_value", "cadence": "manual"|"daily"|"weekly" }, "rationale", "citations": [] } ],',
    '  "findings": [ { "title": "<sharp one-liner>", "description": "<detail>", "kpi_id": "<optional>", "evidence": { ... } } ]',
    '}',
    '2. `report.md` — the human story: per-KPI class + what you did + the value with its provenance + what you propose. Findings-first, honest about what you could NOT simulate.',
    '',
    'Before finishing: adversarially re-check your own result.json — delete any value you cannot trace to evidence, then validate it is parseable JSON. Print a final summary line: measurements / proposals / findings counts.',
  ].join('\n');
}