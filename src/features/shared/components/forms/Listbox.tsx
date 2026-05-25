import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';

interface ListboxProps {
  /** Render the trigger element. Consumer handles click via toggle(). */
  renderTrigger: (props: { isOpen: boolean; toggle: () => void }) => ReactNode;
  /** Render the dropdown options. */
  children: (props: { close: () => void; focusIndex: number }) => ReactNode;
  /** Total selectable items -- enables ArrowUp/Down keyboard navigation. */
  itemCount?: number;
  /** Called when Enter is pressed on a focused item (0-based index). */
  onSelectFocused?: (index: number) => void;
  /** Accessible label for the listbox popup. */
  ariaLabel?: string;
  /** Additional classes on the root container. */
  className?: string;
  /** Override classes on the popup menu container. Use when the default
   *  `glass-sm`/`z-50` semi-transparent style causes collisions — e.g. when
   *  the trigger lives inside scrollable content where the menu can land
   *  over neighbouring tiles. Pass a fully-opaque background + higher z. */
  menuClassName?: string;
  /** Render the menu through a portal to document.body with fixed
   *  positioning anchored to the trigger. Use when the Listbox lives inside
   *  an `overflow-hidden`/`overflow-auto` ancestor (e.g. the adoption answer
   *  card) that would otherwise clip the absolutely-positioned menu.
   *  Position recomputes on scroll/resize while open. */
  portal?: boolean;
}

export function Listbox({
  renderTrigger,
  children,
  itemCount,
  onSelectFocused,
  ariaLabel,
  className,
  menuClassName,
  portal = false,
}: ListboxProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  // Click-outside: in portal mode the menu lives outside containerRef, so
  // guard both the trigger container and the portalled menu.
  useEffect(() => {
    if (!open) return;
    if (!portal) return; // non-portal path uses useClickOutside below
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, portal]);
  // Non-portal click-outside (hook must run unconditionally).
  useClickOutside(containerRef, open && !portal, close);

  // Portal positioning — anchor under the trigger, track scroll/resize.
  useEffect(() => {
    if (!open || !portal || !containerRef.current) return;
    const update = () => {
      const rect = containerRef.current!.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, portal]);

  // Reset focus index when opening
  useEffect(() => {
    if (open) setFocusIndex(-1);
  }, [open]);

  // Arrow key navigation + Enter selection
  useEffect(() => {
    if (!open || itemCount == null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, itemCount - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusIndex >= 0) {
        e.preventDefault();
        onSelectFocused?.(focusIndex);
        setOpen(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, focusIndex, itemCount, onSelectFocused]);

  const menu = open ? (
    portal ? (
      menuPos &&
      createPortal(
        <div
          ref={menuRef}
          className={menuClassName ?? 'animate-fade-slide-in rounded-xl shadow-elevation-3 overflow-hidden'}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width, zIndex: 9990 }}
          role="listbox"
          aria-label={ariaLabel}
        >
          {children({ close, focusIndex })}
        </div>,
        document.body,
      )
    ) : (
      <div
        className={
          menuClassName
            ?? 'animate-fade-slide-in absolute top-full mt-1 left-0 right-0 glass-sm rounded-xl shadow-elevation-3 z-50 overflow-hidden'
        }
        role="listbox"
        aria-label={ariaLabel}
      >
        {children({ close, focusIndex })}
      </div>
    )
  ) : null;

  return (
    <div ref={containerRef} className={`relative${className ? ` ${className}` : ''}`}>
      {renderTrigger({ isOpen: open, toggle })}
      {menu}
    </div>
  );
}
