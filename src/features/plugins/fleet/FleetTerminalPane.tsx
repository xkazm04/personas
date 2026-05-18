import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { writeInput, resizeSession } from '@/api/fleet/fleet';
import { silentCatch } from '@/lib/silentCatch';

interface FleetTerminalPaneProps {
  /** Internal Fleet session id (UUID v4 minted by fleet_spawn_session). */
  sessionId: string;
  /** Optional className for the outer container. */
  className?: string;
}

/**
 * Live PTY terminal pane for one Fleet session.
 *
 * Wires xterm.js (renderer + keyboard handling) to the Rust-side PTY:
 *   - `fleet-session-output` events from Rust → `terminal.write(chunk)`
 *   - `terminal.onData` (key bytes from user) → `fleet_write_input`
 *   - ResizeObserver on container → `fit.fit()` → `fleet_resize_session`
 *
 * Each pane owns one xterm instance + one event subscription. We do NOT
 * share xterm across re-renders — disposing and re-creating on
 * `sessionId` change is cleaner than juggling per-session buffers.
 */
export function FleetTerminalPane({ sessionId, className }: FleetTerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const term = new Terminal({
      fontFamily: 'Menlo, "DejaVu Sans Mono", "Lucida Console", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      // Match Personas dark theme. Light theme override applied via CSS
      // in xterm.css overrides at the bottom of this file.
      theme: {
        // Cursor + selection use violet (matches the "awaiting input"
        // attention dot) instead of amber/gold per the de-goldify pass.
        // ANSI yellow/brightYellow stay as-is because programs may emit
        // legitimate yellow text and that's the terminal's job to preserve.
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
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    // Initial fit, then notify Rust of the resulting size.
    requestAnimationFrame(() => {
      try {
        fit.fit();
        const { cols, rows } = term;
        resizeSession(sessionId, cols, rows).catch(silentCatch('FleetTerminalPane:initialResize'));
      } catch (e) {
        silentCatch('FleetTerminalPane:initialFit')(e);
      }
    });

    // User input → PTY stdin.
    const dataDisposable = term.onData((data) => {
      writeInput(sessionId, data).catch(silentCatch('FleetTerminalPane:writeInput'));
    });

    // Clipboard paste — Ctrl+Shift+V (Windows / Linux terminal
    // convention) and Cmd+V (macOS). We intercept the key event
    // before xterm processes it, read the system clipboard via the
    // WebView's navigator.clipboard, and write the text straight to
    // the PTY. Returning false suppresses xterm's default handling so
    // the literal keystrokes aren't *also* sent.
    //
    // We don't bind plain Ctrl+V on Windows/Linux because in many
    // CLI contexts Ctrl+V is a legitimate control sequence (eg.
    // verbatim insert in readline); preserving terminal semantics
    // matters more than matching the browser-style shortcut.
    const pasteFromClipboard = () => {
      navigator.clipboard
        .readText()
        .then((text) => {
          if (!text) return;
          // Strip a trailing newline so pasting a single line doesn't
          // accidentally submit — let the user press Enter explicitly.
          // Multi-line pastes keep their internal newlines intact;
          // terminals handle that correctly.
          const cleaned = text.replace(/\r?\n$/, '');
          return writeInput(sessionId, cleaned);
        })
        .catch(silentCatch('FleetTerminalPane:paste'));
    };

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const isPaste =
        (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'V') ||
        (isMac && event.metaKey && !event.shiftKey && event.key.toUpperCase() === 'V');
      if (!isPaste) return true;
      event.preventDefault();
      pasteFromClipboard();
      return false; // suppress xterm default
    });

    // Right-click anywhere in the pane also pastes — matches the
    // Windows Terminal / VS Code terminal behaviour and gives a
    // discoverable path for users who don't know the shortcut.
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      pasteFromClipboard();
    };
    container.addEventListener('contextmenu', onContextMenu);

    // PTY stdout → terminal.
    const unlistenPromise = listen<{ session_id: string; chunk: string }>(
      EventName.FLEET_SESSION_OUTPUT,
      (event) => {
        if (event.payload.session_id !== sessionId) return;
        term.write(event.payload.chunk);
      },
    );

    // Resize handling — fit on container size change, debounced via rAF.
    let rafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        try {
          fit.fit();
          const { cols, rows } = term;
          resizeSession(sessionId, cols, rows).catch(silentCatch('FleetTerminalPane:resize'));
        } catch (e) {
          silentCatch('FleetTerminalPane:resize')(e);
        }
      });
    });
    resizeObserver.observe(container);

    // Focus on mount so the user can start typing immediately.
    term.focus();

    return () => {
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      container.removeEventListener('contextmenu', onContextMenu);
      dataDisposable.dispose();
      unlistenPromise.then((fn) => fn()).catch(silentCatch('FleetTerminalPane:unlisten'));
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full bg-[#0a0a0c] ${className ?? ''}`}
      data-testid={`fleet-terminal-${sessionId}`}
    />
  );
}
