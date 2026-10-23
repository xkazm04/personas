// Shared behaviour of the passport's anchored popovers (Improve, Deploy,
// Standards scan, Data links): flip/clamp placement next to a trigger rect,
// Esc and outside-mousedown dismissal, and dialog focus handling - focus moves
// into the panel when it shows and returns to the trigger when it goes away.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

const GAP = 6;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  anchor: DOMRect | null;
  width: number;
  onClose: () => void;
  /** True while the panel is rendered (the component may return null before its data is ready). */
  active: boolean;
  /** Height guess used before the first measurement. */
  estimatedHeight?: number;
  /** Re-run placement when the panel's height changes (content swap). */
  layoutKey?: unknown;
}

export function useAnchoredPopover({ anchor, width, onClose, active, estimatedHeight = 260, layoutKey }: Options) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!anchor) { setPos(null); return; }
    const panelH = panelRef.current?.offsetHeight ?? estimatedHeight;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow < panelH + 14 && anchor.top > spaceBelow ? Math.max(8, anchor.top - panelH - GAP) : anchor.bottom + GAP;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    setPos({ top, left });
  }, [anchor, width, estimatedHeight, layoutKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, []);

  // Focus: in on first visible paint, back to the trigger on close.
  const visible = active && pos !== null;
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus({ preventScroll: true });
    }
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [visible]);

  const style = (a: DOMRect): CSSProperties => ({
    top: pos?.top ?? a.bottom + GAP, left: pos?.left ?? a.left, width, visibility: pos ? 'visible' : 'hidden',
  });
  return { panelRef, style };
}
