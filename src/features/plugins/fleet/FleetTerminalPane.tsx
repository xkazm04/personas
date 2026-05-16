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
        background: '#0a0a0c',
        foreground: '#e6e6e8',
        cursor: '#fbbf24',
        cursorAccent: '#0a0a0c',
        selectionBackground: '#fbbf2444',
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
