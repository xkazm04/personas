// WP2 owns this file. WP0 stub: signatures are the contract, bodies throw.
// Spawn, watch and release builders.

/** (args) => Run   // Refusal at memory/limit/cap */
export function cmdDispatch() { throw new Error('not implemented (WP2): cmdDispatch'); }

/** (args) => Array<{runId,state,pidAlive,streamAgeMin,quiet,timedOut}> */
export function cmdWatch() { throw new Error('not implemented (WP2): cmdWatch'); }

/** (args) => Run */
export function cmdRelease() { throw new Error('not implemented (WP2): cmdRelease'); }

/** (run: Run, promptText: string) => {pid, sessionId} */
export function spawnWorker() { throw new Error('not implemented (WP2): spawnWorker'); }

/** (streamText: string) => {result, isError, costUsd, turns}|null   // the final type:result line */
export function parseResult() { throw new Error('not implemented (WP2): parseResult'); }
