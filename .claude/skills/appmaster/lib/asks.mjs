// WP1 owns this file. WP0 stub: signatures are the contract, bodies throw.
// Operator channel and the local ask queue.

/** (args) => {id} */
export function cmdSay() { throw new Error('not implemented (WP1): cmdSay'); }

/** (args) => Ask[] */
export function cmdAsks() { throw new Error('not implemented (WP1): cmdAsks'); }

/** (args) => Ask   // also queues an outbox "ask" entry resolution */
export function cmdAnswer() { throw new Error('not implemented (WP1): cmdAnswer'); }
