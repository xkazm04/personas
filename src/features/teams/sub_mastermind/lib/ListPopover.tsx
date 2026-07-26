// The canvas's one list-popover shell.
//
// Six popovers (goals, KPIs, personas, stack lists, categories, fleet sessions)
// had independently grown the same body: a positioned surface in the app's
// sidebar-menu language, a header band with a glyph + title + trailing count,
// a scrolling list, and — for the page-level ones — an Escape/outside-click
// dismissal effect duplicated verbatim five times. This is that body, once.
//
// Each popover keeps its OWN rows: what a goal row shows has nothing to do with
// what a persona row shows, and flattening that into a config object would trade
// real duplication for a worse abstraction. Only the shell is shared.
import { useEffect, useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Escape or a click outside `ref` closes the popover. The mousedown listener
 *  attaches on the next tick so the very click that opened the popover doesn't
 *  immediately close it. */
export function usePopoverDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [ref, onClose]);
}

export function ListPopover({
  title, icon: Icon, ink, dot, trailing, x, y, width = 248, maxListHeight = 260,
  anchor = 'fixed', testId, onClose, children,
}: {
  title: string;
  /** Header glyph. Omit and pass `dot` for the plain status-dot header. */
  icon?: LucideIcon;
  /** Theme token for the header glyph / dot. */
  ink: string;
  /** Render the header mark as a status dot instead of an icon. */
  dot?: boolean;
  /** Right-hand header slot — usually a count. */
  trailing?: ReactNode;
  /** Anchor coordinates, in whichever space `anchor` implies. */
  x: number;
  y: number;
  width?: number;
  maxListHeight?: number;
  /** `fixed` = viewport-anchored, self-dismissing (the page-level popovers).
   *  `absolute` = positioned inside the canvas shell, which owns dismissal. */
  anchor?: 'fixed' | 'absolute';
  testId: string;
  onClose: () => void;
  /** The rows. Each popover renders its own — see the note at the top. */
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const selfDismiss = anchor === 'fixed';
  usePopoverDismiss(selfDismiss ? panelRef : { current: null }, selfDismiss ? onClose : NOOP);

  return (
    <div
      ref={panelRef}
      className={`${selfDismiss ? 'fixed z-50' : 'absolute z-30'} rounded-card border border-primary/15 bg-secondary/95 backdrop-blur-sm shadow-elevation-4 overflow-hidden`}
      style={{ left: x, top: y, width }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-primary/5">
        {dot || !Icon
          ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ink }} aria-hidden />
          : <Icon className="w-4 h-4 shrink-0" style={{ color: ink }} aria-hidden />}
        <span className="typo-label text-foreground/90 truncate">{title}</span>
        {trailing != null && (
          <span className="ml-auto typo-caption text-foreground/50 tabular-nums shrink-0">{trailing}</span>
        )}
      </div>
      <ul className="overflow-y-auto py-1" style={{ maxHeight: maxListHeight }}>
        {children}
      </ul>
    </div>
  );
}

const NOOP = () => {};
