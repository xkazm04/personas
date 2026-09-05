import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * @catalog Right-click menu: fixed positioning with viewport clamp, outside-click/Escape/scroll dismissal, arrow-key roving focus.
 *
 * The app had three of these, written independently, and each one was missing
 * something a different one had: one clamped to the viewport but never handled
 * scroll, one closed on scroll but placed itself off-screen in a corner, and
 * none of the three was keyboard-reachable at all. This is the union of what
 * they each got right, plus the arrow-key navigation none of them had.
 *
 * Positioning is `fixed`, so the menu is measured after mount and then clamped
 * — its size depends on translated labels, which cannot be known before paint.
 * The first render happens at the raw coordinates with `visibility: hidden` so
 * a menu never flashes at the wrong place before it settles.
 */

export interface ContextMenuItem {
  id: string;
  label: string;
  /** Rendered at 3.5×3.5 in the leading slot. */
  icon?: ReactNode;
  /** Destructive tone (rose) plus a separator above by convention. */
  danger?: boolean;
  disabled?: boolean;
  /** Keyboard hint rendered right-aligned (e.g. "Ctrl+C"). Display only. */
  shortcut?: string;
  /** Draw a divider above this item. */
  separatorBefore?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  /** Viewport coordinates of the click that opened the menu. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Accessible name for the menu itself. */
  ariaLabel?: string;
  /** Width utility for the panel. Defaults to a comfortable `w-56`. */
  widthClass?: string;
  /**
   * Stacking level. The default sits above ordinary page chrome; a menu opened
   * from inside a modal or a full-screen overlay needs to pass its own.
   */
  zIndex?: number;
}

const MARGIN = 8;

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  ariaLabel,
  widthClass = 'w-56',
  zIndex = 9999,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Measure-then-clamp. A right-click near the right or bottom edge would
  // otherwise place a `position: fixed` menu partly (in a corner, almost
  // entirely) off-screen with no way to scroll to it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    });
  }, [x, y, items.length]);

  // Dismissal. `mousedown` (not `click`) so the menu is gone before the click
  // lands on whatever is underneath; capture-phase `scroll` because the anchor
  // moves out from under a fixed menu the moment any ancestor scrolls.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    // Deferred to the next task: the same mousedown that OPENED the menu would
    // otherwise be caught by this listener and close it immediately.
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  const enabledButtons = useCallback(
    () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [],
      ),
    [],
  );

  // Focus the first actionable item on open, so the menu is usable from the
  // keyboard the moment it appears (Shift+F10 / the context-menu key).
  useEffect(() => {
    enabledButtons()[0]?.focus();
  }, [enabledButtons]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const buttons = enabledButtons();
    if (buttons.length === 0) return;
    e.preventDefault();
    const current = buttons.findIndex((b) => b === document.activeElement);
    let next: number;
    switch (e.key) {
      case 'ArrowDown':
        next = (current + 1) % buttons.length;
        break;
      case 'ArrowUp':
        next = (current - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      default:
        next = buttons.length - 1;
        break;
    }
    buttons[next]?.focus();
  };

  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.x ?? x,
    top: pos?.y ?? y,
    zIndex,
    visibility: pos ? 'visible' : 'hidden',
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={style}
      className={`${widthClass} py-1.5 rounded-modal border border-primary/20 bg-background/95 backdrop-blur-md shadow-elevation-4`}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && (
            <div
              className={`my-1 mx-2 border-t ${item.danger ? 'border-status-error/25' : 'border-primary/15'}`}
              aria-hidden
            />
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 typo-body text-left rounded-input transition-colors focus-ring ${
              item.disabled
                ? 'text-foreground opacity-40 cursor-not-allowed'
                : item.danger
                  ? 'text-status-error hover:bg-status-error/10'
                  : 'text-foreground hover:bg-secondary/50'
            }`}
          >
            {item.icon && <span className="w-3.5 h-3.5 flex-shrink-0 inline-flex">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <kbd className="ml-auto typo-caption text-foreground/70 font-mono tracking-tight">
                {item.shortcut}
              </kbd>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

export default ContextMenu;
