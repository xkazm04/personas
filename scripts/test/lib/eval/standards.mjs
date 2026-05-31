// §7 Standards & branching compliance (docs/tests/autonomy-eval/evaluation-rubric.md).
//
// Scores whether a CODE-TRACK run's artifacts followed the bound Dev-Tools
// project's `standards_config` policy — the pre-commit gates and branching flow
// the connected team is supposed to respect (set in the Dev Tools pipeline's
// Standards stage; injected into every team-member execution by
// engine/runner/team_context.rs). This is the eval-side counterpart: did the
// team actually HONOR the policy it was told to follow?
//
// PURE: takes only pre-computed signals (no fs/git/db here) so it's trivially
// testable and so evaluate.mjs stays the single place that touches the repo.
// Reuses signals evaluate.mjs already computes — codeTrack (build/lint/test),
// docChanged (docs touched in the increment), and the delivered-increment fact
// — rather than re-running anything.
//
// Applicable ONLY when `standards_config` exists for the bound project AND the
// run is code-track. Otherwise returns `null` — a strict no-op, so doc-track
// runs and projects with no policy stay byte-identical in the scorecard
// (the golden-diff invariant, same discipline as §6 resilience).
//
// `standards_config` shape (src/.../pipeline/standardsConfig.ts):
//   { precommit: { lint, docs_required, code_quality },
//     branching: { pr_base: 'main'|'test', automerge: { enabled, target } } }

/**
 * @param {object}  args
 * @param {object|null} args.standardsConfig  parsed dev_projects.standards_config, or null
 * @param {boolean} args.isCodeTrack          seed.tracks includes 'code'
 * @param {object|null} args.codeTrack        { build, lint, test } each { status }, or null
 * @param {boolean} args.docChanged           did the run touch docs (.md/.adr in the patch)
 * @param {object}  args.increment            { delivered, reason } from deliveredIncrement()
 * @returns {null | { applicable:boolean, pct:number|null, rules:Array, policy:object }}
 */
export function standardsCompliance({ standardsConfig, isCodeTrack, codeTrack, docChanged, increment }) {
  if (!isCodeTrack || !standardsConfig) return null;

  const precommit = standardsConfig.precommit || {};
  const branching = standardsConfig.branching || {};
  const rules = [];
  const push = (id, status, basis) => rules.push({ id, status, basis });

  // --- pre-commit gates: scored ONLY when the policy requires them ----------
  // A policy-required gate failing is a real compliance violation. Note these
  // are stricter than the code-track caps: a code-track LINT fail is only a
  // WARN (§1.A), but if the project's policy REQUIRES lint, that same failure
  // is a standards violation here → caps PROMISING. (build/test fails already
  // cap NOT-READY via §1.A, which outranks this — no conflict.)
  if (precommit.lint) {
    const s = codeTrack?.lint?.status;
    push('precommit.lint', s === 'pass' ? 'pass' : s === 'na' || s == null ? 'na' : 'fail', `policy requires lint to pass · code-track lint=${s ?? 'na'}`);
  }
  if (precommit.code_quality) {
    const b = codeTrack?.build?.status;
    const tst = codeTrack?.test?.status;
    // A status "ran" only if a command actually executed (not absent, not 'na').
    const ran = (s) => s != null && s !== 'na';
    const anyRan = ran(b) || ran(tst);
    // A ran gate that isn't 'pass' (fail/flaky/timeout) is a quality violation.
    const failed = (ran(b) && b !== 'pass') || (ran(tst) && tst !== 'pass');
    push('precommit.code_quality', !anyRan ? 'na' : failed ? 'fail' : 'pass', `policy requires code quality · build=${b ?? 'na'} test=${tst ?? 'na'}`);
  }
  if (precommit.docs_required) {
    push('precommit.docs_required', docChanged ? 'pass' : 'fail', docChanged ? 'docs changed in the increment' : 'policy requires docs but none were touched');
  }

  // --- branching flow -------------------------------------------------------
  // pr_base = the branch PRs should open against. We verify "work reached the
  // base" via the delivered-increment signal, which is reliable for the
  // default 'main' base (the increment gate checks master/main advanced). For
  // 'test' the base branch isn't observable in the local clone, so we report
  // it informationally ('na') rather than falsely failing.
  const prBase = branching.pr_base;
  if (prBase === 'main') {
    push('branching.pr_base', increment?.delivered ? 'pass' : 'fail',
      increment?.delivered ? 'increment reached the main base' : `work not merged to main base: ${increment?.reason || 'undelivered'}`);
  } else if (prBase === 'test') {
    push('branching.pr_base', 'na', "policy targets the 'test' base — not observable from the local main/master clone");
  }

  // automerge is a declared intent we can't observe from local git (it's a
  // GitHub-side setting), so it's always informational ('na'), never scored.
  if (branching.automerge?.enabled) {
    push('branching.automerge', 'na', `policy enables GitHub auto-merge into ${branching.automerge.target || prBase || 'base'} (not locally observable)`);
  }

  const scored = rules.filter((r) => r.status === 'pass' || r.status === 'fail');
  const passed = scored.filter((r) => r.status === 'pass').length;
  const pct = scored.length ? Math.round((passed / scored.length) * 100) : null;

  return {
    applicable: scored.length > 0,
    pct,
    rules,
    policy: { precommit, branching },
  };
}
