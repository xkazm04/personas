// WP1 owns this file. WP0 stub: signatures are the contract, bodies throw.
// Renders the wake context doc: a port of render_decision_prompt (engine/subscription/attention_decide.rs) for the sections that have an input here.

/** (args) => {wakeId, path, brakes:{memory,limit,running}, due:boolean}   // writes contextDir(slug)/<wakeId>.md and a status:"context" wake line */
export function cmdContext() { throw new Error('not implemented (WP1): cmdContext'); }

/** (input) => string   // pure */
export function renderContext() { throw new Error('not implemented (WP1): renderContext'); }
