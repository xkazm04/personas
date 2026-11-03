// bp link doors (spark roadmap S6): the typed client of
// `src-tauri/src/commands/infrastructure/bp_link/`. Every call goes from Rust
// to bp's loopback HTTP: the webview cannot reach bp (the shipped CSP names no
// localhost, bp sends no CORS headers and refuses the `tauri.localhost`
// origin). Personas follows bp's shared focus; it never publishes it.

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { BpFocusOp } from '@/lib/bindings/BpFocusOp';
import type { BpFocusRead } from '@/lib/bindings/BpFocusRead';
import type { BpMorningRead } from '@/lib/bindings/BpMorningRead';
import type { BpProductLink } from '@/lib/bindings/BpProductLink';

export type { BpFocusOp, BpFocusRead, BpMorningRead, BpProductLink };

/** Rust waits 1.5 s on bp; leave room for the IPC hop. */
const BP_TIMEOUT_MS = 5_000;

/** One read of bp's shared focus; `online: false` (held 5 s by Rust) while bp is down. */
export const readBpFocus = () => invoke<BpFocusRead>('bp_focus_read', undefined, { timeoutMs: BP_TIMEOUT_MS });

/** One presence move as `personas:<window>`: hello, follow `*`, unfollow, forget. */
export const moveBpFocus = (window: string, op: BpFocusOp) =>
  invoke<BpFocusRead>('bp_focus_move', { window, op }, { timeoutMs: BP_TIMEOUT_MS });

/** bp's products, each joined by root to the Personas project at the same folder. */
export const listBpProducts = () => invoke<BpProductLink[]>('bp_products', undefined, { timeoutMs: BP_TIMEOUT_MS });

/** bp reads every product's store for the deck; Rust waits up to 8 s. */
const MORNING_TIMEOUT_MS = 12_000;

/**
 * bp's Morning deck, read-only (`online: false` while bp is down). `opened` is the first read's `until`: what landed
 * after it comes back at the end, marked news.
 */
export const readBpMorning = (opened?: string) =>
  invoke<BpMorningRead>('bp_morning', opened ? { opened } : {}, { timeoutMs: MORNING_TIMEOUT_MS });
