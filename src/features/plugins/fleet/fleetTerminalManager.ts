/**
 * Fleet terminal manager — long-lived xterm instances, one per session.
 *
 * The previous design created and *disposed* an xterm every time the active
 * session changed (FleetTerminalPane keyed its whole lifecycle on
 * `sessionId`). Switching sessions therefore lost the scrollback and
 * re-rendered the surviving stream from scratch; sessions you weren't
 * looking at kept their PTY output in Rust but had no terminal to receive it.
 *
 * This manager flips that: it owns a `Terminal` (+ addons + the
 * `fleet-session-output` subscription) per `sessionId` that lives for as long
 * as the session exists, parked in a detached holder `<div>` when no pane is
 * showing it. The React component (`FleetTerminalPane`) becomes a thin
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
 *     N live GL contexts; unicode11 / web-links load once.
 *   - A shared `config` (font size, copy-on-select, theme) is applied to
 *     every live terminal and to all future ones (P4).
 *
 * Singleton survives Vite HMR by hanging off `globalThis` (same pattern as
 * executionBuffers / eventBus elsewhere in the app).
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
  resizeObs: ResizeObserver;
  unlistenOutput: (() => void) | null;
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
}

// HMR-safe registry. Reusing the existing map across hot reloads keeps live
// terminals (and their buffers) alive while editing the surrounding UI.
const REGISTRY_KEY = '__fleetTerminalRegistry__';
const registry: Map<string, ManagedTerminal> =
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] as Map<string, ManagedTerminal> | undefined ??
  new Map<string, ManagedTerminal>();
(globalThis as Record<string, unknown>)[REGISTRY_KEY] = registry;

/** Open a web link from terminal output via the OS browser (sanitized). */
function handleLink(_event: MouseEvent, uri: string): void {
  const safe = sanitizeExternalUrl(uri);
  if (!safe) return;
  openExternalUrl(safe).catch(silentCatch('fleetTerminal:openLink'));
}

/** Read the WebView clipboard and write it straight to the session's PTY. */
function pasteFromClipboard(sessionId: string): void {
  navigator.clipboard
    .readText()
    .then((textRaw) => {
      if (!textRaw) return;
      // Strip a trailing newline so pasting a single line doesn't auto-submit;
      // multi-line pastes keep their internal newlines (terminals handle that).
      const cleaned = textRaw.replace(/\r?\n$/, '');
      return writeInput(sessionId, cleaned);
    })
    .catch(silentCatch('fleetTerminal:paste'));
}

function pushResize(m: ManagedTerminal): void {
  const { cols, rows } = m.term;
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

function loadWebgl(m: ManagedTerminal): void {
  if (m.webgl) return;
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
      if (m.webgl === addon) m.webgl = null;
    });
    m.term.loadAddon(addon);
    m.webgl = addon;
  } catch (e) {
    // WebGL unavailable (software WebView, blocked context) — DOM renderer is
    // the built-in fallback, so this is non-fatal.
    m.webgl = null;
    silentCatch('fleetTerminal:webgl')(e);
  }
}

function disposeWebgl(m: ManagedTerminal): void {
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
    resizeObs: undefined as unknown as ResizeObserver, // set below
    unlistenOutput: null,
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

  // PTY stdout → terminal. The backend only emits for this session while it's
  // subscribed (see attachTerminal). While hydrating — between issuing the
  // subscribe and writing its ring snapshot — queue live chunks so they land
  // strictly AFTER the snapshot instead of interleaving with it.
  listen<{ session_id: string; chunk: string }>(EventName.FLEET_SESSION_OUTPUT, (event) => {
    if (event.payload.session_id !== sessionId) return;
    if (managed.hydrating) {
      managed.pendingLive.push(event.payload.chunk);
      return;
    }
    term.write(event.payload.chunk);
  })
    .then((fn) => {
      // Guard against a dispose() that raced the listen() promise.
      if (registry.get(sessionId) === managed) managed.unlistenOutput = fn;
      else fn();
    })
    .catch(silentCatch('fleetTerminal:listen'));

  registry.set(sessionId, managed);
  return managed;
}

/** Mount `sessionId`'s terminal into `container` (creating it if needed). */
export function attachTerminal(sessionId: string, container: HTMLElement): void {
  const m = getOrCreate(sessionId);
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
  hydrate(m);
}

/**
 * Subscribe the session's terminal to live output and replay the backend ring
 * snapshot. Resetting + writing the full snapshot (rather than appending a
 * delta) keeps this simple and dup-free: a re-attach can't double-render
 * because the terminal is cleared first. While the subscribe is in flight,
 * `hydrating` holds live chunks in `pendingLive`; they're flushed right after
 * the snapshot so ordering is exact. A `hydrationGen` bump cancels a stale
 * resolution if the pane detached/re-attached meanwhile.
 */
function hydrate(m: ManagedTerminal): void {
  const gen = ++m.hydrationGen;
  m.hydrating = true;
  m.pendingLive = [];
  subscribeTerminal(m.sessionId)
    .then((snapshot) => {
      // Superseded by a newer attach/detach — drop this snapshot.
      if (gen !== m.hydrationGen || !m.attached) return;
      // Clear any stale buffer so a re-focus doesn't duplicate the ring tail.
      m.term.reset();
      if (snapshot) m.term.write(snapshot);
      const queued = m.pendingLive;
      m.pendingLive = [];
      m.hydrating = false;
      for (const chunk of queued) m.term.write(chunk);
    })
    .catch((e) => {
      // Subscribe failed (session gone, etc.) — stop hydrating so any future
      // live chunks render directly rather than piling up in the queue.
      if (gen === m.hydrationGen) {
        m.hydrating = false;
        m.pendingLive = [];
      }
      silentCatch('fleetTerminal:subscribe')(e);
    });
}

/** Unmount `sessionId`'s terminal from the DOM but keep it (and its buffer)
 *  alive. Disposes the attach-scoped WebGL context and unsubscribes from live
 *  output (the backend keeps buffering into its ring for a later re-attach). */
export function detachTerminal(sessionId: string): void {
  const m = registry.get(sessionId);
  if (!m) return;
  if (m.rafId !== null) {
    cancelAnimationFrame(m.rafId);
    m.rafId = null;
  }
  // Cancel any in-flight hydration and stop streaming this session over IPC.
  m.hydrationGen++;
  m.hydrating = false;
  m.pendingLive = [];
  unsubscribeTerminal(sessionId).catch(silentCatch('fleetTerminal:unsubscribe'));
  disposeWebgl(m);
  m.attached = false;
  m.holder.parentElement?.removeChild(m.holder);
}

/** Fully tear down `sessionId`'s terminal — call when the session is gone. */
export function disposeTerminal(sessionId: string): void {
  const m = registry.get(sessionId);
  if (!m) return;
  registry.delete(sessionId);
  if (m.rafId !== null) cancelAnimationFrame(m.rafId);
  try {
    m.resizeObs.disconnect();
  } catch (err) {
    silentCatch('fleetTerminal:disconnectObserver')(err);
  }
  m.holder.removeEventListener('mouseup', m.onMouseUp);
  m.holder.removeEventListener('contextmenu', m.onContextMenu);
  if (m.unlistenOutput) {
    try {
      m.unlistenOutput();
    } catch (err) {
      silentCatch('fleetTerminal:unlisten')(err);
    }
  }
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

/** True when the app is currently in a light theme (data-theme="light*"). */
export function appIsLightTheme(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  return !!t && t.startsWith('light');
}
