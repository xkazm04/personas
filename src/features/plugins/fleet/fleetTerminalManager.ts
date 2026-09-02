/**
 * Fleet terminal manager — long-lived xterm instances, one per session.
 *
 * The previous design created and *disposed* an xterm every time the active
 * session changed (FleetTerminalPane keyed its whole lifecycle on
 * `sessionId`). Switching sessions therefore lost the scrollback and
 * re-rendered the surviving stream from scratch; sessions you weren't
 * looking at kept their PTY output in Rust but had no terminal to receive it.
 *
 * This manager flips that: it owns a `Terminal` (+ addons) per `sessionId`,
 * parked in a detached holder `<div>` when no pane is showing it (bounded by
 * an LRU — see MAX_PARKED — so a 40-session fleet can't accumulate 40 idle
 * xterms). One shared `fleet-session-output` listener dispatches chunks into
 * the registry map. The React component (`FleetTerminalPane`) becomes a thin
 * *mount point* that attaches the holder into its container on mount and
 * detaches (NOT disposes) on unmount. Consequences:
 *
 *   - Attaching subscribes to live PTY output and replays the backend ring
 *     snapshot; detaching unsubscribes (the Rust reader keeps buffering into a
 *     bounded ring but stops streaming over IPC). An unwatched session costs
 *     the app nothing to render; switching back replays the recent tail. This
 *     is what lets a 16-CLI fleet stay light — work tracks watched sessions,
 *     not running ones.
 *   - Many panes can attach different sessions at once → grid view (P2).
 *   - Renderer (WebGL) is attach-scoped so N background terminals don't hold
 *     N live GL contexts, AND bounded fleet-wide by its own LRU (MAX_WEBGL)
 *     so N simultaneously *attached* panes can't either; unicode11 /
 *     web-links load once.
 *   - A shared `config` (font size, copy-on-select, theme) is applied to
 *     every live terminal and to all future ones (P4).
 *
 * Singleton survives Vite HMR by hanging off `globalThis`. This comment named
 * `executionBuffers / eventBus` as the precedent until 2026-08-28; NEITHER
 * IDENTIFIER EXISTS. Both appear in this tree only inside four comments citing
 * each other (`.claude/CLAUDE.md` records the same measurement). The real
 * neighbours are `executionSink` (`src/lib/execution/executionSink.ts`, a
 * module const guarded by a `generation` counter, not a globalThis key) and
 * `globalThis.__personasEventBridge` (`src/lib/eventBridge.ts`). Doctrine for
 * choosing the rung: `docs/concepts/golden-paths/hmr-safe-singletons.md`.
 */
import { Terminal } from '@xterm/xterm';
import type { IDisposable, ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { listen } from '@tauri-apps/api/event';

import { EventName } from '@/lib/eventRegistry';
import { writeInput, resizeSession, subscribeTerminal, unsubscribeTerminal } from '@/api/fleet/fleet';
import { openExternalUrl } from '@/api/system/system';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { silentCatch } from '@/lib/silentCatch';

const FONT_FAMILY = 'Menlo, "DejaVu Sans Mono", "Lucida Console", monospace';

/** Min/max for the user-controllable font zoom (P4). */
export const FLEET_FONT_MIN = 9;
export const FLEET_FONT_MAX = 22;
export const FLEET_FONT_DEFAULT = 12;

/** Resolved (auto already collapsed to dark|light) terminal appearance. */
export type FleetResolvedTheme = 'dark' | 'light';

export interface FleetTerminalConfig {
  fontSize: number;
  copyOnSelect: boolean;
  theme: FleetResolvedTheme;
}

let currentConfig: FleetTerminalConfig = {
  fontSize: FLEET_FONT_DEFAULT,
  copyOnSelect: true,
  theme: 'dark',
};

// Transient font override (px) layered on top of `currentConfig.fontSize`.
// The grid overlay sets a density-scaled size here while open and clears it
// (null) on close, so the user's persisted single-view font is never lost.
let fontOverride: number | null = null;
function effectiveFontSize(): number {
  return fontOverride ?? currentConfig.fontSize;
}

// Match Personas dark theme. Cursor + selection use violet (matches the
// "awaiting input" attention dot). ANSI yellow/brightYellow stay as-is —
// programs may emit legitimate yellow and preserving it is the terminal's job.
const DARK_THEME: ITheme = {
  background: '#0a0a0c',
  foreground: '#e6e6e8',
  cursor: '#a78bfa',
  cursorAccent: '#0a0a0c',
  selectionBackground: '#a78bfa44',
  black: '#1e1e22',
  red: '#ef4444',
  green: '#10b981',
  yellow: '#fbbf24',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e6e6e8',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#fcd34d',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#fafafa',
};

// Light variant — used when the app is in a light theme (or the user forces
// it). ANSI colours are darkened so they stay legible on a near-white field.
const LIGHT_THEME: ITheme = {
  background: '#fbfbfd',
  foreground: '#1f2024',
  cursor: '#7c3aed',
  cursorAccent: '#fbfbfd',
  selectionBackground: '#7c3aed33',
  black: '#1f2024',
  red: '#dc2626',
  green: '#059669',
  yellow: '#b45309',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#3f3f46',
  brightBlack: '#71717a',
  brightRed: '#ef4444',
  brightGreen: '#10b981',
  brightYellow: '#d97706',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#18181b',
};

function themeFor(theme: FleetResolvedTheme): ITheme {
  return theme === 'light' ? LIGHT_THEME : DARK_THEME;
}

/** One managed terminal — the durable resource keyed by session id. */
interface ManagedTerminal {
  sessionId: string;
  term: Terminal;
  fit: FitAddon;
  /** Detached-by-default element the terminal is `open()`'d into; moved
   *  between pane containers on attach/detach. */
  holder: HTMLDivElement;
  /**
   * The pane container the holder currently lives in — the OWNER token.
   *
   * There is one holder per session, so a second pane attaching the same
   * session re-parents it and the first pane goes blank. That much is inherent
   * to a single DOM node. What was not inherent is the teardown: whichever pane
   * unmounted FIRST ran the full detach — unsubscribe, dispose the renderer,
   * remove the holder — on the terminal the OTHER pane was still showing.
   *
   * The last attacher wins the token, and a detach from anyone else is a no-op.
   *
   * This used to end "fires on no current path — the invariant the multiplexer
   * needs before a surface makes it reachable". THAT IS NO LONGER TRUE, and had
   * stopped being true before the sentence was written: `passportFleet.tsx` and
   * `FleetPreviewPanel.tsx` each mount a pane for a session id they choose,
   * outside the fleet overlay entirely, so two surfaces can hold the same
   * session at once with nothing structural stopping them.
   * `FleetTerminalPane.tsx:66-76` already documents the displacement notice
   * that exists precisely because the path is live, and
   * `__tests__/FleetTerminalPaneDisplaced.test.tsx` pins it. Treat this as a
   * reachable path, not a latent invariant.
   */
  owner: HTMLElement | null;
  resizeObs: ResizeObserver;
  disposables: IDisposable[];
  onMouseUp: () => void;
  onContextMenu: (e: MouseEvent) => void;
  /** WebGL renderer is attach-scoped to bound live GL contexts. */
  webgl: WebglAddon | null;
  opened: boolean;
  attached: boolean;
  rafId: number | null;
  /**
   * Subscription/hydration state. The backend only streams a session's PTY
   * output while it's subscribed; on attach we (re)subscribe and replay the
   * ring snapshot. Between issuing the subscribe and writing its snapshot, live
   * `fleet-session-output` events must be held so they land AFTER the snapshot
   * (never interleaved). `hydrating` gates that; `pendingLive` queues the live
   * chunks; `hydrationGen` lets a newer attach/detach cancel a stale snapshot
   * resolution (rapid switching).
   */
  hydrating: boolean;
  pendingLive: string[];
  hydrationGen: number;
  /**
   * Last cols/rows actually pushed to the PTY. A resize delivered to the
   * device makes the child reflow and repaint its whole screen, and layout
   * churn (drags, grid density changes, panel animations) fires the
   * ResizeObserver far more often than it changes the CHARACTER grid — so a
   * push whose cols/rows are unchanged buys nothing and costs an IPC round
   * trip plus a full-screen repaint arriving back through the ring. Cleared
   * on detach so every attach reconciles the size once against its new slot.
   */
  lastCols: number;
  lastRows: number;
  /** True once the dead-session notice has been painted for the current
   *  hydration failure; cleared by the next successful hydrate so a session
   *  that comes back does not keep a stale tombstone, and a repeated failure
   *  does not stack the same line over and over. */
  deadNoticeShown: boolean;
  /**
   * True once a write into this session's emulator has thrown.
   *
   * A throw is reported ONCE per session rather than per chunk: a terminal in a
   * bad state (disposed emulator, an addon that lost its buffer) fails on every
   * chunk the backend sends, and a fleet under load sends thousands. Reporting
   * each one turns a single fault into a telemetry flood that buries its own
   * first occurrence — the one event that says when it started. Cleared by the
   * next successful hydrate, so a session that recovers can report again.
   */
  writeFailed: boolean;
  /** True once the listener-failure notice has been painted into this terminal;
   *  cleared by the next successful hydrate so a pane that recovers does not
   *  keep a stale warning, and a repeated failure does not stack the same line. */
  listenerNoticeShown: boolean;
  /**
   * True while this terminal holds a snapshot from a subscribe that SUCCEEDED
   * into the container it is still mounted in — i.e. re-hydrating would buy
   * nothing and cost the local scrollback.
   *
   * `hydrate` always calls `m.term.reset()` before writing the backend ring
   * tail, and `scrollback: 5000` is deliberately LARGER than that ring, so the
   * reset is lossy by design: whatever the operator had scrolled back to and the
   * ring no longer holds is gone, plus a visible flash. That is the right trade
   * for a real attach and pure loss for a re-invocation of an effect that is
   * supposed to be idempotent.
   *
   * Cleared on detach (which unsubscribed, so the next attach genuinely must
   * re-subscribe) and on a hydration FAILURE — a dead session must stay
   * retryable by re-attaching, which is exactly what a blanket
   * already-attached guard would have taken away.
   */
  hydratedOk: boolean;
}

/**
 * Localized one-line notice painted into the terminal when subscribing fails.
 *
 * `fleet_subscribe_terminal` returns Err("session not found: …") when the
 * registry has lost the session. Dropping that on the floor left the operator
 * with a black rectangle that is INDISTINGUISHABLE from a session that simply
 * has not printed anything yet — the one state they cannot act on, because they
 * cannot tell whether to wait or to give up. This module is not a React
 * component and has no `t`, so the pane pushes the translated string in before
 * it attaches. Empty until then, and an empty notice paints nothing rather than
 * falling back to hardcoded English.
 */
let deadNotice = '';

/** Set the translated dead-session notice (called from FleetTerminalPane). */
export function setFleetTerminalDeadNotice(text: string): void {
  deadNotice = text;
}

/**
 * Localized notice for the OTHER failure door — the shared output listener.
 *
 * There are two independent ways a pane can end up showing a snapshot that
 * never updates, and only one of them used to say so. `subscribeTerminal` is a
 * per-session IPC command; `listen('fleet-session-output')` is a separate,
 * app-wide registration. A pane whose subscribe SUCCEEDS and whose listener
 * registration FAILED paints its ring snapshot perfectly and then freezes —
 * keystrokes still reach the PTY, the child still answers, and nothing renders.
 * That is indistinguishable from a hung agent, which is the wrong thing for the
 * operator to conclude. Pushed in from `FleetTerminalPane` for the same reason
 * as `deadNotice`: this module has no `t`.
 */
let listenerNotice = '';

/** Set the translated listener-failure notice (called from FleetTerminalPane). */
export function setFleetTerminalListenerNotice(text: string): void {
  listenerNotice = text;
}

// HMR-safe registry. Reusing the existing map across hot reloads keeps live
// terminals (and their buffers) alive while editing the surrounding UI.
const REGISTRY_KEY = '__fleetTerminalRegistry__';
const registry: Map<string, ManagedTerminal> =
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] as Map<string, ManagedTerminal> | undefined ??
  new Map<string, ManagedTerminal>();
(globalThis as Record<string, unknown>)[REGISTRY_KEY] = registry;

// Detached ("parked") terminals, oldest-detach first — the LRU that bounds
// how many off-screen xterm instances (5000-line scrollback each) we retain.
// Cycling focus through a 40-session fleet must not accumulate 40 terminals:
// beyond MAX_PARKED the oldest parked one is disposed. Lossless in practice —
// a re-attach re-subscribes and replays the backend ring snapshot anyway, so
// the recreated terminal shows the same recent tail the parked one would have.
const PARKED_KEY = '__fleetTerminalParked__';
const parked: string[] =
  ((globalThis as Record<string, unknown>)[PARKED_KEY] as string[] | undefined) ?? [];
(globalThis as Record<string, unknown>)[PARKED_KEY] = parked;

/** Max detached xterm instances kept alive for instant re-attach. */
const MAX_PARKED = 6;

/**
 * Max terminals holding a live accelerated (WebGL) renderer AT THE SAME TIME.
 *
 * MAX_PARKED bounds only the parked side of the ladder; attached terminals were
 * unbounded, and every attach calls `loadWebgl()`. The grid overlay mounts a
 * live pane for the focused tile AND for every session that needs the operator
 * (`needsLiveAttention`), and `gridDim` tiles up to 4x4 — so a 16-session fleet
 * sitting on `awaiting_input` asks for 16 contexts at once, before counting the
 * panes that live outside the overlay (the mastermind preview, the passport
 * modal, the monitor's fullscreen pane). Fleet is this app's ONLY WebGL
 * consumer — the charts are SVG — so that number IS the app's context count.
 *
 * GPU contexts are COUNTED, not metered: crossing the platform cap makes the
 * browser revoke the OLDEST context — which may belong to the terminal the
 * operator is reading, and is not necessarily the one that caused the overrun.
 *
 * So the budget is enforced here instead, on the one door through which
 * renderers are created, which makes the demotion deterministic and
 * recent-first. Past the cap the least-recently-used accelerated terminal drops
 * its addon and xterm falls back to the DOM renderer automatically — slower to
 * paint, identical output, no revocation from under a live pane, and the same
 * fallback `onContextLoss` already exercises (and that a machine with no WebGL
 * at all runs on permanently).
 *
 * 6 leaves headroom beneath the ~16-context floor browsers implement, for the
 * charts and canvases the rest of the app may hold at the same time.
 */
export const MAX_WEBGL = 6;

// Sessions holding a live WebGL addon, least-recently-loaded first.
//
// Two parallel builds each landed this ledger under a name of its own, and both
// vocabularies now have readers (the stats object exposes both spellings for the
// same reason). ONE array is published under BOTH keys, so a devtools console —
// or a test — reaches the same object either way; aliasing beats picking a
// winner and silently leaving the other name reading `undefined`.
const WEBGL_LRU_KEY = '__fleetTerminalWebglLru__';
const WEBGL_ORDER_KEY = '__fleetTerminalWebglOrder__';
const webglLru: string[] =
  ((globalThis as Record<string, unknown>)[WEBGL_LRU_KEY] as string[] | undefined) ??
  ((globalThis as Record<string, unknown>)[WEBGL_ORDER_KEY] as string[] | undefined) ??
  [];
(globalThis as Record<string, unknown>)[WEBGL_LRU_KEY] = webglLru;
(globalThis as Record<string, unknown>)[WEBGL_ORDER_KEY] = webglLru;

/** Renderers dropped BECAUSE of MAX_WEBGL — the same instrument logic as
 *  `bumpEvictions()` below: a cap set too low and a renderer bug both read as
 *  "the terminal got slow", and only this counter separates them. */
const WEBGL_EVICTIONS_KEY = '__fleetTerminalWebglEvictions__';
function bumpWebglEvictions(): void {
  const g = globalThis as Record<string, unknown>;
  g[WEBGL_EVICTIONS_KEY] = ((g[WEBGL_EVICTIONS_KEY] as number | undefined) ?? 0) + 1;
}

function unGl(sessionId: string): void {
  const i = webglLru.indexOf(sessionId);
  if (i !== -1) webglLru.splice(i, 1);
}

/** Move a session to the most-recent end of the accelerated-renderer LRU. */
function touchGl(sessionId: string): void {
  unGl(sessionId);
  webglLru.push(sessionId);
}

/**
 * Budget evictions are counted, because a budget set too low and a bug in the
 * replay handshake produce the SAME user report — "my terminals keep going
 * blank and replaying" — and nothing else in the app can tell them apart.
 * MAX_PARKED is an unvalidated constant; this counter is the instrument that
 * says whether it is being hit at all. HMR-safe like the registry beside it, so
 * a hot reload mid-session doesn't zero the evidence.
 *
 * Read it with `getFleetTerminalStats()` (or `__fleetTerminalEvictions__` from
 * a devtools console). A rising count while the operator reports blank
 * terminals means the budget; a flat count means look at `hydrate()`.
 */
const EVICTIONS_KEY = '__fleetTerminalEvictions__';
function bumpEvictions(): void {
  const g = globalThis as Record<string, unknown>;
  g[EVICTIONS_KEY] = ((g[EVICTIONS_KEY] as number | undefined) ?? 0) + 1;
}

export interface FleetTerminalStats {
  /** Terminals alive right now (attached + parked). */
  live: number;
  /** Detached terminals held for instant re-attach. */
  parked: number;
  /** The LRU budget those parked terminals are bounded by. */
  maxParked: number;
  /** Terminals disposed BECAUSE of that budget, since app start. */
  evictions: number;
  /** Terminals holding a live accelerated (WebGL) renderer right now. */
  webgl: number;
  /** The same count under the other name the parallel builds gave it. Both
   *  spellings already have readers; they are one number read from one
   *  ledger, so they cannot disagree. */
  webglContexts: number;
  /** The budget those GL contexts are bounded by. */
  maxWebgl: number;
  /** Renderers demoted to the DOM fallback BECAUSE of that budget. */
  webglEvictions: number;
}

/**
 * Snapshot of the manager's budget bookkeeping — the early-warning instrument
 * for a MAX_PARKED or MAX_WEBGL set too low.
 */
export function getFleetTerminalStats(): FleetTerminalStats {
  const g = globalThis as Record<string, unknown>;
  return {
    live: registry.size,
    parked: parked.length,
    maxParked: MAX_PARKED,
    evictions: (g[EVICTIONS_KEY] as number | undefined) ?? 0,
    webgl: webglLru.length,
    webglContexts: webglLru.length,
    maxWebgl: MAX_WEBGL,
    webglEvictions: (g[WEBGL_EVICTIONS_KEY] as number | undefined) ?? 0,
  };
}

/**
 * Panes that want to be TOLD when the holder is taken out from under them.
 *
 * There is one holder `<div>` per session, so two mount points can never both
 * display it — that much is inherent. What was not inherent is that the loser
 * found out by rendering an empty black box: `attachTerminal` re-parented the
 * holder unconditionally, with the mutual exclusion between surfaces asserted
 * only in a prose comment. Five independent call sites mount a pane for a
 * session id THEY choose (the grid, an overlay tile, the monitor's fullscreen
 * pane, the mastermind preview, the passport modal), and the last two live
 * outside the fleet overlay entirely, so nothing structural keeps them apart.
 *
 * A refcount is the wrong instrument here — the resource is a DOM node, and
 * counting holders would not let two of them paint. Naming the current owner
 * and notifying the displaced one is the reachable half: the pane can say where
 * its terminal went, and offer to take it back.
 *
 * Keyed by container element and WEAK, so an unmounted pane's entry disappears
 * with it and a forgotten deregistration cannot leak.
 */
const holderLostListeners = new WeakMap<HTMLElement, () => void>();

/**
 * Register `cb` to fire when another container takes this session's holder away
 * from `container`. Returns the deregistration.
 */
export function onTerminalHolderLost(container: HTMLElement, cb: () => void): () => void {
  holderLostListeners.set(container, cb);
  return () => {
    if (holderLostListeners.get(container) === cb) holderLostListeners.delete(container);
  };
}

function unpark(sessionId: string): void {
  const i = parked.indexOf(sessionId);
  if (i !== -1) parked.splice(i, 1);
}

/**
 * ONE app-wide `fleet-session-output` listener dispatching into the registry
 * map — O(1) per chunk regardless of how many terminals exist. The previous
 * design registered one filtered listener per terminal, so every output chunk
 * ran N callbacks with N terminals ever-created. The backend only emits for
 * subscribed (attached) sessions, so chunks for unknown ids are simply dropped.
 * HMR-safe: the unlisten survives on globalThis so a hot reload doesn't stack
 * a second listener.
 */
const OUTPUT_LISTENER_KEY = '__fleetTerminalOutputListener__';

/**
 * Deliver one chunk into one session's emulator, CONTAINED.
 *
 * The dispatch below runs inside the ONE shared `fleet-session-output` callback,
 * which is the whole fleet's only door to live PTY output. An exception thrown
 * out of it — a disposed emulator, an addon in a bad state, anything `write`
 * can raise for exactly one session — escapes into the Tauri event callback and
 * every terminal in the app stops receiving output at once, with no error and
 * nothing to restart it. One session's fault must not be able to blackout the
 * fleet, so the throw stops here.
 */
function writeChunk(m: ManagedTerminal, chunk: string): void {
  try {
    m.term.write(chunk);
  } catch (e) {
    // Once per session — see `writeFailed`.
    if (!m.writeFailed) {
      m.writeFailed = true;
      silentCatch('fleetTerminal:write')(e);
    }
  }
}

/**
 * Register the listener, reporting the outcome to the CALLER.
 *
 * It used to return `void` and swallow its own rejection, which is why the
 * blackout was silent: `attachTerminal` called it and then called `hydrate`
 * regardless, `hydrate` succeeded (a different IPC command), the snapshot
 * painted, and the pane looked healthy forever. Handing the promise back is what
 * lets the attach path tell the operator, and what lets the retry below know it
 * has something to retry.
 */
function ensureSharedOutputListener(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  if (g[OUTPUT_LISTENER_KEY]) return Promise.resolve();
  g[OUTPUT_LISTENER_KEY] = true; // set eagerly so a re-entrant call can't double-listen
  return listen<{ session_id: string; chunk: string }>(EventName.FLEET_SESSION_OUTPUT, (event) => {
    const m = registry.get(event.payload.session_id);
    if (!m) return;
    if (m.hydrating) {
      m.pendingLive.push(event.payload.chunk);
      return;
    }
    writeChunk(m, event.payload.chunk);
  })
    .then((fn) => {
      g[OUTPUT_LISTENER_KEY] = fn;
      listenerBackoffMs = LISTENER_RETRY_MIN_MS;
    })
    .catch((e) => {
      g[OUTPUT_LISTENER_KEY] = undefined; // allow a retry on the next attach
      silentCatch('fleetTerminal:listen')(e);
      // Re-thrown, not swallowed: the caller decides what the operator is told.
      throw e;
    });
}

/**
 * Retry the registration on a bounded exponential backoff.
 *
 * Retry used to be deferred to the next `attachTerminal` — a call the operator
 * has no reason to make, because the pane in front of them looks fine. So the
 * one event that could recover the fleet was gated on the one thing a
 * successfully-lying UI guarantees will not happen.
 */
const LISTENER_RETRY_MIN_MS = 1_000;
const LISTENER_RETRY_MAX_MS = 30_000;
let listenerBackoffMs = LISTENER_RETRY_MIN_MS;
let listenerRetryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleListenerRetry(): void {
  if (listenerRetryTimer !== null) return; // one retry in flight is enough
  const delay = listenerBackoffMs;
  listenerBackoffMs = Math.min(listenerBackoffMs * 2, LISTENER_RETRY_MAX_MS);
  listenerRetryTimer = setTimeout(() => {
    listenerRetryTimer = null;
    // eslint-disable-next-line custom/async-catch-requires-helper -- ensureSharedOutputListener already ran silentCatch('fleetTerminal:listen') on this exact error before re-throwing it; a second report per retry would turn one outage into a Sentry flood measured in attempts.
    ensureSharedOutputListener().catch(() => scheduleListenerRetry());
  }, delay);
}

/**
 * Paint the listener-failure notice into one attached terminal, once.
 *
 * Queued behind an in-flight hydration rather than written straight away: the
 * snapshot resolution calls `term.reset()`, so a notice written first would be
 * erased by the very handshake that makes the pane look healthy. `pendingLive`
 * is exactly the queue that already exists for "must land after the snapshot".
 */
function paintListenerNotice(m: ManagedTerminal): void {
  if (!m.attached || !listenerNotice || m.listenerNoticeShown) return;
  m.listenerNoticeShown = true;
  const line = `\r\n\x1b[33m${listenerNotice}\x1b[0m\r\n`;
  if (m.hydrating) m.pendingLive.push(line);
  else writeChunk(m, line);
}

/** Open a web link from terminal output via the OS browser (sanitized). */
function handleLink(_event: MouseEvent, uri: string): void {
  const safe = sanitizeExternalUrl(uri);
  if (!safe) return;
  openExternalUrl(safe).catch(silentCatch('fleetTerminal:openLink'));
}

/**
 * Read the WebView clipboard and deliver it to the session's PTY *as a paste*.
 *
 * Writing the text straight to the PTY was wrong in the one way that matters: a
 * terminal's input is keystrokes, not text, and the typed-versus-pasted
 * distinction is what decides whether a newline inserts a line or SUBMITS one.
 * The framing that carries that distinction is bracketed paste
 * (`ESC[200~ … ESC[201~`, DECSET 2004) and this path never emitted it — so a
 * multi-line clipboard payload arrived as a sequence of submitted lines, and in
 * a shell that means every line after the first EXECUTES. The old comment here
 * ("terminals handle that") named the mechanism that was missing.
 *
 * `term.paste()` is that mechanism: it normalizes CRLF/LF to CR, wraps the
 * payload in the brackets whenever the child has actually enabled the mode, and
 * emits through `onData` — the same door a keystroke takes, so it still lands
 * in `writeInput`.
 *
 * The trailing-newline strip stays, but ONLY for a child that has not enabled
 * bracketed paste: there it is the sole thing between a copied line (which
 * almost always ends in a newline) and an unintended submit. Under bracketed
 * paste the child decides what to do with that newline, and swallowing it would
 * corrupt the payload the operator actually copied.
 */
function pasteFromClipboard(sessionId: string): void {
  navigator.clipboard
    .readText()
    .then((textRaw) => {
      if (!textRaw) return;
      const m = registry.get(sessionId);
      if (!m || !m.opened) {
        // No live emulator to frame the paste through — fall back to the raw
        // write, trailing newline stripped, exactly as before.
        return writeInput(sessionId, textRaw.replace(/\r?\n$/, ''));
      }
      m.term.paste(m.term.modes.bracketedPasteMode ? textRaw : textRaw.replace(/\r?\n$/, ''));
      return undefined;
    })
    .catch(silentCatch('fleetTerminal:paste'));
}

function pushResize(m: ManagedTerminal): void {
  const { cols, rows } = m.term;
  // Skip the no-op: same grid, nothing for the child to reflow to.
  if (cols === m.lastCols && rows === m.lastRows) return;
  m.lastCols = cols;
  m.lastRows = rows;
  resizeSession(m.sessionId, cols, rows).catch(silentCatch('fleetTerminal:resize'));
}

function scheduleFit(m: ManagedTerminal): void {
  if (!m.attached) return;
  if (m.rafId !== null) cancelAnimationFrame(m.rafId);
  m.rafId = requestAnimationFrame(() => {
    m.rafId = null;
    try {
      m.fit.fit();
      pushResize(m);
    } catch (e) {
      silentCatch('fleetTerminal:fit')(e);
    }
  });
}

/**
 * Drop the least-recently-loaded accelerated renderers until at most MAX_WEBGL
 * remain. `keepId` is the terminal that just asked for one and is never its own
 * victim. A dropped terminal keeps rendering through xterm's DOM fallback.
 *
 * Termination is by construction, not by luck: `disposeWebgl` ALWAYS un-lists
 * the session, and the inconsistent heads (a ghost id whose terminal is gone,
 * an id whose context was already lost) are shifted by hand — counting those
 * as demotions would make the instrument lie, the same argument
 * `bumpEvictions` documents. The parked LRU spun forever on exactly that hole.
 */
function enforceWebglBudget(keepId: string): void {
  while (webglLru.length > MAX_WEBGL) {
    const oldest = webglLru[0]!;
    const victim = registry.get(oldest);
    if (!victim || !victim.webgl || oldest === keepId) {
      webglLru.shift();
      continue;
    }
    bumpWebglEvictions();
    disposeWebgl(victim);
  }
}

function loadWebgl(m: ManagedTerminal): void {
  if (m.webgl) {
    // Already accelerated — a re-attach is still a use, so it refreshes this
    // session's place in the LRU instead of leaving it as the next victim.
    touchGl(m.sessionId);
    return;
  }
  try {
    const addon = new WebglAddon();
    // On GL context loss, drop the addon — xterm falls back to the DOM
    // renderer automatically. Re-attaching the pane reloads WebGL.
    addon.onContextLoss(() => {
      try {
        addon.dispose();
      } catch (err) {
        silentCatch('fleetTerminal:webglContextLoss')(err);
      }
      if (m.webgl === addon) {
        m.webgl = null;
        unGl(m.sessionId);
      }
    });
    m.term.loadAddon(addon);
    m.webgl = addon;
    touchGl(m.sessionId);
    // Make room only AFTER minting, with this session pinned: a fresh attach
    // can never evict itself.
    enforceWebglBudget(m.sessionId);
  } catch (e) {
    // WebGL unavailable (software WebView, blocked context) — DOM renderer is
    // the built-in fallback, so this is non-fatal.
    m.webgl = null;
    unGl(m.sessionId);
    silentCatch('fleetTerminal:webgl')(e);
  }
}

function disposeWebgl(m: ManagedTerminal): void {
  // Un-list unconditionally — the slot must go even if the addon is already
  // gone, or `enforceWebglBudget` would have a head it can never move past.
  unGl(m.sessionId);
  if (!m.webgl) return;
  try {
    m.webgl.dispose();
  } catch (err) {
    silentCatch('fleetTerminal:disposeWebgl')(err);
  }
  m.webgl = null;
}

function getOrCreate(sessionId: string): ManagedTerminal {
  const existing = registry.get(sessionId);
  if (existing) return existing;

  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: effectiveFontSize(),
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: themeFor(currentConfig.theme),
    allowProposedApi: true,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  try {
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = '11';
  } catch (e) {
    silentCatch('fleetTerminal:unicode11')(e);
  }
  try {
    term.loadAddon(new WebLinksAddon(handleLink));
  } catch (e) {
    silentCatch('fleetTerminal:weblinks')(e);
  }

  const holder = document.createElement('div');
  holder.style.width = '100%';
  holder.style.height = '100%';
  holder.setAttribute('data-fleet-terminal-holder', sessionId);

  const disposables: IDisposable[] = [];

  const managed: ManagedTerminal = {
    sessionId,
    term,
    fit,
    holder,
    owner: null,
    resizeObs: undefined as unknown as ResizeObserver, // set below
    disposables,
    onMouseUp: () => {},
    onContextMenu: () => {},
    webgl: null,
    opened: false,
    attached: false,
    rafId: null,
    hydrating: false,
    pendingLive: [],
    hydrationGen: 0,
    lastCols: 0,
    lastRows: 0,
    deadNoticeShown: false,
    writeFailed: false,
    listenerNoticeShown: false,
    hydratedOk: false,
  };

  // User keystrokes → PTY stdin (raw bytes; xterm's onData already includes
  // \r / \n so we don't append anything).
  disposables.push(
    term.onData((data) => {
      writeInput(sessionId, data).catch(silentCatch('fleetTerminal:writeInput'));
    }),
  );

  // Copy-on-select (P4): on mouse release, if there's a selection and the
  // feature is on, mirror it to the system clipboard. mouseup (not the
  // high-frequency onSelectionChange) keeps it to one write per drag.
  managed.onMouseUp = () => {
    if (!currentConfig.copyOnSelect) return;
    if (!term.hasSelection()) return;
    const sel = term.getSelection();
    // eslint-disable-next-line custom/prefer-shared-clipboard -- non-React module (terminal manager); copy-on-select mirrors the PTY selection to the clipboard with no UI surface to host <CopyButton>.
    if (sel) navigator.clipboard.writeText(sel).catch(silentCatch('fleetTerminal:copyOnSelect'));
  };
  holder.addEventListener('mouseup', managed.onMouseUp);

  // Right-click pastes (Windows Terminal / VS Code convention).
  managed.onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    pasteFromClipboard(sessionId);
  };
  holder.addEventListener('contextmenu', managed.onContextMenu);

  // Ctrl+Shift+V / Cmd+V paste — let every other key reach the PTY.
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const key = event.key.toUpperCase();
    const isPaste =
      (event.ctrlKey && event.shiftKey && key === 'V') ||
      (isMac && event.metaKey && !event.shiftKey && key === 'V');
    if (isPaste) {
      event.preventDefault();
      pasteFromClipboard(sessionId);
      return false;
    }
    return true;
  });

  // Refit whenever the holder's box changes (only fires while attached).
  managed.resizeObs = new ResizeObserver(() => scheduleFit(managed));
  managed.resizeObs.observe(holder);

  // PTY stdout → terminal is delivered by the ONE shared listener (see
  // ensureSharedOutputListener) — no per-terminal subscription here.

  registry.set(sessionId, managed);
  return managed;
}

/**
 * Mount `sessionId`'s terminal into `container` (creating it if needed) and
 * make `container` the owner — the only pane whose detach may tear it down.
 */
export function attachTerminal(sessionId: string, container: HTMLElement): void {
  unpark(sessionId);
  const m = getOrCreate(sessionId);
  // Read BEFORE the DOM move below, which would make every attach look mounted.
  const alreadyMounted =
    m.attached && m.holder.parentElement === container && (m.hydratedOk || m.hydrating);
  // Tell the pane we are taking the holder FROM, while it can still react. Only
  // a container still in the document can be displaced — one already unmounted
  // has nothing to repaint, and notifying it would be a callback into a dead
  // component.
  const previousOwner = m.owner;
  if (previousOwner && previousOwner !== container && previousOwner.isConnected) {
    try {
      holderLostListeners.get(previousOwner)?.();
    } catch (e) {
      // A displaced pane's own render must never be able to abort the attach the
      // operator is waiting on.
      silentCatch('fleetTerminal:holderLost')(e);
    }
  }
  m.owner = container;
  if (m.holder.parentElement !== container) {
    container.appendChild(m.holder);
  }
  if (!m.opened) {
    m.term.open(m.holder);
    m.opened = true;
  }
  m.attached = true;
  loadWebgl(m);
  scheduleFit(m);
  // Hydration is the lossy step (see `hydratedOk`), so it runs only when this
  // attach is a REAL one. A re-invocation for a session already mounted in this
  // same container — with a snapshot that landed, or one still in flight — used
  // to reset the emulator and replace 5000 lines of local scrollback with the
  // much shorter backend ring tail. Idempotence of attach was accidental; it is
  // now the contract.
  //
  // The gate closes SYNCHRONOUSLY (beginHydration) and the subscribe is issued
  // only once the shared output listener is registered. Both halves matter:
  //
  //   - Rust flips `subscribed = true` atomically under the ring lock and
  //     returns the snapshot in the same call (`registry.rs::subscribe_output`),
  //     so the instant the subscribe resolves the backend is emitting. Firing
  //     `listen()` unawaited alongside it left a window in which chunks were
  //     emitted with no JS listener registered — dropped with no trace, on the
  //     app's FIRST attach and after every listener failure. Awaiting closes it.
  //   - Closing the gate first means any chunk that does arrive between now and
  //     the snapshot is QUEUED rather than written ahead of it, which is the
  //     ordering `pendingLive` has always guaranteed once hydration started.
  //
  // Cost: the very first attach of an app session pays one extra IPC round trip
  // (the `listen` registration) before its first paint. Every later attach pays
  // a microtask — `ensureSharedOutputListener` returns an already-resolved
  // promise once the listener is up. That is the right price for never silently
  // losing the output the operator opened the pane to read.
  const gen = alreadyMounted ? null : beginHydration(m);
  // The listener is the OTHER door to live output, and its failure used to be
  // invisible because hydration succeeds independently of it. Chain the outcome
  // instead of dropping it: say so in the terminal, and keep retrying. Hydration
  // still runs on the failure path — a pane with no live listener must at least
  // paint its snapshot — and the notice is painted AFTER it is queued, so
  // `paintListenerNotice` lands it behind the snapshot instead of under the
  // `term.reset()` that would erase it.
  // The rejection handler deliberately reports nothing: ensureSharedOutputListener
  // already ran silentCatch('fleetTerminal:listen') on this exact error before
  // re-throwing it, and this arm exists to TELL THE OPERATOR and re-arm the
  // retry, not to log the same outage twice. Both arms are supplied to `then`
  // rather than `.then().catch()` so a throw from the SUCCESS arm cannot be
  // mistaken for a listener failure and paint a stall notice that isn't true.
  ensureSharedOutputListener().then(
    () => {
      if (gen !== null) completeHydration(m, gen);
    },
    () => {
      if (gen !== null) completeHydration(m, gen);
      paintListenerNotice(m);
      scheduleListenerRetry();
    },
  );
}

/**
 * Hydration, first half — bump the generation and CLOSE THE GATE on live
 * output, synchronously, at the moment of attach.
 *
 * Subscribing the session's terminal to live output and replaying the backend
 * ring snapshot is a two-step handshake: resetting + writing the full snapshot
 * (rather than appending a delta) keeps it simple and dup-free, because a
 * re-attach can't double-render into a terminal that was cleared first. While
 * the subscribe is in flight, `hydrating` holds live chunks in `pendingLive`;
 * they're flushed right after the snapshot so ordering is exact. A
 * `hydrationGen` bump cancels a stale resolution if the pane detached or
 * re-attached meanwhile.
 *
 * The gate closes here rather than in `completeHydration` because the subscribe
 * now waits for the shared output listener (see `attachTerminal`): a chunk that
 * lands in that window must be QUEUED, not written ahead of the snapshot.
 */
function beginHydration(m: ManagedTerminal): number {
  const gen = ++m.hydrationGen;
  m.hydrating = true;
  m.pendingLive = [];
  return gen;
}

/**
 * Second half of `hydrate` — issue the subscribe and splice its snapshot in
 * front of whatever `beginHydration` queued while the shared output listener
 * was being registered. Split from `beginHydration` so the gate can close on
 * the synchronous attach while the subscribe waits for the listener; a detach
 * or a newer attach in between moves `hydrationGen` and this becomes a no-op,
 * exactly as a stale snapshot resolution already did.
 */
function completeHydration(m: ManagedTerminal, gen: number): void {
  if (gen !== m.hydrationGen || !m.attached) return;
  subscribeTerminal(m.sessionId)
    .then((snapshot) => {
      // Superseded by a newer attach/detach — drop this snapshot.
      if (gen !== m.hydrationGen || !m.attached) return;
      // Clear any stale buffer so a re-focus doesn't duplicate the ring tail.
      m.term.reset();
      // The session answered, so any tombstone from an earlier failure is gone
      // with the reset — allow a future failure to paint a fresh one.
      m.deadNoticeShown = false;
      // A terminal that survived a reset is a terminal that may write again, so
      // the once-per-session write report re-arms with it.
      m.writeFailed = false;
      // The reset also wiped any listener warning, so allow a fresh one.
      m.listenerNoticeShown = false;
      // This terminal now holds a landed snapshot — a re-attach into the same
      // container has nothing to gain and the scrollback to lose.
      m.hydratedOk = true;
      if (snapshot) writeChunk(m, snapshot);
      const queued = m.pendingLive;
      m.pendingLive = [];
      m.hydrating = false;
      for (const chunk of queued) writeChunk(m, chunk);
    })
    .catch((e) => {
      // Subscribe failed (session gone, etc.) — stop hydrating so any future
      // live chunks render directly rather than piling up in the queue.
      if (gen === m.hydrationGen) {
        m.hydrating = false;
        m.pendingLive = [];
        // A failed subscribe must stay RETRYABLE by re-attaching — that is the
        // only recovery a dead-then-resurrected session has.
        m.hydratedOk = false;
        // Say so IN the terminal. This is the difference between "still
        // starting up" and "this session is gone", and the operator had no way
        // to tell them apart: both painted an empty black box.
        if (m.attached && deadNotice && !m.deadNoticeShown) {
          m.deadNoticeShown = true;
          m.term.write(`\r\n\x1b[31m${deadNotice}\x1b[0m\r\n`);
        }
      }
      silentCatch('fleetTerminal:subscribe')(e);
    });
}

/**
 * Unmount `sessionId`'s terminal from the DOM but keep it (and its buffer)
 * alive. Disposes the attach-scoped WebGL context and unsubscribes from live
 * output (the backend keeps buffering into its ring for a later re-attach).
 *
 * `owner` is the container the caller attached with. Pass it and the detach is
 * a NO-OP unless the caller still owns the terminal — a pane that has already
 * lost the holder to another pane must not tear down what that pane is
 * showing. Omitting it detaches unconditionally, which is what a caller
 * tearing the session down wholesale (not a pane) wants.
 */
export function detachTerminal(sessionId: string, owner?: HTMLElement): void {
  const m = registry.get(sessionId);
  if (!m) return;
  // Someone else took the holder — theirs to detach, not ours.
  if (owner && m.owner !== owner) return;
  m.owner = null;
  if (m.rafId !== null) {
    cancelAnimationFrame(m.rafId);
    m.rafId = null;
  }
  // Cancel any in-flight hydration and stop streaming this session over IPC.
  m.hydrationGen++;
  m.hydrating = false;
  m.pendingLive = [];
  // This detach UNSUBSCRIBES, so the snapshot the terminal holds stops tracking
  // the session — the next attach must genuinely re-subscribe and replay.
  m.hydratedOk = false;
  unsubscribeTerminal(sessionId).catch(silentCatch('fleetTerminal:unsubscribe'));
  disposeWebgl(m);
  m.attached = false;
  // Forget the pushed grid so the next attach reconciles size once against
  // whatever slot it lands in, even if that slot happens to match.
  m.lastCols = 0;
  m.lastRows = 0;
  m.holder.parentElement?.removeChild(m.holder);

  // Park it in LRU order and bound the population of off-screen terminals.
  // Beyond MAX_PARKED the oldest parked terminal is disposed — its next attach
  // recreates the instance and hydrates from the backend ring, so nothing the
  // switch-back model relies on is lost.
  unpark(sessionId);
  parked.push(sessionId);
  while (parked.length > MAX_PARKED) {
    const oldest = parked[0]!;
    // Two inconsistent entries must both be shifted by hand, because
    // disposeTerminal only unparks ids it actually finds in the registry:
    //   - no registry entry (already disposed elsewhere) -> disposeTerminal
    //     early-returns WITHOUT unparking, so the head never moves and the
    //     loop spins forever, freezing the UI thread mid-detach;
    //   - still attached -> it does not belong in the parked LRU at all.
    const victim = registry.get(oldest);
    if (!victim || victim.attached) {
      parked.shift();
      continue;
    }
    // Count ONLY a real budget eviction — the two shifts above are bookkeeping
    // repairs (a ghost id, a leaked attached id), not a terminal the budget
    // cost us, and counting them would make the instrument lie.
    bumpEvictions();
    disposeTerminal(oldest);
  }
}

/** Fully tear down `sessionId`'s terminal — call when the session is gone. */
export function disposeTerminal(sessionId: string): void {
  const m = registry.get(sessionId);
  if (!m) return;
  registry.delete(sessionId);
  unpark(sessionId);
  m.owner = null;
  // Disposing an ATTACHED terminal (gcTerminals on a session the roster
  // dropped while a pane still showed it) otherwise leaves the backend
  // streaming this session over IPC forever: the map entry is gone, so the
  // shared listener drops every chunk it is still being sent. The code that
  // subscribed names the unsubscribe.
  if (m.attached) {
    m.attached = false;
    unsubscribeTerminal(sessionId).catch(silentCatch('fleetTerminal:unsubscribe'));
  }
  if (m.rafId !== null) cancelAnimationFrame(m.rafId);
  try {
    m.resizeObs.disconnect();
  } catch (err) {
    silentCatch('fleetTerminal:disconnectObserver')(err);
  }
  m.holder.removeEventListener('mouseup', m.onMouseUp);
  m.holder.removeEventListener('contextmenu', m.onContextMenu);
  m.disposables.forEach((d) => {
    try {
      d.dispose();
    } catch (err) {
      silentCatch('fleetTerminal:disposeAddon')(err);
    }
  });
  disposeWebgl(m);
  m.holder.parentElement?.removeChild(m.holder);
  try {
    m.term.dispose();
  } catch (err) {
    silentCatch('fleetTerminal:disposeTerm')(err);
  }
}

/** Dispose every managed terminal whose session id is not in `keepIds`.
 *  Called from the grid so exited/removed sessions don't leak terminals. */
export function gcTerminals(keepIds: Set<string>): void {
  for (const id of [...registry.keys()]) {
    if (!keepIds.has(id)) disposeTerminal(id);
  }
}

/** Apply (partial) config to every live terminal and to all future ones. */
export function configureFleetTerminals(cfg: Partial<FleetTerminalConfig>): void {
  const next = { ...currentConfig, ...cfg };
  const fontChanged = next.fontSize !== currentConfig.fontSize;
  const themeChanged = next.theme !== currentConfig.theme;
  currentConfig = next;
  const font = effectiveFontSize();
  for (const m of registry.values()) {
    if (fontChanged) m.term.options.fontSize = font;
    if (themeChanged) m.term.options.theme = themeFor(currentConfig.theme);
    if ((fontChanged || themeChanged) && m.attached) scheduleFit(m);
  }
}

/**
 * Set (px) or clear (null) the transient font override applied to every live
 * terminal. The grid overlay uses this to shrink fonts as the grid densifies
 * without touching the user's persisted `fleetTerminalFontSize`.
 */
export function setFleetFontOverride(px: number | null): void {
  if (fontOverride === px) return;
  fontOverride = px;
  const font = effectiveFontSize();
  for (const m of registry.values()) {
    m.term.options.fontSize = font;
    if (m.attached) scheduleFit(m);
  }
}

export function getFleetTerminalConfig(): FleetTerminalConfig {
  return currentConfig;
}

/** Move focus to a session's terminal (e.g. after attaching the active pane). */
export function focusTerminal(sessionId: string): void {
  registry.get(sessionId)?.term.focus();
}

/**
 * Mark a session's terminal live or dead.
 *
 * A terminal over a process the doze ticker already killed used to keep
 * blinking its cursor and accepting keystrokes that went nowhere — the grid
 * tile knew the session was a tombstone, the pane did not. A dead terminal
 * stops blinking and refuses stdin, so the scrollback stays readable and
 * selectable while typing into a corpse is no longer silently swallowed.
 */
export function setTerminalLiveness(sessionId: string, live: boolean): void {
  const m = registry.get(sessionId);
  if (!m) return;
  m.term.options.cursorBlink = live;
  m.term.options.disableStdin = !live;
}

/** True when the app is currently in a light theme (data-theme="light*"). */
export function appIsLightTheme(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  return !!t && t.startsWith('light');
}
