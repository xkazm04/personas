import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface IconPopoverProps {
  icon: LucideIcon;
  title: string;
  /** Greyed-out affordance when the property isn't relevant to the selection. */
  disabled?: boolean;
  /** Highlight the trigger when the property holds a non-default value. */
  active?: boolean;
  /** Content rendered inside the popover body. */
  children: ReactNode;
  /** Max width of the popover. Defaults to 280px — fits NumField + RangeField comfortably. */
  widthPx?: number;
}

/**
 * Icon-triggered popover used across the Media Studio toolbar. Click-outside
 * and Escape both dismiss; the popover is absolutely positioned below the
 * trigger and renders nothing when closed, so no layout shift.
 */
export function IconPopover({
  icon: Icon,
  title,
  disabled = false,
  active = false,
  children,
  widthPx = 280,
}: IconPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Run on next tick so the click that opened the popover doesn't close it.
    const h = window.setTimeout(() => {
      document.addEventListener('mousedown', onClickAway);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(h);
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-expanded={open}
        className={`w-8 h-8 flex items-center justify-center rounded-card border transition-colors ${
          disabled
            ? 'border-transparent text-foreground/30 cursor-not-allowed'
            : active
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/15'
              : open
                ? 'border-primary/20 bg-secondary/50 text-foreground'
                : 'border-transparent text-foreground/70 hover:bg-secondary/30 hover:text-foreground'
        }`}
      >
        <Icon className="w-4 h-4" />
      </button>
      {open && !disabled && (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-30 rounded-modal bg-card border border-primary/20 shadow-elevation-3 p-3"
          style={{ width: widthPx }}
        >
          <div className="typo-label text-foreground mb-2">{title}</div>
          {children}
        </div>
      )}
    </div>
  );
}
