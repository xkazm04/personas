// Bundle-JSON schema — the shared contract between the CLI writer
// (gather.mjs / evaluate.mjs) and the Rust reader
// (src-tauri/src/commands/eval_runs.rs). JSDoc typedefs document the shape;
// the lightweight validators below are exercised by
// tests/cli/schema-contract.test.mjs against every committed bundle.
//
// CONTRACT POLICY: additive only. Adding a new OPTIONAL field is safe. Changing
// a field's type or removing a field the Rust reader consumes is a BREAKING
// change — bump `$schema_version` and update eval_runs.rs in the same change.

export const SCHEMA_VERSION = 1;

/** The four verdict bands, worst → best. */
export const VERDICTS = ['BROKEN', 'NOT-READY', 'PROMISING', 'PRODUCTION'];

/**
 * @typedef {Object} DeterministicDims
 * @property {number} cascade_completion
 * @property {number} work_density
 * @property {number} handoff_health
 * @property {number} learning_loop
 * @property {number|null} grounding_pct
 */

/**
 * @typedef {Object} Scorecard
 * @property {string} runId
 * @property {string} team
 * @property {string} seed
 * @property {DeterministicDims} deterministic_dims
 * @property {number} team_score
 * @property {string} [verdict]               final verdict (judged runs)
 * @property {string} [provisional_verdict]   deterministic-only verdict
 * @property {Object} facts
 * @property {Array}  grounding
 * @property {Object|null} [code_track]
 * @property {Object|null} [judge]
 * @property {Object|null} [delivered_increment]
 * @property {Object|null} [self_veto]
 * @property {Object|null} [resilience]
 */

/**
 * @typedef {Object} RunMeta
 * @property {string} runId
 * @property {{id:string, tracks:string[], held_out?:boolean}} seed
 * @property {{team:string, teamId?:string}} summary
 */

/** Validate a scorecard.json object. Returns an array of error strings (empty = ok). */
export function validateScorecard(sc) {
  const errs = [];
  if (typeof sc !== 'object' || sc === null) return ['scorecard is not an object'];
  if (typeof sc.runId !== 'string') errs.push('runId missing or not a string');
  if (typeof sc.team !== 'string') errs.push('team missing or not a string');
  if (typeof sc.seed !== 'string') errs.push('seed missing or not a string');
  if (typeof sc.team_score !== 'number') errs.push('team_score missing or not a number');

  const dims = sc.deterministic_dims;
  if (typeof dims !== 'object' || dims === null) {
    errs.push('deterministic_dims missing');
  } else {
    for (const k of ['cascade_completion', 'work_density', 'handoff_health', 'learning_loop']) {
      if (typeof dims[k] !== 'number') errs.push(`deterministic_dims.${k} not a number`);
    }
    if (dims.grounding_pct !== null && typeof dims.grounding_pct !== 'number') {
      errs.push('deterministic_dims.grounding_pct must be number|null');
    }
  }

  // Verdict resolves from `verdict` (judged) else `provisional_verdict`.
  const verdict = sc.verdict ?? sc.provisional_verdict;
  if (typeof verdict !== 'string') errs.push('neither verdict nor provisional_verdict present');
  else if (!VERDICTS.includes(verdict)) errs.push(`verdict not in ${VERDICTS.join('/')}: ${verdict}`);

  if (typeof sc.facts !== 'object' || sc.facts === null) errs.push('facts missing');
  if (!Array.isArray(sc.grounding)) errs.push('grounding not an array');

  // Optional subtrees, when present, must be the right shape.
  if (sc.code_track != null && typeof sc.code_track !== 'object') errs.push('code_track must be object|null');
  if (sc.judge != null && typeof sc.judge !== 'object') errs.push('judge must be object|null');
  if (sc.resilience != null && typeof sc.resilience !== 'object') errs.push('resilience must be object|null');
  return errs;
}

/** Validate a run.json object. Returns an array of error strings (empty = ok). */
export function validateRun(run) {
  const errs = [];
  if (typeof run !== 'object' || run === null) return ['run is not an object'];
  if (typeof run.runId !== 'string') errs.push('runId missing or not a string');

  if (typeof run.seed !== 'object' || run.seed === null) {
    errs.push('seed missing');
  } else {
    if (typeof run.seed.id !== 'string') errs.push('seed.id missing or not a string');
    if (!Array.isArray(run.seed.tracks)) errs.push('seed.tracks not an array');
  }

  if (typeof run.summary !== 'object' || run.summary === null) {
    errs.push('summary missing');
  } else if (typeof run.summary.team !== 'string') {
    errs.push('summary.team missing or not a string');
  }
  return errs;
}
