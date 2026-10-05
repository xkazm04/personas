// WP1 owns this file. WP0 stub: signatures are the contract, bodies throw.
// Validates and applies a master decision.

/** (decision, {slug, wakeId, brief}) => {ok:boolean, errors:string[]}   // pure; rules in the brief, Acceptance 2 */
export function validateDecision() { throw new Error('not implemented (WP1): validateDecision'); }

/** (args) => {wakeId, runIds:string[], outbox:string[], asks:string[], nextWakeAt}   // mints runIds BEFORE writing; Refusal on invalid */
export function cmdDecide() { throw new Error('not implemented (WP1): cmdDecide'); }
