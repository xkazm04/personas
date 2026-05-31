/* Additive: insert QA Guardian's uc_pr_review recipe into _recipe_seeds.json.
 * Idempotent (replaces only the uc_pr_review row); does NOT touch the template
 * (qa-guardian.json is edited by hand for this capability). Mirrors the recipe
 * shape produced by __redesign_qa_guardian.mjs::mkRecipe.
 * Run: node scripts/templates/__add_qa_pr_review.mjs */
import { readFileSync, writeFileSync } from 'node:fs';

const SEEDS = 'scripts/templates/_recipe_seeds.json';
const PR_ID = 'c0a5e300-4b1d-4c0a-9e30-73a5c0a5e300'; // === qa-guardian.json recipe_ref

const prUC = {
  id: 'uc_pr_review',
  title: 'PR Test + Merge',
  description: "Reactive review of a pull request Dev Clone opened: check out the PR branch in an isolated git worktree, run the project's tests there, then — per the team's standards/branching policy — enable GitHub native auto-merge (pass + automerge), approve (pass, no automerge), or request changes (fail). Never touches the team's working tree; never merges on a failing or un-run suite.",
  capability_summary: 'On dev-clone.pr.created, test the PR in an isolated worktree and enable auto-merge / approve / request-changes per the standards policy.',
  category: 'development', enabled_by_default: true, execution_mode: 'e2e', model_override: null,
  suggested_trigger: { trigger_type: 'manual', config: {}, description: "Auto-fires when Dev Clone emits dev-clone.pr.created — wired via this use case's event subscription, not the primary trigger. Can also be run manually against a PR." },
  connectors: ['codebase', 'github'],
  notification_channels: [{ type: 'messaging', description: 'PR verdict summary: PR number, test result, and action taken (auto-merge enabled / approved / changes requested).' }],
  review_policy: { mode: 'never', context: 'The verdict (merge / approve / request-changes) is applied automatically from the test result + policy; GitHub native auto-merge still waits on the repo\'s required checks.' },
  memory_policy: { enabled: true, context: 'Persist per-PR test outcomes + recurring failure patterns so repeat failures on the same branch are recognized.' },
  event_subscriptions: [
    { event_type: 'dev-clone.pr.created', direction: 'listen', description: 'Payload: { pr_number, branch, repo, owner }. Triggers an isolated test of the new PR.' },
    { event_type: 'qa.pr.approved', direction: 'emit', description: 'Payload: { pr_number, action }. Tests passed; the PR was approved or native auto-merge was enabled.' },
    { event_type: 'qa.pr.changes_requested', direction: 'emit', description: 'Payload: { pr_number, failing }. Tests failed; changes requested so Dev Clone fixes it.' },
  ],
  error_handling: "Codebase / git not accessible → report it and stop (precondition_failed). GitHub connector missing → still run the tests in the worktree and emit qa.pr.approved / qa.pr.changes_requested, but report that the PR action could not be applied. Worktree creation fails → never merge without a green run. ALWAYS remove the scratch worktree at the end (leave no orphan branches).",
  input_schema: [
    { name: 'target_codebase', type: 'connector_ref', ui_component: 'CodebaseSelector', connector: 'codebase', required: true, description: 'The registered codebase whose PRs QA Guardian tests.' },
  ],
  sample_input: { target_codebase: '{{param.aq_target_codebase}}' },
  tool_hints: ['file_read', 'search_code', 'run_tests', 'http_request'], test_fixtures: [],
  use_case_flow: { nodes: [
    { id: 'p1', type: 'start', label: 'dev-clone.pr.created' },
    { id: 'p2', type: 'action', label: 'Read PR branch + number from payload' },
    { id: 'p3', type: 'connector', label: 'git worktree add (isolated PR checkout)', connector: 'codebase' },
    { id: 'p4', type: 'connector', label: 'run_tests in the worktree', connector: 'codebase' },
    { id: 'p5', type: 'decision', label: 'Tests pass?' },
    { id: 'p6', type: 'decision', label: 'Policy automerge enabled?' },
    { id: 'p7', type: 'connector', label: 'Enable GitHub native auto-merge', connector: 'github' },
    { id: 'p8', type: 'connector', label: 'Approve PR', connector: 'github' },
    { id: 'p9', type: 'connector', label: 'Request changes + failing output', connector: 'github' },
    { id: 'p10', type: 'event', label: 'Emit qa.pr.approved' },
    { id: 'p11', type: 'event', label: 'Emit qa.pr.changes_requested' },
    { id: 'p12', type: 'action', label: 'Remove worktree (cleanup)' },
    { id: 'p13', type: 'end', label: 'Done' },
  ], edges: [
    { source: 'p1', target: 'p2' }, { source: 'p2', target: 'p3' }, { source: 'p3', target: 'p4' }, { source: 'p4', target: 'p5' },
    { source: 'p5', target: 'p6', variant: 'yes', label: 'Pass' }, { source: 'p5', target: 'p9', variant: 'no', label: 'Fail' },
    { source: 'p6', target: 'p7', variant: 'yes', label: 'Yes' }, { source: 'p6', target: 'p8', variant: 'no', label: 'No' },
    { source: 'p7', target: 'p10' }, { source: 'p8', target: 'p10' }, { source: 'p9', target: 'p11' },
    { source: 'p10', target: 'p12' }, { source: 'p11', target: 'p12' }, { source: 'p12', target: 'p13' },
  ] },
};

const seeds = JSON.parse(readFileSync(SEEDS, 'utf8'));
seeds.recipes = seeds.recipes.filter((r) => !(r.source_template_id === 'qa-guardian' && r.source_use_case_id === 'uc_pr_review'));
seeds.recipes.push({
  id: PR_ID, source_template_id: 'qa-guardian', source_use_case_id: 'uc_pr_review', source_use_case_name: 'uc_pr_review',
  source_version: '1.0.0', name: 'uc_pr_review', description: prUC.description, category: 'development',
  prompt_template: JSON.stringify(prUC), tool_requirements: null, tags: JSON.stringify(['qa-guardian', 'derived']),
});
seeds.recipe_count = seeds.recipes.length;
writeFileSync(SEEDS, JSON.stringify(seeds, null, 2));
console.log(`added uc_pr_review recipe (${PR_ID}); recipe_count=${seeds.recipe_count}`);
