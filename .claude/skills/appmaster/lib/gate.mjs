// WP2 owns this file. WP0 stub: signatures are the contract, bodies throw.
// The project's own gates, run inside the worktree.

/** (root, brief) => {typecheck?:string,lint?:string,test?:string} */
export function resolveGates() { throw new Error('not implemented (WP2): resolveGates'); }

/** (worktree, gates) => {typecheck?:{ok,exit,tail},lint?:...,test?:...} */
export function runGates() { throw new Error('not implemented (WP2): runGates'); }
