/* One-off: redesign QA Guardian — PR-review → codebase coverage + bug-hunt with
 * Memory. Replaces its 2 recipes in _recipe_seeds.json (new ids + new
 * source_use_case_ids so the boot seeder inserts them fresh) and rewires
 * qa-guardian.json (recipe_refs, adoption_questions, persona goal/instructions,
 * connectors). Run: node scripts/templates/__redesign_qa_guardian.mjs */
import { readFileSync, writeFileSync } from 'node:fs';

const SEEDS = 'scripts/templates/_recipe_seeds.json';
const TPL = 'scripts/templates/development/qa-guardian.json';

const COV_ID = 'c0a5e100-4b1d-4c0a-9e10-71a5c0a5e100';
const BUG_ID = 'b0a5e200-4b1d-4b09-9e20-72a5b0a5e200';

// ---- New capability definitions (the recipe prompt_template = use-case JSON) ----
const coverageUC = {
  id: 'uc_coverage_scan', title: 'Codebase Coverage Scan',
  description: "Scheduled scan of the registered codebase. Reads memory for prior coverage progress, picks the next lowest-coverage / untested module, writes the missing tests, validates them with run_tests, and persists updated coverage progress to memory. Incremental — each run advances coverage on a new area until the target is met.",
  capability_summary: 'Incrementally raise test coverage: scan the codebase, write missing tests for the next uncovered module, validate, and track progress in memory.',
  category: 'development', enabled_by_default: true, execution_mode: 'e2e', model_override: null,
  suggested_trigger: { trigger_type: 'schedule', config: { cron: '0 9 * * *', cadence: 'daily' }, description: 'Runs on a schedule (default daily). Each run advances coverage incrementally; cadence is configurable at the trigger-composition step.' },
  connectors: ['codebase'],
  notification_channels: [{ type: 'messaging', description: 'Coverage progress summary channel.' }],
  review_policy: { mode: 'on_request', context: 'Newly written tests can be surfaced for human review, or accepted automatically once validated by run_tests.' },
  memory_policy: { enabled: true, context: 'REQUIRED. Persist incremental coverage progress ACROSS runs: per-module status (untested / partial / covered), last-scanned timestamp, tests written, modules still pending, and per-module test framework + fixture patterns. Each run reads memory first to pick the next uncovered area and to avoid redoing covered modules — this is what makes coverage chase forward instead of repeating.' },
  event_subscriptions: [{ event_type: 'qa.coverage.improved', direction: 'emit', description: 'Payload: { modules_covered[], tests_added[], coverage_delta, remaining_untested_count }. Emitted after a successful coverage pass.' }],
  error_handling: "Codebase not mounted / not accessible → report 'codebase not accessible' and stop (no value possible — surfaces as precondition_failed). run_tests unavailable → write tests but record them as UNVALIDATED in memory + the summary. No untested modules remain → report 'coverage target met for this cycle' WITH the current coverage state — this is value delivered (the codebase is well-covered), not a failure.",
  input_schema: [
    { name: 'target_codebase', type: 'connector_ref', ui_component: 'CodebaseSelector', connector: 'codebase', required: true, description: 'Which registered codebase to scan and raise coverage on.' },
    { name: 'max_modules_per_run', type: 'number', default: 3, min: 1, max: 20, description: 'How many uncovered modules to write tests for per scheduled run (keeps each run bounded).' },
    { name: 'coverage_target', type: 'number', default: 80, min: 1, max: 100, description: 'Target line/branch coverage % to chase incrementally.' },
  ],
  sample_input: { target_codebase: '{{param.aq_target_codebase}}', max_modules_per_run: 3, coverage_target: 80 },
  tool_hints: ['file_read', 'file_write', 'search_code', 'run_tests'], test_fixtures: [],
  use_case_flow: { nodes: [
    { id: 'c1', type: 'start', label: 'Scheduled run' },
    { id: 'c2', type: 'action', label: 'Read memory: prior coverage progress' },
    { id: 'c3', type: 'connector', label: 'Scan codebase for untested / low-coverage modules', connector: 'codebase' },
    { id: 'c4', type: 'decision', label: 'Untested modules remain?' },
    { id: 'c5', type: 'connector', label: 'Write missing tests for the next module(s)', connector: 'codebase' },
    { id: 'c6', type: 'connector', label: 'run_tests to validate', connector: 'codebase' },
    { id: 'c7', type: 'action', label: 'Persist updated coverage progress to memory' },
    { id: 'c8', type: 'event', label: 'Emit qa.coverage.improved' },
    { id: 'c9', type: 'action', label: "Report 'coverage target met this cycle' + state" },
    { id: 'c10', type: 'end', label: 'Done' },
  ], edges: [
    { source: 'c1', target: 'c2' }, { source: 'c2', target: 'c3' }, { source: 'c3', target: 'c4' },
    { source: 'c4', target: 'c5', variant: 'yes', label: 'Yes' }, { source: 'c4', target: 'c9', variant: 'no', label: 'Fully covered' },
    { source: 'c5', target: 'c6' }, { source: 'c6', target: 'c7' }, { source: 'c7', target: 'c8' }, { source: 'c8', target: 'c10' }, { source: 'c9', target: 'c10' },
  ] },
};

const bugUC = {
  id: 'uc_bug_hunt', title: 'Codebase Bug Hunt',
  description: "Scheduled scan of the registered codebase for likely defects (null/None derefs, missing error handling, unhandled edge cases, resource leaks, security gaps). Reads memory for already-reported issues to avoid duplicates, files each new finding as a human-review item for triage, and records it in memory. Incremental — each run focuses a different area.",
  capability_summary: 'Find bugs in the codebase, file new findings for human triage, and track reported issues in memory to avoid duplicates.',
  category: 'development', enabled_by_default: true, execution_mode: 'e2e', model_override: null,
  suggested_trigger: { trigger_type: 'schedule', config: { cron: '0 13 * * *', cadence: 'daily' }, description: 'Runs on a schedule (default daily, offset from the coverage scan). Cadence configurable at the trigger-composition step.' },
  connectors: ['codebase'],
  notification_channels: [{ type: 'messaging', description: 'Bug-finding summary channel.' }],
  review_policy: { mode: 'always', context: 'Each suspected bug is filed as a human-review item so a person confirms it before it becomes a backlog task — keeps false positives from flooding the backlog.' },
  memory_policy: { enabled: true, context: 'REQUIRED. Persist reported findings (file:line + a stable signature) to avoid re-reporting the same bug across runs; track per-module scan history + recurring defect patterns to focus future scans. Read memory first every run.' },
  event_subscriptions: [{ event_type: 'qa.bug.found', direction: 'emit', description: 'Payload: { file, line, severity, category, description, suggested_fix }. Dev Clone can subscribe to triage / implement fixes for confirmed findings.' }],
  error_handling: "Codebase not mounted / not accessible → report 'codebase not accessible' and stop (precondition_failed). No new bugs found → report 'no new issues this cycle' WITH the modules scanned — this is value delivered (a clean scan), not a failure.",
  input_schema: [
    { name: 'target_codebase', type: 'connector_ref', ui_component: 'CodebaseSelector', connector: 'codebase', required: true, description: 'Which registered codebase to scan for bugs.' },
    { name: 'max_findings_per_run', type: 'number', default: 5, min: 1, max: 25, description: 'Max new findings to file per scheduled run (avoids flooding the review queue).' },
    { name: 'severity_floor', type: 'enum', options: ['low', 'medium', 'high'], default: 'medium', description: 'Lowest severity worth filing. Higher floor = fewer, higher-signal findings.' },
  ],
  sample_input: { target_codebase: '{{param.aq_target_codebase}}', max_findings_per_run: 5, severity_floor: 'medium' },
  tool_hints: ['file_read', 'search_code'], test_fixtures: [],
  use_case_flow: { nodes: [
    { id: 'b1', type: 'start', label: 'Scheduled run' },
    { id: 'b2', type: 'action', label: 'Read memory: already-reported findings' },
    { id: 'b3', type: 'connector', label: 'Scan codebase for likely defects', connector: 'codebase' },
    { id: 'b4', type: 'decision', label: 'New findings above severity floor?' },
    { id: 'b5', type: 'action', label: 'File each new finding as a human-review item' },
    { id: 'b6', type: 'action', label: 'Record findings in memory (dedupe)' },
    { id: 'b7', type: 'event', label: 'Emit qa.bug.found per confirmed finding' },
    { id: 'b8', type: 'action', label: "Report 'no new issues this cycle' + scanned modules" },
    { id: 'b9', type: 'end', label: 'Done' },
  ], edges: [
    { source: 'b1', target: 'b2' }, { source: 'b2', target: 'b3' }, { source: 'b3', target: 'b4' },
    { source: 'b4', target: 'b5', variant: 'yes', label: 'Yes' }, { source: 'b4', target: 'b8', variant: 'no', label: 'Clean' },
    { source: 'b5', target: 'b6' }, { source: 'b6', target: 'b7' }, { source: 'b7', target: 'b9' }, { source: 'b8', target: 'b9' },
  ] },
};

function mkRecipe(id, ucId, uc) {
  return {
    id, source_template_id: 'qa-guardian', source_use_case_id: ucId, source_use_case_name: ucId,
    source_version: '1.0.0', name: ucId, description: uc.description, category: 'development',
    prompt_template: JSON.stringify(uc), tool_requirements: null, tags: JSON.stringify(['qa-guardian', 'derived']),
  };
}

// ---- 1. Rewrite recipe seeds ----
const seeds = JSON.parse(readFileSync(SEEDS, 'utf8'));
const before = seeds.recipes.length;
seeds.recipes = seeds.recipes.filter((r) => r.source_template_id !== 'qa-guardian');
const removed = before - seeds.recipes.length;
seeds.recipes.push(mkRecipe(COV_ID, 'uc_coverage_scan', coverageUC));
seeds.recipes.push(mkRecipe(BUG_ID, 'uc_bug_hunt', bugUC));
seeds.recipe_count = seeds.recipes.length;
writeFileSync(SEEDS, JSON.stringify(seeds, null, 2));
console.log(`recipes: removed ${removed} old QA, added 2 new; total now ${seeds.recipe_count}`);

// ---- 2. Rewire the template ----
const tpl = JSON.parse(readFileSync(TPL, 'utf8'));
const p = tpl.payload;
tpl.description = 'Autonomous QA engineer that works proactively from your codebase — not from pull requests. On a schedule it incrementally raises test coverage (scan → write missing tests → validate with run_tests) and hunts for likely defects, filing findings for human triage. Tracks coverage + reported-bug progress in memory so every run advances instead of repeating.';
tpl.service_flow = ['Codebase', 'Messages'];
p.use_cases = [
  { recipe_ref: { id: COV_ID, version: '1.0.0', bindings: {} } },
  { recipe_ref: { id: BUG_ID, version: '1.0.0', bindings: {} } },
];
// persona identity / voice / principles / guidance — drop the PR framing entirely
p.persona.identity = {
  role: 'Autonomous QA engineer that proactively raises test coverage and finds bugs by scanning the registered codebase on a schedule.',
  description: "Runs on a schedule (no PR or webhook needed). For coverage: reads memory for prior progress, scans the codebase via the codebase connector, writes the missing tests for the next uncovered modules following the project's existing test conventions, validates them with run_tests, and persists updated coverage progress to memory. For bug-hunting: scans for likely defects, files each new finding as a human-review item, and tracks reported issues in memory to avoid duplicates. Improves incrementally — each run advances a new area.",
};
p.persona.voice = {
  style: 'Precise, specific, numbered. Every finding cites a file + line, explains the risk, and proposes a concrete fix or the exact test to add. No marketing language.',
  output_format: 'Coverage run: summary of modules scanned, tests added (file + what they cover), validation result, updated coverage %, and what remains. Bug run: numbered findings (file:line, severity, category, suggested fix). Messages summary: modules touched, tests added / bugs filed, progress vs. target.',
};
p.persona.principles = [
  'Work from the codebase, not from pull requests — be proactive, not reactive.',
  'Advance incrementally — each scheduled run reads memory and picks the next uncovered / unscanned area so coverage chases forward instead of repeating.',
  'Be specific — every test names what it covers; every bug names a file, a line, and a fix.',
  'Validate what you write — run_tests must pass before a new test counts as coverage; record unvalidated tests honestly.',
  'A clean scan is value — "coverage target met" or "no new bugs" WITH the scanned state is a successful, useful result.',
];
p.persona.constraints = [
  'Never require a pull request — the codebase connector is the trigger surface.',
  'Never re-report a bug already tracked in memory — dedupe on file:line + signature.',
  'Never commit unvalidated tests as covered — if run_tests is unavailable, mark them UNVALIDATED.',
  'Never flood the review queue — respect max_findings_per_run / max_modules_per_run.',
];
p.persona.decision_principles = [
  'When memory shows a module is already covered, skip it and move to the next uncovered one.',
  "When a module's test framework is ambiguous, infer it from the nearest existing test files before writing new ones.",
  'When a suspected bug is low-confidence, file it below the severity floor rather than as a confirmed finding.',
  'When the coverage target is met for every module, report success for the cycle rather than manufacturing low-value tests.',
];
p.persona.tool_guidance = "### Codebase connector (primary, mandatory)\n- `list_files()` / `search_code(query)` — locate modules + discover test framework, fixtures, mock patterns\n- `read_file(path)` — full source + existing tests in the same module\n- `get_context_detail(module)` — architecture context to write meaningful tests\n- `run_tests()` — validate newly written tests; returns pass/fail per test + coverage where available\n- `apply_diff(file, diff)` / `file_write` — add new test files following project conventions\n### Memory (mandatory, both capabilities)\n- Read FIRST every run: coverage progress (per-module status, tests written, pending modules, frameworks) and reported-bug signatures (file:line).\n- Write AFTER every run: updated per-module coverage state; new bug findings with stable signatures.\n- This cross-run memory is what makes the work incremental instead of repetitive.\n### Coverage loop\nread memory → scan for untested/low-coverage modules → write tests for the next `max_modules_per_run` → run_tests → persist progress → emit qa.coverage.improved. When all modules meet `coverage_target`, report 'coverage target met this cycle'.\n### Bug-hunt loop\nread memory → scan for defects above `severity_floor` (null derefs, error-handling gaps, edge cases, resource leaks, security) → file each NEW finding as a human-review item → record signature in memory → emit qa.bug.found. When none found, report 'no new issues this cycle' with scanned modules.";
p.persona.error_handling = "Codebase connector offline / not mounted → report 'codebase not accessible' and stop (no value possible — precondition_failed). `run_tests` unavailable → still write tests but mark them UNVALIDATED in memory + the summary; do not count them toward coverage. No untested modules remain → 'coverage target met this cycle' WITH current state (value delivered). No new bugs found → 'no new issues this cycle' WITH scanned modules (value delivered). First run (no memory) → scan from scratch, seed coverage state. Conflicting memory → trust the most recent run's per-module state.";
p.persona.notification_channels_default = [
  { type: 'messaging', description: 'Progress summary after each run: modules scanned, tests added / bugs filed, coverage vs. target, what remains for the next cycle.' },
];
// persona goal + operating instructions
p.persona.goal = 'Keep the codebase well-tested and bug-free — on a schedule, incrementally raise test coverage and surface likely defects, tracking progress in memory across runs so each pass advances rather than repeats.';
p.persona.operating_instructions = 'Two scheduled, codebase-driven capabilities, both memory-backed:\n1. **uc_coverage_scan** (scheduled) — read memory for prior coverage progress, scan the registered codebase via the codebase connector (search_code, read_file, list_files, get_contexts), identify the next untested / low-coverage modules, write the missing tests following the module\'s existing test framework + fixture patterns, validate with run_tests, then PERSIST updated coverage progress to memory (per-module status, tests written, pending modules). Bounded by max_modules_per_run. When the coverage target is met, report it (value delivered).\n2. **uc_bug_hunt** (scheduled) — read memory for already-reported findings, scan the codebase for likely defects (null derefs, error-handling gaps, edge cases, resource leaks, security), and file each NEW finding above the severity floor as a human-review item, recording it in memory to avoid duplicates. Emit qa.bug.found so Dev Clone can pick up confirmed fixes.\nNever require a pull request — QA Guardian works proactively from the codebase, not reactively from PRs. The codebase connector is mandatory; without it, report that it is not accessible.';
// connectors: codebase primary (required), drop source_control
p.persona.connectors = (p.persona.connectors || []).filter((c) => c.name !== 'source_control');
const cb = (p.persona.connectors || []).find((c) => c.name === 'codebase');
if (cb) { cb.required = true; delete cb.fallback_note; }
// adoption questions: keep only the codebase picker, retargeted to the new use case
const codebaseQ = (p.adoption_questions || []).find((q) => /codebase/i.test(q.question || '') && (q.connector_names || []).includes('codebase'));
const newQs = [];
if (codebaseQ) {
  codebaseQ.use_case_id = 'uc_coverage_scan';
  if (codebaseQ.use_case_ids) codebaseQ.use_case_ids = ['uc_coverage_scan'];
  codebaseQ.optional = false; // codebase is now mandatory for QA Guardian
  codebaseQ.maps_to = 'use_cases[uc_coverage_scan].sample_input.target_codebase';
  codebaseQ.question = 'Which registered codebase should QA Guardian scan for coverage and bugs?';
  codebaseQ.context = 'Required. QA Guardian scans this codebase on a schedule to raise test coverage and find bugs.';
  newQs.push(codebaseQ);
}
p.adoption_questions = newQs; // drop PR-specific questions (source_control, approve_threshold, dimensions, write_tests)
// service_flow display
p.service_flow = ['Codebase', 'Messages'];
if (tpl.service_flow) tpl.service_flow = ['Codebase', 'Messages'];
writeFileSync(TPL, JSON.stringify(tpl, null, 2));
console.log('qa-guardian.json rewired: recipe_refs, persona goal/instructions, connectors (codebase required, source_control removed), adoption_questions (codebase only).');
console.log('new recipe ids:', COV_ID, BUG_ID);
