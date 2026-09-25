// useRemoteTerminalMirror — a READ-ONLY xterm over a remote session's tail.
//
// ONE TERMINAL STACK. The xterm is built from `fleetTerminalOptions()`, the
// same font, theme and scrollback every local fleet pane uses, so the mirror
// looks like a pane. It is NOT registered in the fleet terminal manager: that
// registry is keyed by LOCAL session ids and owns subscribe/stdin/resize for a
// PTY on this machine, none of which applies here. What differs is the
// plumbing, and only the plumbing:
//
//   • input is disabled (`disableStdin`) — a full remote PTY was rejected in
//     design; steering goes through the drawer's three verbs;
//   • output arrives on the lossy tail (`remoteSessionOutput` bus), base64
//     decoded, and a skipped `seq` writes a dim "output skipped" marker at the
//     point where the gap is, so the reader knows the screen is not contiguous;
//   • subscribe on mount, unsubscribe on unmount. Unsubscribing NEVER cancels
//     the session — closing the drawer only stops the tail.
//
// Returns whether the first chunk has arrived, so the drawer can hold a calm
// ghost under the terminal chrome until then.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { fleetTerminalOptions } from '@/features/plugins/fleet/fleetTerminalManager';
import { chunkGap, decodeChunk, onRemoteSessionOutput } from '@/lib/network/remoteSessionOutput';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

/** A dim, bracketed line xterm renders between two non-contiguous chunks. */
export function skippedMarker(label: string): string {
  return `\r\n\x1b[2m[${label}]\x1b[0m\r\n`;
}

export function useRemoteTerminalMirror(
  jobId: string,
  container: RefObject<HTMLDivElement | null>,
  skippedLabel: string,
): boolean {
  const [received, setReceived] = useState(false);
  const setSubscribed = useSystemStore((s) => s.setRemoteOutputSubscribed);
  // The label is read at write time, so a language switch mid-session applies
  // to the next gap without rebuilding the terminal.
  const labelRef = useRef(skippedLabel);
  labelRef.current = skippedLabel;

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    setReceived(false);
    const term = new Terminal({ ...fleetTerminalOptions(), disableStdin: true, cursorBlink: false });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const refit = () => {
      try {
        fit.fit();
      } catch (err) {
        silentCatch('remoteMirror:fit')(err);
      }
    };
    refit();
    const resize = new ResizeObserver(refit);
    resize.observe(el);

    let lastSeq: number | null = null;
    let first = true;
    const off = onRemoteSessionOutput((chunk) => {
      if (chunk.jobId !== jobId) return;
      if (lastSeq !== null && chunk.seq <= lastSeq) return; // a late duplicate
      if (chunkGap(lastSeq, chunk.seq) > 0) term.write(skippedMarker(labelRef.current));
      lastSeq = chunk.seq;
      term.write(decodeChunk(chunk.chunkB64));
      if (first) {
        first = false;
        setReceived(true);
      }
    });
    setSubscribed(jobId, true).catch(toastCatch('remoteMirror:subscribe'));

    return () => {
      off();
      resize.disconnect();
      term.dispose();
      setSubscribed(jobId, false).catch(silentCatch('remoteMirror:unsubscribe'));
    };
  }, [jobId, container, setSubscribed]);

  return received;
}
