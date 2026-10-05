// WP2 owns this file. WP0 stub: signatures are the contract, bodies throw.
// Verify the builder's claim, then the rung-3 merge gate.

/** (args) => Run   // merged | held(+ask queued) | released */
export function cmdSettle() { throw new Error('not implemented (WP2): cmdSettle'); }

/** (run: Run, verdict) => {ok:boolean, reason?:string, sha?:string} */
export function mergeGate() { throw new Error('not implemented (WP2): mergeGate'); }
