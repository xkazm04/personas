// WP1 owns this file. WP0 stub: signatures are the contract, bodies throw.
// Handshake + dev-tools/test-bridge doors, copied from master.mjs (handshake/devTools/invoke).

/** () => Promise<boolean> */
export function appUp() { throw new Error('not implemented (WP1): appUp'); }

/** (route, body?) => Promise<any> */
export function devTools() { throw new Error('not implemented (WP1): devTools'); }

/** (command, params) => Promise<any> */
export function invoke() { throw new Error('not implemented (WP1): invoke'); }
