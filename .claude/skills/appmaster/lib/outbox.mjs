// WP1 owns this file. WP0 stub: signatures are the contract, bodies throw.
// Idempotent queue of app-owned writes, replayed through the dev-tools doors when the app is up.

/** (args) => list|replay result; sub = args._[0] */
export function cmdOutbox() { throw new Error('not implemented (WP1): cmdOutbox'); }

/** (entry, {dryRun}) => {state, evidence}   // read-only DB check before and after posting */
export function replayEntry() { throw new Error('not implemented (WP1): replayEntry'); }
