import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';

/** Props handed to the `children` render-prop on every render. */
interface ListboxChildProps {
  close: () => void;
  focusIndex: number;
  /** Current type-ahead query when `searchable` is enabled (always `''`
   *  otherwise). The Listbox owns the input, focus management, and the
   *  aria-live announcement; the *caller supplies the matcher* by filtering
   *  its own option list with `query` and reporting the filtered length back
   *  through `itemCount`. */
  query: string;
}

interface ListboxProps {
  /** Render the trigger element. Consumer handles click via toggle(). */
  renderTrigger: (props: { isOpen: boolean; toggle: () => void }) => ReactNode;
  /** Render the dropdown options. */
  children: (props: ListboxChildProps) => ReactNode;
  /** Total selectable items -- enables ArrowUp/Down keyboard navigation.
   *  In `searchable` mode pass the *filtered* length so both navigation and
   *  the aria-live result count track what the user actually sees. */
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
  /** Enable a type-ahead filter input pinned to the top of the popup. The
   *  Listbox owns the query state and exposes it to `children` via `query`;
   *  the consumer filters its options with whatever matcher it likes and
   *  reports the filtered length through `itemCount`. Focus resets to the
   *  first match on every keystroke and the result count is announced via an
   *  aria-live region. New searchable consumers should guard
   *  `onSelectFocused` against an empty filtered list. */
  searchable?: boolean;
  /** Placeholder for the search input (already translated by the caller). */
  searchPlaceholder?: string;
  /** Accessible label for the search input. Falls back to `ariaLabel`. */
  searchAriaLabel?: string;
  /** Build the aria-live result-count announcement (already translated).
   *  Receives the current (filtered) `itemCount`. When omitted the bare
   *  count is announced. */
  renderSearchStatus?: (count: number) => string;
  /** Notified on every search keystroke (e.g. to log / telemeter). */
  onSearchChange?: (query: string) => void;
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
  searchable = false,
  searchPlaceholder,
  searchAriaLabel,
  renderSearchStatus,
  onSearchChange,
}: ListboxProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  // Reset focus index + search query when opening
  useEffect(() => {
    if (open) {
      setFocusIndex(-1);
      setQuery('');
    }
  }, [open]);

  // Autofocus the search input once the searchable popup is on screen.
  useEffect(() => {
    if (!open || !searchable) return;
    const id = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, searchable]);

  // Type-ahead: every keystroke re-focuses the first match so Enter selects
  // the top result.
  useEffect(() => {
    if (open && searchable) setFocusIndex(0);
  }, [query, open, searchable]);

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

  // Sticky type-ahead header rendered at the top of the popup.
  const searchHeader = searchable ? (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-foreground/10 bg-secondary/95 px-3 py-2 backdrop-blur-sm">
      <Search className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
      <input
        ref={searchInputRef}
        type="text"
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          onSearchChange?.(value);
        }}
        onKeyDown={(e) => {
          // Keep Escape working even when itemCount isn't supplied.
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
        placeholder={searchPlaceholder}
        aria-label={searchAriaLabel ?? ariaLabel}
        className="w-full bg-transparent typo-body text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  ) : null;

  // Visually-hidden live region announcing the filtered result count.
  const searchStatus = searchable ? (
    <div aria-live="polite" role="status" className="sr-only">
      {query ? (renderSearchStatus ? renderSearchStatus(itemCount ?? 0) : String(itemCount ?? 0)) : ''}
    </div>
  ) : null;

  const menuBody = (
    <>
      {searchHeader}
      {children({ close, focusIndex, query })}
      {searchStatus}
    </>
  );

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
          {menuBody}
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
        {menuBody}
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
